import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  zeroAddress,
} from "viem";
import {
  intendedMainnetAssets,
  poolIdForRoute,
  validateMainnetRehearsalConfig,
} from "./lib/mainnet-rehearsal.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(
  process.env.ROBYN_MAINNET_REHEARSAL_CONFIG ??
    resolve(repoRoot, "config/protocol/robinhood-mainnet-rehearsal.json"),
);
const config = JSON.parse(await readFile(configPath, "utf8"));
const supportPolicyPath = resolve(repoRoot, config.supportPolicy);
const supportPolicy = JSON.parse(await readFile(supportPolicyPath, "utf8"));
const rpcUrl =
  process.env.ROBYN_MAINNET_RPC_URL ?? process.env.ROBYN_MAINNET_SERVER_RPC_URL;
if (!rpcUrl) throw new Error("ROBYN_MAINNET_RPC_URL is required");

const client = createPublicClient({
  chain: {
    id: 4663,
    name: "Robinhood Chain Mainnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  },
  transport: http(rpcUrl, { timeout: 20_000, retryCount: 1 }),
});

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
const tokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const quoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
];

const failures = validateMainnetRehearsalConfig(config, supportPolicy);
const chainId = await client.getChainId();
if (chainId !== 4663) failures.push(`RPC returned chain ${chainId}`);
const blockNumber = await client.getBlockNumber();

const venue = {};
for (const [name, expected] of Object.entries(config.venue)) {
  const address = getAddress(expected.address);
  const code = await client.getCode({ address, blockNumber });
  const runtimeCodeHash = code && code !== "0x" ? keccak256(code) : null;
  const passed = runtimeCodeHash === expected.runtimeCodeHash.toLowerCase();
  if (!passed) failures.push(`${name} runtime hash mismatch`);
  venue[name] = {
    address,
    runtimeCodeHash,
    expected: expected.runtimeCodeHash,
    passed,
  };
}

let liveCatalog;
try {
  const response = await fetch(config.sources.robinhoodAssetApi, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  liveCatalog = await response.json();
} catch (error) {
  failures.push(`Robinhood asset registry unavailable: ${error.message}`);
  liveCatalog = { assets: [] };
}
const liveBySymbol = new Map(
  (liveCatalog.assets ?? []).map((asset) => [asset.tokenSymbol, asset]),
);

const route = config.route;
const assets = [];
for (const asset of intendedMainnetAssets(config, supportPolicy)) {
  const poolId =
    asset.executionClass === "canonical-v4-single-hop"
      ? poolIdForRoute(asset.address, route)
      : null;
  const assetFailures = [];
  const code = await client.getCode({ address: asset.address, blockNumber });
  if (!code || code === "0x") assetFailures.push("missing token runtime code");
  let symbol = null;
  let decimals = null;
  try {
    [symbol, decimals] = await Promise.all([
      client.readContract({
        address: asset.address,
        abi: tokenAbi,
        functionName: "symbol",
        blockNumber,
      }),
      client.readContract({
        address: asset.address,
        abi: tokenAbi,
        functionName: "decimals",
        blockNumber,
      }),
    ]);
  } catch (error) {
    assetFailures.push(
      `token metadata call failed: ${error.shortMessage ?? error.message}`,
    );
  }
  if (symbol !== asset.symbol) {
    assetFailures.push(`symbol is ${symbol ?? "unavailable"}`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    assetFailures.push(`decimals are ${decimals ?? "unavailable"}`);
  }
  if (asset.kind === "robinhood-stock-token") {
    const live = liveBySymbol.get(asset.symbol);
    const deployment = live?.deployments?.find(
      (entry) => Number(entry.chainId) === 4663,
    );
    if (!deployment || getAddress(deployment.contractAddress) !== asset.address) {
      assetFailures.push("frozen address does not match the live Robinhood registry");
    }
    if (live?.status !== "ASSET_STATUS_ACTIVE") {
      assetFailures.push(`Robinhood asset status is ${live?.status ?? "missing"}`);
    }
  }
  let sqrtPriceX96 = 0n;
  let tick = 0;
  let liquidity = 0n;
  const quotes = {};
  if (asset.executionClass === "canonical-v4-single-hop") {
    try {
      const [slot0, observedLiquidity] = await Promise.all([
        client.readContract({
          address: config.venue.stateView.address,
          abi: stateViewAbi,
          functionName: "getSlot0",
          args: [poolId],
          blockNumber,
        }),
        client.readContract({
          address: config.venue.stateView.address,
          abi: stateViewAbi,
          functionName: "getLiquidity",
          args: [poolId],
          blockNumber,
        }),
      ]);
      [sqrtPriceX96, tick] = slot0;
      liquidity = observedLiquidity;
    } catch (error) {
      assetFailures.push(`pool state read failed: ${error.shortMessage ?? error.message}`);
    }
    if (sqrtPriceX96 === 0n) assetFailures.push("pool is not initialized");
    if (liquidity < BigInt(route.minimumLiquidity)) {
      assetFailures.push("pool has no active liquidity");
    }
    for (const [direction, zeroForOne, exactAmount] of [
      ["nativeToAsset", true, route.nativeQuoteProbe],
      ["assetToNative", false, route.assetQuoteProbe],
    ]) {
      try {
        const simulation = await client.simulateContract({
          account: zeroAddress,
          address: config.venue.quoter.address,
          abi: quoterAbi,
          functionName: "quoteExactInputSingle",
          args: [
            {
              poolKey: {
                currency0: zeroAddress,
                currency1: asset.address,
                fee: route.fee,
                tickSpacing: route.tickSpacing,
                hooks: route.hooks,
              },
              zeroForOne,
              exactAmount: BigInt(exactAmount),
              hookData: "0x",
            },
          ],
          blockNumber,
        });
        const [amount, gasEstimate] = simulation.result;
        quotes[direction] = {
          amount: amount.toString(),
          gasEstimate: gasEstimate.toString(),
          passed: amount > 0n,
        };
        if (amount === 0n) assetFailures.push(`${direction} quote returned zero`);
      } catch (error) {
        quotes[direction] = {
          passed: false,
          error: error.shortMessage ?? error.message,
        };
        assetFailures.push(`${direction} quote failed`);
      }
    }
  } else if (asset.executionClass === "direct-native-wrap") {
    const wethMatches =
      asset.address === getAddress(config.venue.weth.address);
    quotes.nativeToAsset = {
      amount: route.nativeQuoteProbe,
      passed: wethMatches,
    };
    quotes.assetToNative = {
      amount: route.assetQuoteProbe,
      passed: wethMatches,
    };
    if (!wethMatches) assetFailures.push("WETH address does not match the venue");
  } else {
    assetFailures.push(`unsupported execution class ${asset.executionClass}`);
  }
  if (asset.required) {
    failures.push(...assetFailures.map((failure) => `${asset.symbol}: ${failure}`));
  }
  assets.push({
    symbol: asset.symbol,
    address: asset.address,
    kind: asset.kind,
    required: asset.required,
    executionClass: asset.executionClass,
    activation: assetFailures.length === 0 ? "enabled" : "disabled",
    disabledReason: assetFailures.length === 0 ? null : assetFailures.join("; "),
    poolId,
    sqrtPriceX96: sqrtPriceX96.toString(),
    tick,
    liquidity: liquidity.toString(),
    quotes,
    failures: assetFailures,
    passed: assetFailures.length === 0,
  });
}

const guardianSignersPath = process.env.ROBYN_MAINNET_GUARDIAN_SIGNERS;
if (!guardianSignersPath)
  failures.push("ROBYN_MAINNET_GUARDIAN_SIGNERS is not configured");
const allocationPath = process.env.ROBYN_MAINNET_RDAO_ALLOCATION;
if (!allocationPath) failures.push("ROBYN_MAINNET_RDAO_ALLOCATION is not configured");

const roleConfiguration = {
  guardianSignersConfigured: Boolean(guardianSignersPath),
  daoAllocationConfigured: Boolean(allocationPath),
  daoAllocationValid: false,
};
if (allocationPath) {
  try {
    const allocation = JSON.parse(await readFile(resolve(allocationPath), "utf8"));
    const entries = allocation.allocations;
    const mode = allocation.governanceMode;
    const recipients = entries.map((entry) => entry.recipient.toLowerCase());
    const commonValid =
      allocation.schemaVersion === 2 &&
      mode === config.safe.governanceMode &&
      new Set(recipients).size === entries.length &&
      entries.every(
        (entry) =>
          Number.isInteger(entry.basisPoints) &&
          entry.basisPoints > 0 &&
          typeof entry.purpose === "string" &&
          entry.purpose.length > 0 &&
          (entry.recipient === "timelock" ||
            /^0x[0-9a-fA-F]{40}$/.test(entry.recipient)),
      ) &&
      entries.reduce((sum, entry) => sum + entry.basisPoints, 0) === 10_000;
    const bootstrapValid =
      mode === "sole-owner-bootstrap" &&
      entries.length === 1 &&
      entries[0].basisPoints === 10_000 &&
      entries[0].purpose === "project-deployer" &&
      entries[0].recipient !== "timelock";
    const distributedValid =
      mode === "distributed" &&
      entries.length === 5 &&
      entries.filter((entry) => entry.recipient === "timelock").length === 1 &&
      entries.every((entry) => entry.basisPoints === 2_000);
    roleConfiguration.daoAllocationValid =
      commonValid && (bootstrapValid || distributedValid);
    if (!roleConfiguration.daoAllocationValid) {
      failures.push("RDAO allocation does not uniquely allocate the fixed supply");
    }
  } catch (error) {
    failures.push(`RDAO allocation verification failed: ${error.message}`);
  }
}
const report = {
  schemaVersion: 16,
  checkedAt: new Date().toISOString(),
  chainId,
  blockNumber: blockNumber.toString(),
  configPath,
  venue,
  roleConfiguration,
  assets,
  activation: {
    requiredPassed: assets.filter((asset) => asset.required).every((asset) => asset.passed),
    enabledSymbols: assets.filter((asset) => asset.passed).map((asset) => asset.symbol),
    disabledOptionalSymbols: assets
      .filter((asset) => !asset.required && !asset.passed)
      .map((asset) => asset.symbol),
  },
  passed: failures.length === 0,
  failures,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (process.env.ROBYN_MAINNET_REHEARSAL_EVIDENCE) {
  await writeFile(
    resolve(process.env.ROBYN_MAINNET_REHEARSAL_EVIDENCE),
    serialized,
    { mode: 0o600 },
  );
}
process.stdout.write(serialized);
if (!report.passed) process.exitCode = 1;

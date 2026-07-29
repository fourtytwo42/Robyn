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
const safeAbi = parseAbi([
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
]);
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
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
  } else if (asset.executionClass === "pinned-execution-adapter") {
    const apiKey = process.env.ROBYN_ZERO_EX_API_KEY;
    const taker = process.env.ROBYN_MAINNET_REHEARSAL_TAKER;
    if (!apiKey || !taker) {
      assetFailures.push("protected 0x credentials or rehearsal taker are not configured");
    } else {
      for (const [direction, sellToken, buyToken, sellAmount] of [
        ["nativeToAsset", config.venue.weth.address, asset.address, route.nativeQuoteProbe],
        ["assetToNative", asset.address, config.venue.weth.address, route.assetQuoteProbe],
      ]) {
        try {
          const url = new URL(config.provider.quoteEndpoint);
          url.search = new URLSearchParams({
            chainId: "4663",
            sellToken,
            buyToken,
            sellAmount,
            taker,
            recipient: taker,
            slippageBps: String(config.provider.maximumSlippageBps),
          }).toString();
          const response = await fetch(url, {
            headers: {
              "0x-api-key": apiKey,
              "0x-version": config.provider.apiVersion,
              accept: "application/json",
            },
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          const amount = BigInt(payload.buyAmount ?? 0);
          const minimum = BigInt(payload.minBuyAmount ?? 0);
          const target = getAddress(payload.transaction?.to ?? "");
          const calldata = payload.transaction?.data;
          const passed =
            payload.liquidityAvailable !== false &&
            amount > 0n &&
            minimum > 0n &&
            minimum <= amount &&
            /^0x[0-9a-fA-F]{8,}$/.test(calldata ?? "");
          quotes[direction] = {
            amount: amount.toString(),
            minimum: minimum.toString(),
            allowanceTarget: target,
            selector: passed ? calldata.slice(0, 10) : null,
            passed,
          };
          if (!passed) assetFailures.push(`${direction} provider quote is invalid`);
        } catch (error) {
          quotes[direction] = { passed: false, error: error.message };
          assetFailures.push(`${direction} provider quote failed`);
        }
      }
    }
    assetFailures.push("independent onchain price guard is not pinned");
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

const treasury = process.env.ROBYN_MAINNET_TREASURY;
if (!treasury) failures.push("ROBYN_MAINNET_TREASURY is not configured");
const guardian = process.env.ROBYN_MAINNET_GUARDIAN;
if (!guardian) failures.push("ROBYN_MAINNET_GUARDIAN is not configured");
const guardianSignersPath = process.env.ROBYN_MAINNET_GUARDIAN_SIGNERS;
if (!guardianSignersPath)
  failures.push("ROBYN_MAINNET_GUARDIAN_SIGNERS is not configured");
const allocationPath = process.env.ROBYN_MAINNET_RDAO_ALLOCATION;
if (!allocationPath) failures.push("ROBYN_MAINNET_RDAO_ALLOCATION is not configured");
if (!process.env.ROBYN_ZERO_EX_API_KEY) {
  failures.push("protected 0x commercial credentials are not configured");
}

const roleConfiguration = {
  treasuryConfigured: Boolean(treasury),
  treasuryIsTimelock: false,
  guardianConfigured: Boolean(guardian),
  guardianIsTwoOfThreeSafe: false,
  guardianSignersConfigured: Boolean(guardianSignersPath),
  daoAllocationConfigured: Boolean(allocationPath),
  daoAllocationValid: false,
  zeroExCommercialAccessConfigured: Boolean(process.env.ROBYN_ZERO_EX_API_KEY),
};
if (treasury) {
  try {
    const treasuryAddress = getAddress(treasury);
    const code = await client.getCode({ address: treasuryAddress, blockNumber });
    if (!code || code === "0x") throw new Error("treasury has no runtime code");
    const delay = await client.readContract({
      address: treasuryAddress,
      abi: timelockAbi,
      functionName: "getMinDelay",
      blockNumber,
    });
    roleConfiguration.treasuryIsTimelock =
      delay === BigInt(config.governance.timelockSeconds);
    if (!roleConfiguration.treasuryIsTimelock) {
      failures.push("treasury is not the production-delay Timelock");
    }
  } catch (error) {
    failures.push(`treasury verification failed: ${error.shortMessage ?? error.message}`);
  }
}
if (guardian && guardianSignersPath) {
  try {
    const guardianAddress = getAddress(guardian);
    const signerDocument = JSON.parse(
      await readFile(resolve(guardianSignersPath), "utf8"),
    );
    const expectedOwners = (Array.isArray(signerDocument)
      ? signerDocument
      : signerDocument.signers
    ).map((owner) => getAddress(owner));
    if (
      expectedOwners.length !== 3 ||
      new Set(expectedOwners.map((owner) => owner.toLowerCase())).size !== 3
    ) {
      throw new Error("guardian signer file must contain three unique addresses");
    }
    const [threshold, owners] = await Promise.all([
      client.readContract({
        address: guardianAddress,
        abi: safeAbi,
        functionName: "getThreshold",
        blockNumber,
      }),
      client.readContract({
        address: guardianAddress,
        abi: safeAbi,
        functionName: "getOwners",
        blockNumber,
      }),
    ]);
    const actual = new Set(owners.map((owner) => owner.toLowerCase()));
    roleConfiguration.guardianIsTwoOfThreeSafe =
      threshold === 2n &&
      owners.length === 3 &&
      expectedOwners.every((owner) => actual.has(owner.toLowerCase()));
    if (!roleConfiguration.guardianIsTwoOfThreeSafe) {
      failures.push("guardian is not the declared 2-of-3 Safe");
    }
  } catch (error) {
    failures.push(`guardian verification failed: ${error.shortMessage ?? error.message}`);
  }
}
if (allocationPath) {
  try {
    const allocation = JSON.parse(await readFile(resolve(allocationPath), "utf8"));
    const entries = allocation.allocations;
    const accounts = entries.map((entry) => entry.account.toLowerCase());
    roleConfiguration.daoAllocationValid =
      allocation.schemaVersion === 1 &&
      entries.length > 0 &&
      new Set(accounts).size === entries.length &&
      entries.every(
        (entry) =>
          Number.isInteger(entry.shareBps) &&
          entry.shareBps > 0 &&
          entry.shareBps <= 10_000 &&
          typeof entry.purpose === "string" &&
          entry.purpose.length > 0 &&
          (["timelock", "deployer"].includes(entry.account) ||
            /^0x[0-9a-fA-F]{40}$/.test(entry.account)),
      ) &&
      entries.reduce((sum, entry) => sum + entry.shareBps, 0) === 10_000;
    if (!roleConfiguration.daoAllocationValid) {
      failures.push("RDAO allocation does not uniquely allocate the fixed supply");
    }
  } catch (error) {
    failures.push(`RDAO allocation verification failed: ${error.message}`);
  }
}
const report = {
  schemaVersion: 12,
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

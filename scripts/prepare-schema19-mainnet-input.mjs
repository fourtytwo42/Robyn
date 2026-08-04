#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";

const [schema18Argument, routeSourceArgument, outputArgument] = process.argv.slice(2);
if (!schema18Argument || !routeSourceArgument || !outputArgument) {
  throw new Error("usage: prepare-schema19-mainnet-input.mjs <schema18.json> <active-route-source.json> <output.json>");
}
const schema18Path = path.resolve(schema18Argument);
const routeSourcePath = path.resolve(routeSourceArgument);
const outputPath = path.resolve(outputArgument);
const [schema18Raw, routeSourceRaw] = await Promise.all([
  readFile(schema18Path, "utf8"),
  readFile(routeSourcePath, "utf8"),
]);
const schema18 = JSON.parse(schema18Raw);
const routeSource = JSON.parse(routeSourceRaw);
if (schema18.schemaVersion !== 18 || routeSource.schemaVersion !== 18) {
  throw new Error("Schema-18 governance and active route source required");
}
if (schema18.chainId !== 4663 || routeSource.chainId !== 4663) {
  throw new Error("chain 4663 manifests required");
}
const toolingSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) throw new Error("dirty Schema-19 checkout");
const upstreamSha = execFileSync("git", ["rev-parse", "@{u}"], { encoding: "utf8" }).trim();
if (toolingSha !== upstreamSha) throw new Error("unpushed Schema-19 tooling");
const contractReleaseSha = "a67288133f09bce68b7386009d702c14dfb8bbab";
const rpcUrl = process.env.ROBYN_SCHEMA19_MAINNET_RPC_URL ?? "http://127.0.0.1:18549";
const parsedRpc = new URL(rpcUrl);
if (!["127.0.0.1", "localhost"].includes(parsedRpc.hostname)) {
  throw new Error("Mainnet input requires loopback LAN gateway");
}
const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0 }) });
if ((await client.getChainId()) !== 4663) throw new Error("wrong Mainnet chain");
const syncing = await client.request({ method: "eth_syncing" });
if (syncing !== false) throw new Error("Mainnet LAN RPC is syncing");
const gateway = await fetch(new URL("/health", rpcUrl)).then(async (response) => {
  if (!response.ok) throw new Error(`gateway health ${response.status}`);
  return response.json();
});
if (
  gateway.status !== "ok" ||
  gateway.activeProvider !== "primary" ||
  gateway.providerSelection !== "operator" ||
  gateway.fallbackTrafficAuthorized !== false
) {
  throw new Error("Mainnet gateway is not healthy LAN-only");
}

const routeRouter = getAddress(routeSource.contracts.assetRouter);
const stateViewReaderAbi = parseAbi(["function stateView() view returns (address)"]);
const canonicalStateView = getAddress(
  await client.readContract({
    address: routeRouter,
    abi: stateViewReaderAbi,
    functionName: "stateView",
  }),
);

const external = {
  create2Deployer: getAddress(schema18.oracleHook.create2Deployer),
  poolManager: getAddress(schema18.contracts.poolManager),
  positionManager: getAddress(schema18.contracts.positionManager),
  quoter: getAddress(schema18.contracts.quoter),
  stateView: canonicalStateView,
  permit2: getAddress(schema18.contracts.permit2),
  universalRouter: getAddress(schema18.contracts.universalRouter),
  wrappedNative: getAddress(schema18.contracts.wrappedNative),
};
const reusedAddresses = {
  guardianSafe: getAddress(schema18.guardianSafe),
  daoToken: getAddress(schema18.contracts.daoToken),
  timelock: getAddress(schema18.contracts.timelock),
  governor: getAddress(schema18.contracts.governor),
  ...external,
};
const reusedRuntimeCodeHashes = {};
for (const [label, address] of Object.entries(reusedAddresses)) {
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error(`${label} runtime missing`);
  reusedRuntimeCodeHashes[label] = keccak256(code);
}

const routeAbi = parseAbi([
  "function routeStatus(address) view returns ((bytes32 poolId,uint128 liquidity,uint128 minimumLiquidity,uint128 maximumNativeInput,int24 spotTick,int24 referenceTick,uint24 maximumReferenceTickDeviation,bool enforceReferencePrice,bytes32 verificationClass,uint24 fee,int24 tickSpacing,address hooks,bool ready,bytes32 reason) status)",
  "function executionRouteStatus(address) view returns ((uint8 kind,uint128 maximumNativeInput,uint128 maximumAssetInput,bytes32 disabledReason,bool enabled,bool runtimeVerified,bool ready,bytes32 reason) status)",
]);
const stateViewAbi = parseAbi([
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
  "function quoteExactOutputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountIn,uint256 gasEstimate)",
]);
const quote = async (functionName, poolKey, zeroForOne, exactAmount) => {
  const simulation = await client.simulateContract({
    address: external.quoter,
    abi: quoterAbi,
    functionName,
    args: [{ poolKey, zeroForOne, exactAmount, hookData: "0x" }],
  });
  return simulation.result;
};
const requiredSymbols = ["GOOGL", "MSFT", "NVDA", "SPCX", "SPY"];
const rehearsalFailureFixtureSymbol = "MSFT";
const sourceBySymbol = new Map(routeSource.assetRoutes.map((route) => [route.symbol, route]));
const routes = [];
for (const symbol of requiredSymbols) {
  const source = sourceBySymbol.get(symbol);
  if (!source) throw new Error(`missing Mainnet route ${symbol}`);
  const asset = getAddress(source.address);
  const [route, execution] = await Promise.all([
    client.readContract({ address: routeRouter, abi: routeAbi, functionName: "routeStatus", args: [asset] }),
    client.readContract({ address: routeRouter, abi: routeAbi, functionName: "executionRouteStatus", args: [asset] }),
  ]);
  if (!execution.enabled || execution.kind !== 1 || route.poolId.toLowerCase() !== source.poolId.toLowerCase()) {
    throw new Error(`mismatched Mainnet route ${symbol}`);
  }
  const [liquidity, slot0, assetCode] = await Promise.all([
    client.readContract({ address: canonicalStateView, abi: stateViewAbi, functionName: "getLiquidity", args: [route.poolId] }),
    client.readContract({ address: canonicalStateView, abi: stateViewAbi, functionName: "getSlot0", args: [route.poolId] }),
    client.getCode({ address: asset }),
  ]);
  if (!assetCode || assetCode === "0x" || liquidity === 0n || slot0[0] === 0n) {
    throw new Error(`invalid Mainnet pool or asset runtime ${symbol}`);
  }
  const poolKey = {
    currency0: "0x0000000000000000000000000000000000000000",
    currency1: asset,
    fee: route.fee,
    tickSpacing: route.tickSpacing,
    hooks: route.hooks,
  };
  const quoteLadder = [
    100_000_000_000_000n,
    250_000_000_000_000n,
    500_000_000_000_000n,
    1_000_000_000_000_000n,
    2_500_000_000_000_000n,
    5_000_000_000_000_000n,
    10_000_000_000_000_000n,
    25_000_000_000_000_000n,
    50_000_000_000_000_000n,
  ].filter((amount) => amount <= route.maximumNativeInput);
  const ladderResults = [];
  for (const amount of quoteLadder) {
    try {
      const [buy] = await quote("quoteExactInputSingle", poolKey, true, amount);
      const [sell] = await quote("quoteExactInputSingle", poolKey, false, buy);
      await quote("quoteExactOutputSingle", poolKey, true, buy / 2n || 1n);
      await quote("quoteExactOutputSingle", poolKey, false, amount / 2n || 1n);
      ladderResults.push({
        amount,
        buy,
        sell,
        recoveryBps: Number((sell * 10_000n) / amount),
        passed: true,
      });
    } catch (error) {
      ladderResults.push({
        amount,
        passed: false,
        failureReason: String(error?.shortMessage ?? error?.message ?? error).slice(0, 300),
      });
    }
  }
  const selected = ladderResults
    .filter((entry) => entry.passed && entry.amount >= 1_000_000_000_000_000n && entry.recoveryBps >= 9_500)
    .at(-1);
  if (!selected) {
    const diagnostic = ladderResults.map((entry) => ({
      amountWei: entry.amount.toString(),
      recoveryBps: entry.recoveryBps ?? null,
      failureReason: entry.failureReason ?? null,
    }));
    throw new Error(`unsafe Mainnet route recovery ${symbol}: ${JSON.stringify(diagnostic)}`);
  }
  const cap = selected.amount;
  const buy = selected.buy;
  const sell = selected.sell;
  const recoveryBps = selected.recoveryBps;
  const minimumLiquidity = (liquidity * 9n) / 10n;
  routes.push({
    symbol,
    asset,
    kind: "uniswap-v4",
    fee: route.fee,
    tickSpacing: route.tickSpacing,
    hooks: route.hooks,
    minimumLiquidity: minimumLiquidity.toString(),
    maximumNativeInput: cap.toString(),
    referenceTick: Number(slot0[1]),
    maximumReferenceTickDeviation: route.maximumReferenceTickDeviation,
    enforceReferencePrice: route.enforceReferencePrice,
    verificationClass: route.verificationClass,
    enabled: true,
    liveQualification: {
      liquidity: liquidity.toString(),
      minimumLiquidity: minimumLiquidity.toString(),
      spotTick: Number(slot0[1]),
      capWei: cap.toString(),
      buyOutput: buy.toString(),
      roundTripOutput: sell.toString(),
      recoveryBps,
      exactInputBothDirections: true,
      exactOutputBothDirections: true,
      quoteLadder: ladderResults.map((entry) => ({
        amountWei: entry.amount.toString(),
        recoveryBps: entry.recoveryBps ?? null,
        passed: entry.passed && (entry.recoveryBps ?? 0) >= 9_500,
        failureReason: entry.failureReason ?? null,
      })),
    },
    rehearsalFailureFixture: symbol === rehearsalFailureFixtureSymbol,
  });
}
const wethStatus = await client.readContract({
  address: routeRouter,
  abi: routeAbi,
  functionName: "executionRouteStatus",
  args: [external.wrappedNative],
});
if (!wethStatus.ready || !wethStatus.runtimeVerified) {
  throw new Error("unready Mainnet WETH route");
}
routes.push({
  symbol: "WETH",
  asset: external.wrappedNative,
  kind: "wrapped-native",
  maximumNativeInput: wethStatus.maximumNativeInput.toString(),
  enabled: true,
});
const deployer = getAddress(schema18.deployer);
const [startingNonce, balance, blockNumber] = await Promise.all([
  client.getTransactionCount({ address: deployer, blockTag: "pending" }),
  client.getBalance({ address: deployer }),
  client.getBlockNumber(),
]);
const predecessorCatalog = routeSource.assetCatalog;
if (
  predecessorCatalog?.schemaVersion !== 18 ||
  !Array.isArray(predecessorCatalog.assets) ||
  predecessorCatalog.assets.length < routes.length
) {
  throw new Error("complete Schema-18 Mainnet asset catalog required");
}
const schema19CatalogPolicy = {
  ...predecessorCatalog,
  schemaVersion: 19,
  policyVersion: "schema19-mainnet-assets-v1",
  predecessorPolicyHash: predecessorCatalog.policyHash,
};
delete schema19CatalogPolicy.policyHash;
const assetCatalog = {
  ...schema19CatalogPolicy,
  policyHash: createHash("sha256")
    .update(JSON.stringify(schema19CatalogPolicy))
    .digest("hex"),
};
const result = {
  schemaVersion: 19,
  chainId: 4663,
  contractReleaseSha,
  toolingSha,
  sourceManifests: {
    schema18Sha256: createHash("sha256").update(schema18Raw).digest("hex"),
    activeRouteSourceSha256: createHash("sha256").update(routeSourceRaw).digest("hex"),
  },
  snapshotBlock: Number(blockNumber),
  deployer,
  deployerBalanceWei: balance.toString(),
  guardianSafe: reusedAddresses.guardianSafe,
  daoToken: reusedAddresses.daoToken,
  timelock: reusedAddresses.timelock,
  governor: reusedAddresses.governor,
  reusedRuntimeCodeHashes,
  startingNonce,
  external,
  autoMineHook: true,
  hookFlags: "0x18e4",
  hookDomain: keccak256(stringToHex("ROByn Schema-19 Mainnet")),
  settings: {
    rewardDuration: 3600,
    failureObservationSpacing: 86400,
    fallbackDelay: 259200,
    targetGraduationNative: "6000000000000000000",
    maximumCurvePurchase: "500000000000000000",
    maintenanceTaskGas: 1500000,
    maintenanceCallGas: 1550000,
  },
  routes,
  assetCatalog,
  rpcPolicy: {
    applicationUpstream: "LAN-only",
    transactionUpstream: "LAN-only",
    alchemyProbeOnly: true,
    alchemyFallbackAuthorized: false,
  },
  schema18RetirementPrecondition: {
    expectedLaunchCount: 1,
    expectedLaunchToken: schema18.contracts.genesisToken,
    requireNoExternalLiability: true,
  },
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(outputPath, serialized, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ output: outputPath, sha256: createHash("sha256").update(serialized).digest("hex"), snapshotBlock: result.snapshotBlock, startingNonce, balanceWei: result.deployerBalanceWei, routes: routes.length })}\n`);

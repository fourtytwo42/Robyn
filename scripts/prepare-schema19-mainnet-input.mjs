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
  if (!route.ready || !execution.ready || !execution.runtimeVerified) {
    throw new Error(`unready Mainnet route ${symbol}`);
  }
  routes.push({
    symbol,
    asset,
    kind: "uniswap-v4",
    fee: route.fee,
    tickSpacing: route.tickSpacing,
    hooks: route.hooks,
    minimumLiquidity: route.minimumLiquidity.toString(),
    maximumNativeInput: route.maximumNativeInput.toString(),
    referenceTick: route.referenceTick,
    maximumReferenceTickDeviation: route.maximumReferenceTickDeviation,
    enforceReferencePrice: route.enforceReferencePrice,
    verificationClass: route.verificationClass,
    enabled: true,
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

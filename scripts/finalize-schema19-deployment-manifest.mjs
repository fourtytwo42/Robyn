#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress } from "viem";
import { buildSchema19IndexingPolicy } from "./lib/schema19-indexing-policy.mjs";
import { buildSchema19AssetCatalog } from "./lib/schema19-asset-catalog.mjs";

const [verifiedArg, preparedArg, inputArg, ledgerArg, outputArg] = process.argv.slice(2);
if (![verifiedArg, preparedArg, inputArg, ledgerArg, outputArg].every(Boolean)) {
  throw new Error("usage: finalize-schema19-deployment-manifest.mjs <verified.json> <prepared.json> <protected-input.json> <broadcast-ledger.json> <output.json>");
}
const files = [verifiedArg, preparedArg, inputArg, ledgerArg].map((item) => path.resolve(item));
const outputPath = path.resolve(outputArg);
const raws = await Promise.all(files.map((file) => readFile(file, "utf8")));
const [verified, prepared, input, ledger] = raws.map(JSON.parse);
for (const document of [verified, prepared, input]) {
  if (document.schemaVersion !== 19) throw new Error("Schema-19 evidence required");
}
if (![46630, 4663].includes(verified.chainId) || prepared.chainId !== verified.chainId || input.chainId !== verified.chainId) {
  throw new Error("matching supported chain identities required");
}
if (!verified.passed) throw new Error("passing deployment verification required");
if (verified.contractReleaseSha !== prepared.contractReleaseSha || verified.contractReleaseSha !== input.contractReleaseSha) {
  throw new Error("contract release mismatch");
}
if (verified.toolingSha !== prepared.toolingSha || verified.toolingSha !== input.toolingSha) {
  throw new Error("tooling release mismatch");
}
const preparedDigest = createHash("sha256").update(raws[1]).digest("hex");
if (verified.preparedManifestSha256 !== preparedDigest) throw new Error("prepared manifest digest mismatch");
if (input.rpcPolicy?.applicationUpstream !== "LAN-only" || input.rpcPolicy?.alchemyFallbackAuthorized !== false) {
  throw new Error("LAN-only RPC policy required");
}
const successfulReceipts = ledger.receipts?.filter((receipt) => receipt.status === "0x1") ?? [];
const expectedReceiptCount =
  prepared.deployment.fullEndingNonceExclusive - prepared.deployment.startingNonce;
if (successfulReceipts.length !== expectedReceiptCount) {
  throw new Error("complete successful receipt ledger required");
}
const hashes = new Set(successfulReceipts.map((receipt) => receipt.transactionHash?.toLowerCase()));
if (hashes.has(undefined) || hashes.size !== successfulReceipts.length) throw new Error("unique receipt hashes required");
const deploymentBlock = Math.min(...successfulReceipts.map((receipt) => Number(BigInt(receipt.blockNumber))));
const deployed = verified.contracts;
const external = input.external;
const governance = verified.governance;
const contracts = {
  baseAsset: getAddress(external.wrappedNative),
  wrappedNative: getAddress(external.wrappedNative),
  rewardAssets: input.routes.map((route) => getAddress(route.asset)),
  poolManager: getAddress(external.poolManager),
  positionManager: getAddress(external.positionManager),
  quoter: getAddress(external.quoter),
  universalRouter: getAddress(external.universalRouter),
  permit2: getAddress(external.permit2),
  stateView: getAddress(external.stateView),
  guardian: getAddress(governance.guardianSafe),
  daoToken: getAddress(governance.daoToken),
  timelock: getAddress(governance.timelock),
  governor: getAddress(governance.governor),
  assetRouter: getAddress(deployed.assetRouter),
  conversionRouter: getAddress(deployed.assetRouter),
  routeRegistry: getAddress(deployed.assetRouter),
  nativeFeeConverter: getAddress(deployed.assetRouter),
  launchDeployer: getAddress(deployed.launchDeployer),
  vaultDeployer: getAddress(deployed.vaultDeployer),
  factory: getAddress(deployed.launchFactory),
  launchFactory: getAddress(deployed.launchFactory),
  protocolFeeRouter: getAddress(deployed.feeRouter),
  feeRouter: getAddress(deployed.feeRouter),
  daoRewardDistributor: getAddress(deployed.daoRewards),
  maintenanceCoordinator: getAddress(deployed.maintenance),
  claimsRouter: getAddress(deployed.claimsRouter),
  tradeRouter: getAddress(deployed.tradeRouter),
  tokenSink: getAddress(deployed.tokenSink),
  oracleHook: getAddress(deployed.oracleHook),
  adapterDeployer: getAddress(deployed.adapterDeployer),
  lockerDeployer: getAddress(deployed.lockerDeployer),
  marketDeployer: getAddress(deployed.marketDeployer),
  marketFactory: getAddress(deployed.marketFactory),
  atomicLaunchCoordinator: getAddress(deployed.coordinator),
  coordinator: getAddress(deployed.coordinator),
};
const runtimeCodeHashes = {
  ...verified.reusedRuntimeCodeHashes,
  ...verified.runtimeCodeHashes,
  factory: verified.runtimeCodeHashes.launchFactory,
  protocolFeeRouter: verified.runtimeCodeHashes.feeRouter,
  daoRewardDistributor: verified.runtimeCodeHashes.daoRewards,
  maintenanceCoordinator: verified.runtimeCodeHashes.maintenance,
  atomicLaunchCoordinator: verified.runtimeCodeHashes.coordinator,
};
const assetRoutes = input.routes.map((route) => ({
  symbol: route.symbol,
  address: getAddress(route.asset),
  kind: route.kind,
  enabled: route.enabled === true,
  fee: route.fee ?? null,
  tickSpacing: route.tickSpacing ?? null,
  hooks: route.hooks ?? null,
  minimumLiquidity: route.minimumLiquidity ?? null,
  maximumNativeInput: route.maximumNativeInput,
  referenceTick: route.referenceTick ?? null,
  maximumReferenceTickDeviation: route.maximumReferenceTickDeviation ?? null,
  verificationClass: route.verificationClass,
  testFailureFixture: route.testFailureFixture === true,
  rehearsalFailureFixture: route.rehearsalFailureFixture === true,
}));
const maintenancePolicy = {
  tasksPerUserAction: 1,
  taskGasLimit: String(verified.settings.maintenanceTaskGas),
  failureObservationSpacingSeconds:
    verified.settings.failureObservationSpacing,
  fallbackDelaySeconds: verified.settings.fallbackDelay,
  fallbackAsset: getAddress(external.wrappedNative),
};
const assetCatalog = buildSchema19AssetCatalog({
  chainId: verified.chainId,
  assetRoutes,
  quoter: external.quoter,
  suppliedCatalog: input.assetCatalog,
});
const result = {
  schemaVersion: 19,
  liquidityVenue: "uniswap-v4",
  environment: verified.chainId === 4663 ? "robinhood-mainnet" : "robinhood-testnet",
  chainId: verified.chainId,
  deploymentBlock,
  gitCommit: verified.contractReleaseSha,
  gitSha: verified.contractReleaseSha,
  contractReleaseSha: verified.contractReleaseSha,
  toolingSha: verified.toolingSha,
  deployer: getAddress(verified.deployer),
  guardianSafe: getAddress(governance.guardianSafe),
  governance,
  contracts,
  runtimeCodeHashes,
  normalizedRuntimeCodeHashes: verified.normalizedRuntimeCodeHashes,
  settings: verified.settings,
  maintenancePolicy,
  assetCatalog,
  initialState: {
    launchMode: "Public",
    assetConversionsPaused: false,
    feeConversionsPaused: false,
    applicationWritesEnabled: false,
  },
  assetRoutes,
  routes: assetRoutes.map(({ symbol, address, enabled }) => ({ symbol, asset: address, enabled })),
  rpcPolicy: input.rpcPolicy,
  indexingPolicy: null,
  deploymentEvidence: {
    preparedManifestSha256: preparedDigest,
    protectedInputSha256: createHash("sha256").update(raws[2]).digest("hex"),
    receiptLedgerSha256: createHash("sha256").update(raws[3]).digest("hex"),
    verificationSha256: createHash("sha256").update(raws[0]).digest("hex"),
    receiptCount: successfulReceipts.length,
  },
};
result.indexingPolicy = buildSchema19IndexingPolicy(result);
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
const outputRaw = await readFile(outputPath);
process.stdout.write(`${JSON.stringify({ output: outputPath, deploymentBlock, receiptCount: successfulReceipts.length, sha256: createHash("sha256").update(outputRaw).digest("hex") })}\n`);

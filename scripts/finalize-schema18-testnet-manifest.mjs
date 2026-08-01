#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [baselineArg, verifiedArg, preparedArg, inputArg, safeBroadcastArg, stackBroadcastArg, evidenceDirArg, outputArg] =
  process.argv.slice(2);
if (![baselineArg, verifiedArg, preparedArg, inputArg, safeBroadcastArg, stackBroadcastArg, evidenceDirArg, outputArg].every(Boolean)) {
  throw new Error("usage: finalize-schema18-testnet-manifest.mjs <schema16.json> <verified-schema18.json> <prepared.json> <input.json> <safe-broadcast.json> <stack-broadcast.json> <evidence-dir> <output.json>");
}
const paths = [baselineArg, verifiedArg, preparedArg, inputArg, safeBroadcastArg, stackBroadcastArg].map((value) => path.resolve(value));
const evidenceDir = path.resolve(evidenceDirArg);
const outputPath = path.resolve(outputArg);
const [baseline, verified, prepared, input, safeBroadcast, stackBroadcast] = await Promise.all(paths.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
if (baseline.schemaVersion !== 16 || verified.schemaVersion !== 18 || prepared.schemaVersion !== 18 || input.schemaVersion !== 18) throw new Error("Schema-16 application baseline and Schema-18 inputs required");
if (verified.chainId !== 46630 || prepared.chainId !== 46630 || input.chainId !== 46630) throw new Error("chain 46630 required");
if (verified.releaseSha !== prepared.releaseSha || verified.releaseSha !== input.releaseSha) throw new Error("release mismatch");

const receiptHash = new Set(stackBroadcast.receipts.filter((receipt) => receipt.status === "0x1").map((receipt) => receipt.transactionHash.toLowerCase()));
const confirmed = stackBroadcast.transactions.filter((transaction) => transaction.hash && receiptHash.has(transaction.hash.toLowerCase()));
const deploymentsByAddress = new Map(confirmed.filter((transaction) => ["CREATE", "CREATE2"].includes(transaction.transactionType)).map((transaction) => [transaction.contractAddress.toLowerCase(), transaction.hash]));
const contracts = {
  ...baseline.contracts,
  ...verified.contracts,
  conversionRouter: verified.contracts.assetRouter,
  routeRegistry: verified.contracts.assetRouter,
  launchFactory: verified.contracts.factory,
  feeRouter: verified.contracts.protocolFeeRouter,
  coordinator: verified.contracts.atomicLaunchCoordinator,
  guardian: verified.guardianSafe,
};
const activeSymbols = new Set(["WETH", ...input.routes.map((route) => route.symbol)]);
const assetRoutes = baseline.assetRoutes.filter((route) => activeSymbols.has(route.symbol)).map((route) => ({ ...route, enabled: false, disabledReason: "schema18-bootstrap-pending" }));
const assetCatalog = { ...baseline.assetCatalog, schemaVersion: 18, assets: baseline.assetCatalog.assets.filter((asset) => activeSymbols.has(asset.symbol)) };
contracts.rewardAssets = assetRoutes.map((route) => route.address);

const runtimeCodeHashes = {
  ...verified.runtimeCodeHashes,
  launchFactory: verified.runtimeCodeHashes.factory,
  feeRouter: verified.runtimeCodeHashes.protocolFeeRouter,
  coordinator: verified.runtimeCodeHashes.atomicLaunchCoordinator,
  stateView: baseline.runtimeCodeHashes.stateView,
  testAssetLiquidityLocker: baseline.runtimeCodeHashes.testAssetLiquidityLocker,
};
const deploymentTransactions = Object.fromEntries(Object.entries(contracts).flatMap(([key, address]) => {
  if (typeof address !== "string") return [];
  const transactionHash = deploymentsByAddress.get(address.toLowerCase());
  return transactionHash ? [[key, transactionHash]] : [];
}));
deploymentTransactions.guardianSafe = safeBroadcast.transactions[0]?.hash ?? null;
const correctiveFiles = [
  "corrective-1-renounce-admin.json",
  "corrective-2-pause-asset.json",
  "corrective-3-pause-fee.json",
];
const correctiveTransactions = await Promise.all(correctiveFiles.map(async (file) => {
  const receipt = JSON.parse(await readFile(path.join(evidenceDir, "receipts", file), "utf8"));
  if (receipt.status !== "0x1") throw new Error(`failed corrective receipt ${file}`);
  return receipt.transactionHash;
}));
const successfulConfiguration = confirmed.filter((transaction) => transaction.transactionType === "CALL").map((transaction) => transaction.hash);
const deploymentBlock = Math.min(...stackBroadcast.receipts.filter((receipt) => receipt.status === "0x1").map((receipt) => Number(BigInt(receipt.blockNumber))));
const baselineSha256 = createHash("sha256").update(await readFile(paths[0])).digest("hex");
const result = {
  ...baseline,
  schemaVersion: 18,
  chainId: 46630,
  releaseSha: verified.releaseSha,
  deployer: verified.deployer,
  guardianSafe: verified.guardianSafe,
  governance: verified.governance,
  bootstrap: verified.bootstrap,
  authorization: verified.authorization,
  deploymentBlock,
  gitCommit: verified.releaseSha,
  archivedPredecessorManifestSha256: baselineSha256,
  contracts,
  runtimeCodeHashes,
  deploymentTransactions,
  configurationTransactions: [...successfulConfiguration, ...correctiveTransactions],
  assetRoutes,
  routes: assetRoutes.map((route) => ({ symbol: route.symbol, asset: route.address })),
  assetCatalog,
  guardian: verified.guardianSafe,
  governanceProfile: "schema18-hour-governance-testnet",
  launchControl: {
    initialMode: "Paused",
    canaryLauncher: null,
    guardianAuthority: "pause-cancel-disable-only",
    governorAuthority: "timelock-only-after-bootstrap",
    bootstrapDeadline: verified.governance.bootstrapDeadline ?? null,
    bootstrapPlanHashes: verified.governance.bootstrapPlanHashes,
    bootstrapFinalization: "irreversible-after-step-two-distribution-expiry-owner-finalization-or-guardian-abort",
  },
  dao: {
    ...baseline.dao,
    rewardStreamDurationSeconds: 3600,
    governance: {
      profile: "schema18-hour-governance-testnet",
      votingDelaySeconds: 3600,
      votingPeriodSeconds: 14400,
      timelockSeconds: 3600,
      quorumBps: 1000,
      proposalThresholdBps: 100,
      bootstrapWindowSeconds: 172800,
      bootstrapPlanHashes: verified.governance.bootstrapPlanHashes,
      unanimousTimelockRequired: true,
    },
  },
  rewardStreams: {
    ...baseline.rewardStreams,
    launchTokenDurationSeconds: 3600,
    daoDurationSeconds: 3600,
    creatorDurationSeconds: 3600,
    release: "rolling-linear-one-hour",
  },
  creatorRewards: {
    ...baseline.creatorRewards,
    allocation: "assigned-at-fee-intake-and-unlocked-over-one-hour",
  },
  initialState: {
    launchMode: "Paused",
    assetConversionsPaused: true,
    feeConversionsPaused: true,
    applicationWritesEnabled: false,
  },
  oracleHook: {
    ...baseline.oracleHook,
    salt: prepared.oracleHook.salt,
    deploymentDomain: prepared.oracleHook.domain,
  },
  deploymentEvidence: {
    verifierManifestSha256: createHash("sha256").update(await readFile(paths[1])).digest("hex"),
    preparedManifestSha256: createHash("sha256").update(await readFile(paths[2])).digest("hex"),
    failedGasLimitedTransaction: verified.evidence.failedGasLimitedTransaction,
    correctiveTransactions,
  },
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
process.stdout.write(`${JSON.stringify({ output: outputPath, deploymentBlock, routes: assetRoutes.length, sha256: createHash("sha256").update(JSON.stringify(result)).digest("hex") })}\n`);

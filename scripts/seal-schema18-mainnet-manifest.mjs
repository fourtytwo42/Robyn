#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { getAddress } from "viem";
import { validateMainnetReceiptLedger } from "./lib/mainnet-receipt-ledger.mjs";

const CONTRACT_SHA = "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
const APPLICATION_SHA = "8327b250122cd9050a7da6a44e12859e3cf521aa";
const EXISTING_SAFE = getAddress("0xE6CD65E3039fCbb7fD8fb992E5388247d9627549");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const toolingSha = git("rev-parse", "HEAD");
if (git("status", "--porcelain") !== "" || git("rev-parse", "@{upstream}") !== toolingSha) {
  throw new Error("manifest sealing requires exact clean pushed tooling");
}
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return resolve(value);
};
const paths = {
  gasEvidence: required("ROBYN_MAINNET_GAS_EVIDENCE"),
  localDeployment: required("ROBYN_MAINNET_LOCAL_DEPLOYMENT"),
  capitalLedger: required("ROBYN_MAINNET_CAPITAL_LEDGER"),
  preparation: required("ROBYN_MAINNET_PREPARATION_REPORT"),
  lifecycleManifest: required("ROBYN_MAINNET_LIFECYCLE_MANIFEST"),
  rpcAcceptance: required("ROBYN_MAINNET_RPC_ACCEPTANCE"),
  fundingReport: required("ROBYN_MAINNET_FUNDING_REPORT"),
  bridgeEstimate: required("ROBYN_MAINNET_BRIDGE_ESTIMATE"),
  bridgeAmount: required("ROBYN_MAINNET_BRIDGE_AMOUNT_REPORT"),
  reproducibility: required("ROBYN_MAINNET_REPRODUCIBILITY_REPORT"),
  testnetAcceptance: required("ROBYN_TESTNET_ACCEPTANCE_REPORT"),
  browserAcceptance: required("ROBYN_TESTNET_BROWSER_ACCEPTANCE"),
};
const outputDirectory = required("ROBYN_MAINNET_MANIFEST_DIRECTORY");
const raw = {};
const evidence = {};
for (const [name, file] of Object.entries(paths)) {
  raw[name] = await readFile(file, "utf8");
  evidence[name] = JSON.parse(raw[name]);
}
validateMainnetReceiptLedger(evidence.gasEvidence, { releaseSha: CONTRACT_SHA });
const failures = [];
if (
  evidence.gasEvidence.schemaVersion !== 18 ||
  evidence.gasEvidence.applicationReleaseSha !== APPLICATION_SHA ||
  evidence.localDeployment.schemaVersion !== 18 ||
  evidence.localDeployment.releaseSha !== CONTRACT_SHA ||
  evidence.localDeployment.applicationReleaseSha !== APPLICATION_SHA
) failures.push("frozen Schema-18 release identity mismatch");
if (!evidence.capitalLedger.passed || BigInt(evidence.capitalLedger.recoveryBps) < 7_500n) {
  failures.push("capital-preserving canary failed");
}
if (evidence.rpcAcceptance.status !== "pass" || evidence.rpcAcceptance.transactionBroadcasts !== 0) {
  failures.push("LAN-only RPC acceptance failed");
}
if (
  evidence.rpcAcceptance.alchemyProbe?.applicationFallbackAuthorized !== false ||
  evidence.rpcAcceptance.alchemyProbe?.applicationTrafficSent !== false
) failures.push("Alchemy policy is not probe-only");
if (!evidence.fundingReport.passed || evidence.fundingReport.broadcastAuthorized !== false) {
  failures.push("funding gate failed");
}
if (
  evidence.bridgeEstimate.receiptOrBroadcast !== false ||
  evidence.bridgeAmount.receiptOrBroadcast !== false ||
  evidence.bridgeEstimate.bridgeAmountWei !== evidence.fundingReport.bridgeAmountWei ||
  evidence.bridgeAmount.bridgeAmountWei !== evidence.fundingReport.bridgeAmountWei
) failures.push("bridge evidence is not exact and non-broadcast");
if (
  evidence.preparation.schemaVersion !== 18 ||
  evidence.preparation.releaseSha !== CONTRACT_SHA ||
  evidence.preparation.applicationReleaseSha !== APPLICATION_SHA ||
  getAddress(evidence.preparation.existingSafe) !== EXISTING_SAFE ||
  evidence.lifecycleManifest.schemaVersion !== 18 ||
  evidence.lifecycleManifest.releaseSha !== CONTRACT_SHA
) failures.push("Schema-18 preparation identity mismatch");
if (
  !evidence.reproducibility.passed ||
  ![CONTRACT_SHA, APPLICATION_SHA].includes(evidence.reproducibility.gitSha)
) failures.push("reproducibility evidence mismatch");
if (
  evidence.testnetAcceptance.status !== "passed" ||
  evidence.testnetAcceptance.releaseSha !== APPLICATION_SHA ||
  evidence.testnetAcceptance.chainId !== 46630
) failures.push("focused Schema-18 Testnet acceptance mismatch");
if (
  evidence.browserAcceptance.result !== "pass" ||
  evidence.browserAcceptance.releaseSha !== APPLICATION_SHA ||
  evidence.browserAcceptance.walletTransactionsPerformed !== false
) failures.push("Schema-18 browser acceptance mismatch");
const requiredRoutes = ["GOOGL", "MSFT", "NVDA", "SPCX", "SPY", "WETH"];
const routeMap = new Map(evidence.localDeployment.routes.map((route) => [route.symbol, route]));
for (const symbol of requiredRoutes) {
  if (!routeMap.get(symbol)?.executedBothDirections) {
    failures.push(`${symbol} did not execute both directions`);
  }
}
if (failures.length > 0) throw new Error(`manifest cannot be sealed: ${failures.join("; ")}`);

const phaseGas = {};
for (const transaction of evidence.gasEvidence.transactions) {
  phaseGas[transaction.phase] = (phaseGas[transaction.phase] ?? 0n) + BigInt(transaction.gasUsed);
}
const gasCeilings = Object.fromEntries(
  Object.entries(phaseGas).map(([phase, gas]) => [
    phase,
    { measuredGas: gas.toString(), ceilingGas: ((gas * 15_000n + 9_999n) / 10_000n).toString() },
  ]),
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const evidenceChecksums = Object.fromEntries(
  Object.entries(raw).map(([name, value]) => [name, {
    sourceFile: paths[name],
    sealedFile: `evidence-${name}-${basename(paths[name])}`,
    sha256: sha256(value),
  }]),
);
const manifest = {
  schemaVersion: 18,
  sealedAt: new Date().toISOString(),
  chainId: 4663,
  contractReleaseSha: CONTRACT_SHA,
  applicationReleaseSha: APPLICATION_SHA,
  operationalToolingSha: toolingSha,
  forkBlock: evidence.gasEvidence.forkBlock,
  productionConfigHash: evidence.gasEvidence.productionConfigHash,
  runtimeIdentities: evidence.gasEvidence.runtimeIdentities,
  existingSafe: {
    address: EXISTING_SAFE,
    owner: evidence.preparation.deployer,
    threshold: 1,
    reusedFromPausedSchema16: true,
  },
  predictedContracts: evidence.localDeployment.contracts,
  governance: {
    fixedDaoSupplyWei: evidence.lifecycleManifest.governance.fixedDaoSupplyWei,
    deployerAllocationBps: 10_000,
    votingDelaySeconds: 3_600,
    votingPeriodSeconds: 14_400,
    timelockDelaySeconds: 3_600,
    bootstrapWindowSeconds: 172_800,
    bootstrapPlanHashes: evidence.lifecycleManifest.governance.bootstrapPlanHashes,
  },
  routes: requiredRoutes.map((symbol) => routeMap.get(symbol)),
  gas: {
    transactionCount: evidence.gasEvidence.transactions.length,
    phaseCeilings: gasCeilings,
    measuredTotalGas: evidence.fundingReport.totalMeasuredL2Gas,
    pinnedL2GasPriceWei: evidence.fundingReport.pinnedL2GasPriceWei,
  },
  funding: {
    bridgeRequired: BigInt(evidence.fundingReport.bridgeAmountWei) > 0n,
    bridgeAmountWei: evidence.fundingReport.bridgeAmountWei,
    totalRequiredL1Wei: evidence.fundingReport.totalRequiredL1Wei,
    projectedL1RemainingWei: evidence.fundingReport.projectedL1RemainingWei,
    l1EmergencyReserveWei: evidence.fundingReport.l1EmergencyReserveWei,
    l2OperationalReserveWei: evidence.fundingReport.l2OperationalReserveWei,
    canaryPrincipalWei: evidence.fundingReport.canaryPrincipalWei,
    shortfallWei: evidence.fundingReport.shortfallWei,
  },
  bootstrap: {
    steps: evidence.lifecycleManifest.bootstrap.steps,
    canaryRecoveryFloorBps: "7500",
    measuredRecoveryBps: evidence.capitalLedger.recoveryBps,
    unwindMinimumQuoteBps: "9900",
    unwindDeadlineSeconds: 120,
  },
  rpcPolicy: {
    applicationUpstream: "LAN-only",
    alchemy: "chain-sync-block-probes-only",
    automaticFallbackAuthorized: false,
    degradedAction: "disable-financial-submission",
  },
  emergencyControls: {
    initialLaunchMode: "Paused",
    conversionsInitiallyPaused: true,
    routesInitiallyDisabled: true,
    applicationWritesInitiallyDisabled: true,
    guardianMayPauseLaunches: true,
    guardianMayPauseConversions: true,
    guardianMayDisableRoutes: true,
  },
  evidence: evidenceChecksums,
  authorizationEligible: true,
  bridgeAuthorized: false,
  pausedDeploymentAuthorized: false,
  bootstrapStepOneAuthorized: false,
  bootstrapStepTwoAuthorized: false,
  publicActivationAuthorized: false,
};
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
for (const [name, value] of Object.entries(raw)) {
  await writeFile(resolve(outputDirectory, evidenceChecksums[name].sealedFile), value, { mode: 0o600, flag: "wx" });
}
const manifestPath = resolve(outputDirectory, "schema18-mainnet-deployment-manifest.json");
const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(manifestPath, manifestRaw, { mode: 0o600, flag: "wx" });
const checksumLines = [
  `${sha256(manifestRaw)}  ${basename(manifestPath)}`,
  ...Object.values(evidenceChecksums).map((item) => `${item.sha256}  ${item.sealedFile}`),
];
await writeFile(resolve(outputDirectory, "SHA256SUMS"), `${checksumLines.join("\n")}\n`, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ manifestPath, manifestSha256: sha256(manifestRaw), authorizationEligible: true, allBroadcastAuthorizations: false }, null, 2)}\n`);

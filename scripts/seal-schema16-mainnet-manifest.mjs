#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { getAddress, keccak256, stringToHex } from "viem";
import { validateMainnetReceiptLedger } from "./lib/mainnet-receipt-ledger.mjs";

const RELEASE_SHA = "a8d54bb125d091be0cea010262a68a2baaceda30";
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const toolingGitSha = git("rev-parse", "HEAD");
if (git("status", "--porcelain") !== "") {
  throw new Error("manifest sealing requires a clean operational tooling worktree");
}
let upstreamGitSha;
try {
  upstreamGitSha = git("rev-parse", "@{upstream}");
} catch {
  throw new Error("manifest sealing requires a configured pushed upstream branch");
}
if (upstreamGitSha !== toolingGitSha) {
  throw new Error(
    `manifest sealing requires the exact pushed tooling commit: local ${toolingGitSha}, upstream ${upstreamGitSha}`,
  );
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
  forkComparison: required("ROBYN_MAINNET_FORK_COMPARISON"),
  rpcAcceptance: required("ROBYN_MAINNET_RPC_ACCEPTANCE"),
  fundingReport: required("ROBYN_MAINNET_FUNDING_REPORT"),
  bridgeEstimate: required("ROBYN_MAINNET_BRIDGE_ESTIMATE"),
  bridgeAmount: required("ROBYN_MAINNET_BRIDGE_AMOUNT_REPORT"),
  governance: required("ROBYN_MAINNET_GOVERNANCE_REPORT"),
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
validateMainnetReceiptLedger(evidence.gasEvidence, { releaseSha: RELEASE_SHA });
const failures = [];
if (evidence.localDeployment.releaseSha !== RELEASE_SHA || !evidence.localDeployment.validation) {
  failures.push("local deployment is not the validated frozen release");
}
if (!evidence.capitalLedger.passed || BigInt(evidence.capitalLedger.recoveryBps) < 7_500n) {
  failures.push("capital-preserving canary did not pass");
}
if (!evidence.forkComparison.passed) failures.push("fork comparison did not pass");
if (evidence.rpcAcceptance.status !== "pass" || evidence.rpcAcceptance.transactionBroadcasts !== 0) {
  failures.push("RPC acceptance did not pass without broadcasts");
}
if (!evidence.fundingReport.passed || evidence.fundingReport.broadcastAuthorized !== false) {
  failures.push("funding gate did not pass in non-broadcast mode");
}
if (
  evidence.bridgeEstimate.receiptOrBroadcast !== false ||
  evidence.bridgeAmount.receiptOrBroadcast !== false ||
  evidence.bridgeEstimate.bridgeAmountWei !== evidence.fundingReport.bridgeAmountWei ||
  evidence.bridgeAmount.bridgeAmountWei !== evidence.fundingReport.bridgeAmountWei
) {
  failures.push("bridge evidence is not exact or non-broadcast");
}
if (
  evidence.governance.releaseSha !== RELEASE_SHA ||
  evidence.governance.governanceMode !== "sole-owner-bootstrap" ||
  evidence.governance.threshold !== 1 ||
  getAddress(evidence.governance.predictedSafe) !==
    getAddress(evidence.localDeployment.contracts.safe)
) {
  failures.push("governance identity mismatch");
}
if (!evidence.reproducibility.passed || evidence.reproducibility.gitSha !== RELEASE_SHA) {
  failures.push("reproducibility evidence mismatch");
}
if (
  evidence.testnetAcceptance.status !== "passed" ||
  evidence.testnetAcceptance.releaseSha !== RELEASE_SHA ||
  evidence.testnetAcceptance.chainId !== 46630
) {
  failures.push("focused Testnet acceptance mismatch");
}
if (
  evidence.browserAcceptance.result !== "pass" ||
  evidence.browserAcceptance.releaseSha !== RELEASE_SHA ||
  evidence.browserAcceptance.walletTransactionsPerformed !== false
) {
  failures.push("browser acceptance mismatch");
}
const requiredRoutes = ["GOOGL", "MSFT", "NVDA", "SPCX", "SPY", "WETH"];
const routeMap = new Map(evidence.localDeployment.routes.map((route) => [route.symbol, route]));
for (const symbol of requiredRoutes) {
  if (!routeMap.get(symbol)?.executedBothDirections) failures.push(`${symbol} did not execute both directions`);
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
  Object.entries(raw).map(([name, value]) => [name, { file: paths[name], sha256: sha256(value) }]),
);
const allocationHash = keccak256(stringToHex(JSON.stringify(evidence.governance.allocations)));
const manifest = {
  schemaVersion: 16,
  sealedAt: new Date().toISOString(),
  chainId: 4663,
  releaseSha: RELEASE_SHA,
  operationalToolingSha: toolingGitSha,
  sourceArchiveSha256: evidence.reproducibility.sourceArchiveSha256,
  reproducibleBuild: evidence.reproducibility.comparisons,
  productionConfigHash: evidence.gasEvidence.productionConfigHash,
  forkBlock: evidence.gasEvidence.forkBlock,
  runtimeIdentities: evidence.gasEvidence.runtimeIdentities,
  predictedContracts: evidence.localDeployment.contracts,
  governance: {
    mode: evidence.governance.governanceMode,
    safe: evidence.governance.predictedSafe,
    threshold: evidence.governance.threshold,
    signerSetHash: evidence.governance.signerSetHash,
    allocationHash,
    timelock: evidence.localDeployment.contracts.timelock,
    governor: evidence.localDeployment.contracts.governor,
  },
  routes: requiredRoutes.map((symbol) => routeMap.get(symbol)),
  gas: {
    transactionCount: evidence.gasEvidence.transactions.length,
    phaseCeilings: gasCeilings,
    measuredTotalGas: evidence.fundingReport.totalMeasuredL2Gas,
    pinnedL2GasPriceWei: evidence.fundingReport.pinnedL2GasPriceWei,
  },
  funding: {
    bridgeAmountWei: evidence.fundingReport.bridgeAmountWei,
    bridgeGasEstimate: evidence.fundingReport.bridgeGasEstimate,
    bridgeMaxFeePerGasWei: evidence.fundingReport.bridgeMaxFeePerGasWei,
    totalRequiredL1Wei: evidence.fundingReport.totalRequiredL1Wei,
    projectedL1RemainingWei: evidence.fundingReport.projectedL1RemainingWei,
    l1EmergencyReserveWei: evidence.fundingReport.l1EmergencyReserveWei,
    l2OperationalReserveWei: evidence.fundingReport.l2OperationalReserveWei,
    canaryPrincipalWei: evidence.fundingReport.canaryPrincipalWei,
  },
  canary: {
    graduationTargetWei: "10000000000000000",
    maximumPurchaseWei: "1000000000000000",
    recoveryFloorBps: "7500",
    measuredRecoveryBps: evidence.capitalLedger.recoveryBps,
    unwindMinimumQuoteBps: "9900",
    unwindDeadlineSeconds: 120,
    requiredActions: [
      "governed-canary-activation",
      "required-route-round-trips",
      "controlled-launch-and-graduation",
      "direct-and-sherwood-v4-trading",
      "fee-conversion-and-settlement",
      "one-hour-pull-claims",
      "creator-split-locking",
      "production-profile-governance",
      "capital-preserving-unwind",
      "final-settlement-and-pause",
    ],
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
  deploymentAuthorized: false,
  canaryAuthorized: false,
  publicActivationAuthorized: false,
};
await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
const manifestPath = resolve(outputDirectory, "schema16-mainnet-deployment-manifest.json");
const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(manifestPath, manifestRaw, { mode: 0o600, flag: "wx" });
const checksumLines = [
  `${sha256(manifestRaw)}  ${basename(manifestPath)}`,
  ...Object.entries(evidenceChecksums).map(
    ([name, item]) => `${item.sha256}  evidence-${name}-${basename(item.file)}`,
  ),
];
await writeFile(resolve(outputDirectory, "SHA256SUMS"), `${checksumLines.join("\n")}\n`, {
  mode: 0o600,
  flag: "wx",
});
process.stdout.write(
  `${JSON.stringify({ manifestPath, manifestSha256: sha256(manifestRaw), authorizationEligible: true, allBroadcastAuthorizations: false }, null, 2)}\n`,
);

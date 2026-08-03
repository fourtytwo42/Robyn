#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [baseArg, verifiedArg, journalArg, lifecycleArg, outputArg] = process.argv.slice(2);
if (![baseArg, verifiedArg, journalArg, lifecycleArg, outputArg].every(Boolean)) {
  throw new Error(
    "usage: finalize-schema19-live-testnet-manifest.mjs <rehearsed-manifest.json> <verified-live.json> <deployment-journal.jsonl> <lifecycle-state.json> <output.json>",
  );
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const [baseRaw, verifiedRaw, journalRaw, lifecycleRaw] = await Promise.all(
  [baseArg, verifiedArg, journalArg, lifecycleArg].map((value) =>
    readFile(path.resolve(value), "utf8"),
  ),
);
const base = JSON.parse(baseRaw);
const verified = JSON.parse(verifiedRaw);
const lifecycle = JSON.parse(lifecycleRaw);
const journal = journalRaw
  .trim()
  .split("\n")
  .filter(Boolean)
  .map(JSON.parse);

if (base.schemaVersion !== 19 || base.chainId !== 46630) {
  throw new Error("Schema-19 Testnet rehearsal manifest required");
}
if (verified.schemaVersion !== 19 || verified.chainId !== 46630 || verified.passed !== true) {
  throw new Error("passing live Schema-19 verification required");
}
if (
  verified.contractReleaseSha !== base.contractReleaseSha ||
  verified.toolingSha !== base.toolingSha ||
  verified.preparedManifestSha256 !== base.deploymentEvidence?.preparedManifestSha256
) {
  throw new Error("live verification identity mismatch");
}
for (const [label, address] of Object.entries(verified.contracts ?? {})) {
  const aliases = {
    feeRouter: "feeRouter",
    daoRewards: "daoRewardDistributor",
    maintenance: "maintenanceCoordinator",
    coordinator: "coordinator",
  };
  const manifestLabel = aliases[label] ?? label;
  if (base.contracts?.[manifestLabel]?.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`live contract address mismatch: ${label}`);
  }
}

const intents = journal.filter((record) => record.type === "intent");
const receipts = journal.filter((record) => record.type === "receipt");
const rejected = journal.filter((record) => record.type === "submission-rejected");
if (rejected.length !== 0 || intents.length !== 36 || receipts.length !== 36) {
  throw new Error("exactly 36 admitted and confirmed live deployment transactions required");
}
const intentKeys = new Set(intents.map((record) => record.logicalKey));
const receiptKeys = new Set(receipts.map((record) => record.logicalKey));
const receiptHashes = new Set(receipts.map((record) => record.transactionHash?.toLowerCase()));
if (
  intentKeys.size !== 36 ||
  receiptKeys.size !== 36 ||
  receiptHashes.size !== 36 ||
  [...intentKeys].some((key) => !receiptKeys.has(key)) ||
  receipts.some((record) => record.status !== "success" || !record.receiptDigest)
) {
  throw new Error("live deployment journal is incomplete, duplicated, or ambiguous");
}

const requiredStages = [
  "routes",
  "launch",
  "maintenance",
  "claims",
  "unwind",
  "post-settle",
  "shutdown",
  "reconcile",
];
if (
  lifecycle.schemaVersion !== 19 ||
  lifecycle.releaseSha !== base.contractReleaseSha ||
  lifecycle.toolingSha !== base.toolingSha ||
  lifecycle.manifestSha256 !== sha256(baseRaw) ||
  requiredStages.some((stage) => !lifecycle.completedStages?.includes(stage)) ||
  BigInt(lifecycle.recoveryBps ?? 0) < 7500n ||
  BigInt(lifecycle.finalBalanceWei ?? 0) < 1_500_000_000_000_000n ||
  lifecycle.fallbackEvidence?.observationsReset !== true ||
  !lifecycle.shutdownAt ||
  !lifecycle.reconciledAt
) {
  throw new Error("complete reconciled Schema-19 lifecycle required");
}

const deploymentBlock = Math.min(...receipts.map((record) => Number(record.blockNumber)));
const result = {
  ...base,
  liquidityVenue: "uniswap-v4",
  deploymentBlock,
  initialState: {
    launchMode: "Paused",
    assetConversionsPaused: true,
    feeConversionsPaused: true,
    applicationWritesEnabled: false,
  },
  assetRoutes: base.assetRoutes.map((route) => ({
    ...route,
    enabled: false,
    disabledReason: "schema19-testnet-qualification-complete",
  })),
  routes: base.routes.map((route) => ({ ...route, enabled: false })),
  deploymentEvidence: {
    ...base.deploymentEvidence,
    liveVerificationSha256: sha256(verifiedRaw),
    liveReceiptJournalSha256: sha256(journalRaw),
    lifecycleStateSha256: sha256(lifecycleRaw),
    liveReceiptCount: receipts.length,
    liveTransactionHashes: receipts.map((record) => record.transactionHash),
    qualificationPassed: true,
  },
  qualification: {
    completedStages: [...requiredStages],
    token: lifecycle.token,
    vault: lifecycle.vault,
    market: lifecycle.market,
    adapter: lifecycle.adapter,
    locker: lifecycle.locker,
    lockedPrincipal: lifecycle.lockedPrincipal,
    streamStartedAt: lifecycle.streamStartedAt,
    daoEpochs: lifecycle.daoEpochs,
    recoveryBps: lifecycle.recoveryBps,
    recoveredWei: lifecycle.recoveredWei,
    fallbackEvidence: lifecycle.fallbackEvidence,
    shutdownAt: lifecycle.shutdownAt,
    reconciledAt: lifecycle.reconciledAt,
    finalBalanceWei: lifecycle.finalBalanceWei,
  },
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(path.resolve(outputArg), serialized, { flag: "wx", mode: 0o600 });
process.stdout.write(
  `${JSON.stringify({ output: path.resolve(outputArg), deploymentBlock, receiptCount: receipts.length, sha256: sha256(serialized) })}\n`,
);

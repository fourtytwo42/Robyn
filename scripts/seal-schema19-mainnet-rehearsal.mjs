#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [inputArg, preparedArg, ledgerArg, verifiedArg, manifestArg, lifecycleArg, outputArg] =
  process.argv.slice(2);
if (![inputArg, preparedArg, ledgerArg, verifiedArg, manifestArg, lifecycleArg, outputArg].every(Boolean)) {
  throw new Error(
    "usage: seal-schema19-mainnet-rehearsal.mjs <input> <prepared> <ledger> <verified> <manifest> <lifecycle-dir> <output>",
  );
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = async (file) => {
  const raw = await readFile(path.resolve(file), "utf8");
  return { raw, value: JSON.parse(raw) };
};
const [input, prepared, ledger, verified, manifest, state, journalRaw] = await Promise.all([
  readJson(inputArg),
  readJson(preparedArg),
  readJson(ledgerArg),
  readJson(verifiedArg),
  readJson(manifestArg),
  readJson(path.join(path.resolve(lifecycleArg), "state.json")),
  readFile(path.join(path.resolve(lifecycleArg), "transactions.jsonl"), "utf8"),
]);
for (const item of [input.value, prepared.value, verified.value, manifest.value]) {
  if (item.schemaVersion !== 19 || item.chainId !== 4663) {
    throw new Error("exact chain-4663 Schema-19 evidence required");
  }
}
if (!verified.value.passed) throw new Error("deployment verification failed");
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
for (const stage of requiredStages) {
  if (!state.value.completedStages?.includes(stage)) {
    throw new Error(`missing lifecycle stage ${stage}`);
  }
}
if (BigInt(state.value.recoveryBps ?? 0) < 7_500n) {
  throw new Error("Mainnet fork recovery below 75 percent");
}
if (!state.value.fallbackEvidence?.observationsReset) {
  throw new Error("objective 72-hour fallback evidence missing");
}
const journal = journalRaw.trim().split("\n").filter(Boolean).map(JSON.parse);
const receipts = journal.filter((entry) => entry.type === "receipt");
const receiptHashes = new Set(receipts.map((entry) => entry.transactionHash?.toLowerCase()));
if (
  receipts.length === 0 ||
  receiptHashes.size !== receipts.length ||
  receipts.some((entry) => entry.status !== "success")
) {
  throw new Error("lifecycle receipt ledger is incomplete or reused");
}
const deploymentReceipts = ledger.value.receipts ?? [];
if (
  deploymentReceipts.length === 0 ||
  deploymentReceipts.some((entry) => entry.status !== "0x1")
) {
  throw new Error("deployment receipt ledger is incomplete");
}
const gasUsed = [...deploymentReceipts, ...receipts].reduce(
  (sum, entry) => sum + BigInt(entry.gasUsed),
  0n,
);
const result = {
  schemaVersion: 19,
  chainId: 4663,
  executionMode: "lan-sourced-local-fork-broadcast",
  generatedAt: new Date().toISOString(),
  contractReleaseSha: manifest.value.contractReleaseSha,
  toolingSha: manifest.value.toolingSha,
  applicationReleaseSha: "0873abd4332c6283b374c92de3ce244bc60f291c",
  forkBlock: input.value.snapshotBlock,
  deploymentManifestSha256: sha256(manifest.raw),
  protectedInputSha256: sha256(input.raw),
  preparedDeploymentSha256: sha256(prepared.raw),
  deploymentLedgerSha256: sha256(ledger.raw),
  verificationSha256: sha256(verified.raw),
  lifecycleJournalSha256: sha256(journalRaw),
  deploymentReceiptCount: deploymentReceipts.length,
  lifecycleReceiptCount: receipts.length,
  totalGasUsed: gasUsed.toString(),
  recoveryBps: state.value.recoveryBps,
  fallbackEvidence: state.value.fallbackEvidence,
  completedStages: state.value.completedStages,
  guardianShutdown: true,
  rpcPolicy: input.value.rpcPolicy,
  passed: true,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(path.resolve(outputArg), serialized, { mode: 0o600, flag: "wx" });
process.stdout.write(serialized);

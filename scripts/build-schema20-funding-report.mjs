#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http } from "viem";

const [preparedArgument, journalArgument, outputArgument] = process.argv.slice(2);
if (!preparedArgument || !journalArgument || !outputArgument) {
  throw new Error("usage: build-schema20-funding-report.mjs <prepared.json> <rehearsal-journal.jsonl> <output.json>");
}
const preparedRaw = await readFile(path.resolve(preparedArgument), "utf8");
const journalRaw = await readFile(path.resolve(journalArgument), "utf8");
const prepared = JSON.parse(preparedRaw);
const records = journalRaw.trim().split("\n").filter(Boolean).map(JSON.parse);
const receipts = records.filter((record) => record.type === "receipt");
if (prepared.schemaVersion !== 20 || receipts.length !== prepared.transactions.length) {
  throw new Error("complete Schema-20 rehearsal receipts required");
}
for (let index = 0; index < receipts.length; index += 1) {
  if (receipts[index].label !== prepared.transactions[index].label) {
    throw new Error(`rehearsal receipt order mismatch at ${index}`);
  }
}
const rpcUrl = process.env.ROBYN_SCHEMA20_FUNDING_RPC_URL ?? (prepared.chainId === 4663 ? "http://127.0.0.1:18549" : "http://127.0.0.1:18548");
const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0, timeout: 30_000 }) });
if ((await client.getChainId()) !== prepared.chainId) throw new Error("funding RPC chain mismatch");
const fees = await client.estimateFeesPerGas();
const observedMaxFee = fees.maxFeePerGas ?? fees.gasPrice;
const maxFeePerGasWei = (observedMaxFee * 2n).toString();
const reserveWei = prepared.chainId === 4663 ? "20000000000000000" : "1500000000000000";
const l1FeePerTransactionWei = "25000000000000";
const transactionGasCeilings = receipts.map((receipt, index) => ({
  label: prepared.transactions[index].label,
  gasUsed: receipt.gasUsed,
  gasCeiling: ((BigInt(receipt.gasUsed) * 3n + 1n) / 2n).toString(),
}));
const totalExecutionCeilingWei = transactionGasCeilings.reduce(
  (sum, transaction) => sum + BigInt(transaction.gasCeiling) * BigInt(maxFeePerGasWei) + BigInt(l1FeePerTransactionWei),
  0n,
);
const requiredBalanceWei = BigInt(reserveWei) + totalExecutionCeilingWei;
const report = {
  schemaVersion: 20,
  chainId: prepared.chainId,
  passed: true,
  preparedManifestSha256: createHash("sha256").update(preparedRaw).digest("hex"),
  transactionPlanSha256: prepared.transactionPlanSha256,
  rehearsalJournalSha256: createHash("sha256").update(journalRaw).digest("hex"),
  transactionCount: receipts.length,
  reserveWei,
  l1FeePerTransactionWei,
  maxFeePerGasWei,
  totalExecutionCeilingWei: totalExecutionCeilingWei.toString(),
  requiredBalanceWei: requiredBalanceWei.toString(),
  transactionGasCeilings,
  feeSnapshot: {
    capturedAt: new Date().toISOString(),
    rpcUrl: new URL(rpcUrl).hostname === "127.0.0.1" ? rpcUrl : "redacted-nonloopback",
    observedMaxFeePerGasWei: observedMaxFee.toString(),
    observedMaxPriorityFeePerGasWei: (fees.maxPriorityFeePerGas ?? 0n).toString(),
  },
};
await writeFile(path.resolve(outputArgument), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ output: path.resolve(outputArgument), requiredBalanceWei: report.requiredBalanceWei, transactionCount: report.transactionCount })}\n`);

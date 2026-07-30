#!/usr/bin/env node
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const command = args.shift();
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (!key?.startsWith("--") || value === undefined)
    throw new Error("invalid_arguments");
  options.set(key.slice(2), value);
}
const required = (name) => {
  const value = options.get(name);
  if (!value) throw new Error(`missing_${name}`);
  return value;
};
const releaseId = required("release-id");
const phase = required("phase");
const chainId = Number(required("chain-id"));
const idempotencyKey = required("idempotency-key");
if (!/^[A-Za-z0-9._-]{1,128}$/.test(releaseId))
  throw new Error("invalid_release_id");
if (!/^[A-Za-z0-9._-]{1,128}$/.test(phase))
  throw new Error("invalid_phase");
if (![1, 4663].includes(chainId)) throw new Error("invalid_mainnet_chain_id");
if (!/^[A-Za-z0-9._:-]{8,256}$/.test(idempotencyKey))
  throw new Error("invalid_idempotency_key");

const root =
  process.env.ROBYN_MAINNET_EVIDENCE_ROOT ??
  "/home/hendo420/robyn-evidence/mainnet";
const releaseDirectory = path.join(root, releaseId);
const journalPath = path.join(releaseDirectory, "transactions.jsonl");
const lockPath = path.join(releaseDirectory, ".transactions.lock");
await mkdir(releaseDirectory, { recursive: true, mode: 0o700 });
if (!(await stat(releaseDirectory)).isDirectory())
  throw new Error("invalid_evidence_directory");

let lock;
try {
  lock = await open(lockPath, "wx", 0o600);
  let records = [];
  try {
    records = (await readFile(journalPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const matching = records.filter(
    (record) => record.idempotencyKey === idempotencyKey,
  );
  let record;
  if (command === "begin") {
    if (matching.length !== 0)
      throw new Error("idempotency_key_already_recorded");
    const nonce = required("nonce");
    const calldataHash = required("calldata-hash").toLowerCase();
    const expectedEffect = required("expected-effect");
    if (!/^[0-9]+$/.test(nonce)) throw new Error("invalid_nonce");
    if (!/^0x[0-9a-f]{64}$/.test(calldataHash))
      throw new Error("invalid_calldata_hash");
    if (
      expectedEffect.length > 500 ||
      /private.?key|seed phrase|password|api.?key/i.test(expectedEffect)
    )
      throw new Error("unsafe_expected_effect");
    record = {
      schema: "robyn-mainnet-transaction-journal-v1",
      type: "intent",
      recordedAt: new Date().toISOString(),
      releaseId,
      phase,
      chainId,
      nonce,
      calldataHash,
      expectedEffect,
      idempotencyKey,
    };
  } else if (command === "receipt") {
    if (!matching.some((item) => item.type === "intent"))
      throw new Error("intent_not_recorded");
    if (matching.some((item) => item.type === "receipt"))
      throw new Error("receipt_already_recorded");
    const transactionHash = required("transaction-hash").toLowerCase();
    const receiptHash = required("receipt-hash").toLowerCase();
    const blockNumber = required("block-number");
    const status = required("status");
    if (!/^0x[0-9a-f]{64}$/.test(transactionHash))
      throw new Error("invalid_transaction_hash");
    if (!/^0x[0-9a-f]{64}$/.test(receiptHash))
      throw new Error("invalid_receipt_hash");
    if (!/^[0-9]+$/.test(blockNumber))
      throw new Error("invalid_block_number");
    if (!["success", "reverted"].includes(status))
      throw new Error("invalid_receipt_status");
    record = {
      schema: "robyn-mainnet-transaction-journal-v1",
      type: "receipt",
      recordedAt: new Date().toISOString(),
      releaseId,
      phase,
      chainId,
      transactionHash,
      receiptHash,
      blockNumber,
      status,
      idempotencyKey,
    };
  } else {
    throw new Error("expected_begin_or_receipt");
  }
  const journal = await open(journalPath, "a", 0o600);
  try {
    await journal.write(`${JSON.stringify(record)}\n`);
    await journal.sync();
  } finally {
    await journal.close();
  }
  process.stdout.write(`${JSON.stringify({ journalPath, record })}\n`);
} finally {
  if (lock) await lock.close();
  await rm(lockPath, { force: true });
}

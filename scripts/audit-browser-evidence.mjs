#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function options(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
      values.push(value);
    }
  }
  return values;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function fail(message) {
  throw new Error(message);
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function asNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^0x[0-9a-f]+$/i.test(value)) return Number.parseInt(value, 16);
  return Number(value);
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) fail(`RPC ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) fail(`RPC ${method} failed: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

const evidencePath = path.resolve(requiredOption("--evidence"));
const logsPath = path.resolve(requiredOption("--logs"));
const receiptsPath = path.resolve(requiredOption("--receipts"));
const expectedSha = requiredOption("--expected-sha");
const rpcUrl = option("--rpc-url", "http://127.0.0.1:8546");
const minimumReceipts = Number(option("--minimum-receipts", "8"));
const minimumSnapshots = Number(option("--minimum-snapshots", "3"));
const snapshotArguments = options("--snapshot");

if (!/^[0-9a-f]{40}$/.test(expectedSha)) fail("--expected-sha must be a full lowercase Git SHA");
if (!Number.isInteger(minimumReceipts) || minimumReceipts < 1) fail("Invalid receipt minimum");
if (!Number.isInteger(minimumSnapshots) || minimumSnapshots < 1) fail("Invalid snapshot minimum");

const evidence = readJson(evidencePath);
const logs = readJson(logsPath);
const receipts = readJson(receiptsPath);
if (evidence.passed !== true) fail("Browser evidence is not marked passed");
if (evidence.releaseGitSha !== expectedSha) fail("Browser evidence release SHA mismatch");
if (evidence.browser !== "Codex in-app browser") fail("Evidence was not captured with the Codex in-app browser");
if (Number(evidence.chainId) !== 31337) fail("Browser evidence chain ID is not 31337");
if (!/^0x[0-9a-f]{40}$/i.test(evidence.wallet ?? "")) fail("Browser evidence wallet is invalid");
if (!Array.isArray(logs) || logs.length !== 0) fail("Browser warning/error log evidence is not empty");
if (!Array.isArray(receipts) || receipts.length < minimumReceipts) fail("Too few browser transaction receipts");

const wallet = evidence.wallet.toLowerCase();
const hashes = new Set();
const blocks = [];
for (const receipt of receipts) {
  const hash = String(receipt.transactionHash ?? receipt.receipt?.transactionHash ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) fail("A browser receipt has an invalid transaction hash");
  if (hashes.has(hash)) fail(`Duplicate browser receipt: ${hash}`);
  hashes.add(hash);
  if (String(receipt.status ?? receipt.receipt?.status).toLowerCase() !== "0x1") {
    fail(`Browser receipt did not succeed: ${hash}`);
  }
  const from = String(receipt.from ?? receipt.receipt?.from ?? "").toLowerCase();
  if (from !== wallet) fail(`Browser receipt sender does not match the browser wallet: ${hash}`);
  const block = asNumber(receipt.blockNumber ?? receipt.receipt?.blockNumber);
  if (!Number.isSafeInteger(block) || block < 1) fail(`Browser receipt has an invalid block: ${hash}`);
  blocks.push(block);
}

const indexedBlock = Number(evidence.indexedBlock ?? evidence.verification?.indexedBlock);
if (!Number.isSafeInteger(indexedBlock) || Math.max(...blocks) > indexedBlock) {
  fail("Browser receipts extend beyond the claimed indexed block");
}
const claimedReceiptCount = evidence.verification?.successfulReceipts;
if (claimedReceiptCount !== undefined && Number(claimedReceiptCount) !== receipts.length) {
  fail("Claimed successful-receipt count does not match the receipt artifact");
}
const claimedLogCount = evidence.warningOrErrorLogs ?? evidence.verification?.browserWarningOrErrorLogs;
if (claimedLogCount !== undefined && Number(claimedLogCount) !== logs.length) {
  fail("Claimed browser-log count does not match the log artifact");
}

const evidenceDir = path.dirname(evidencePath);
const listedArtifacts = new Set(
  [...(evidence.artifacts ?? []), ...(evidence.domSnapshots ?? [])].map((entry) =>
    typeof entry === "string" ? entry : entry.file,
  ),
);
if (snapshotArguments.length < minimumSnapshots) fail("Too few browser DOM snapshots were supplied");
for (const relative of snapshotArguments) {
  if (!listedArtifacts.has(relative)) fail(`DOM snapshot is not listed by browser evidence: ${relative}`);
  const filename = path.resolve(evidenceDir, relative);
  if (!filename.startsWith(`${evidenceDir}${path.sep}`)) fail(`DOM snapshot escapes evidence directory: ${relative}`);
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) fail(`DOM snapshot is missing: ${relative}`);
  if (fs.statSync(filename).size < 100) fail(`DOM snapshot is implausibly small: ${relative}`);
}

const chainId = asNumber(await rpc(rpcUrl, "eth_chainId"));
if (chainId !== 31337) fail(`Live RPC chain ID is ${chainId}, expected 31337`);
let liveReceiptsMatched = 0;
for (const saved of receipts) {
  const hash = String(saved.transactionHash ?? saved.receipt?.transactionHash).toLowerCase();
  const live = await rpc(rpcUrl, "eth_getTransactionReceipt", [hash]);
  if (!live) fail(`Live chain is missing browser receipt: ${hash}`);
  for (const field of ["transactionHash", "blockHash", "blockNumber", "status", "from", "to"]) {
    const savedValue = saved[field] ?? saved.receipt?.[field];
    if (String(live[field]).toLowerCase() !== String(savedValue).toLowerCase()) {
      fail(`Live receipt ${field} mismatch for ${hash}`);
    }
  }
  liveReceiptsMatched += 1;
}

const audit = {
  schemaVersion: 1,
  auditedAt: new Date().toISOString(),
  expectedSha,
  browser: evidence.browser,
  wallet: evidence.wallet,
  chainId,
  indexedBlock,
  receiptCount: receipts.length,
  uniqueReceiptCount: hashes.size,
  liveReceiptsMatched,
  snapshotCount: snapshotArguments.length,
  browserLogCount: logs.length,
  allReceiptsSuccessful: true,
  allReceiptSendersMatchWallet: true,
  allSnapshotsListedAndNontrivial: true,
  passed: true,
};

process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);

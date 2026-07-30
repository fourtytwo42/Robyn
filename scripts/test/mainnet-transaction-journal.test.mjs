import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/mainnet-transaction-journal.mjs");
const hash = `0x${"ab".repeat(32)}`;
const transactionHash = `0x${"cd".repeat(32)}`;
const receiptHash = `0x${"ef".repeat(32)}`;

function run(root, command, extra) {
  return spawnSync(
    process.execPath,
    [
      script,
      command,
      "--release-id",
      "schema13-test",
      "--phase",
      "paused-deploy",
      "--chain-id",
      "4663",
      "--idempotency-key",
      "schema13:deploy:1",
      ...extra,
    ],
    {
      env: { ...process.env, ROBYN_MAINNET_EVIDENCE_ROOT: root },
      encoding: "utf8",
    },
  );
}

test("records one intent and receipt without allowing replay", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "robyn-mainnet-journal-"));
  try {
    const begin = run(root, "begin", [
      "--nonce",
      "7",
      "--calldata-hash",
      hash,
      "--expected-effect",
      "Deploy frozen Schema-13 stack in Paused mode",
    ]);
    assert.equal(begin.status, 0, begin.stderr);
    const duplicate = run(root, "begin", [
      "--nonce",
      "7",
      "--calldata-hash",
      hash,
      "--expected-effect",
      "duplicate",
    ]);
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /idempotency_key_already_recorded/);
    const receipt = run(root, "receipt", [
      "--transaction-hash",
      transactionHash,
      "--receipt-hash",
      receiptHash,
      "--block-number",
      "123",
      "--status",
      "success",
    ]);
    assert.equal(receipt.status, 0, receipt.stderr);
    const duplicateReceipt = run(root, "receipt", [
      "--transaction-hash",
      transactionHash,
      "--receipt-hash",
      receiptHash,
      "--block-number",
      "123",
      "--status",
      "success",
    ]);
    assert.notEqual(duplicateReceipt.status, 0);
    assert.match(duplicateReceipt.stderr, /receipt_already_recorded/);
    const lines = (
      await readFile(
        path.join(root, "schema13-test", "transactions.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].type, "intent");
    assert.equal(lines[1].type, "receipt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unsupported chains and secret-like text", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "robyn-mainnet-journal-"));
  try {
    const wrongChain = spawnSync(
      process.execPath,
      [
        script,
        "begin",
        "--release-id",
        "schema13-test",
        "--phase",
        "bridge",
        "--chain-id",
        "46630",
        "--idempotency-key",
        "schema13:bridge:1",
        "--nonce",
        "1",
        "--calldata-hash",
        hash,
        "--expected-effect",
        "test",
      ],
      {
        env: { ...process.env, ROBYN_MAINNET_EVIDENCE_ROOT: root },
        encoding: "utf8",
      },
    );
    assert.notEqual(wrongChain.status, 0);
    assert.match(wrongChain.stderr, /invalid_mainnet_chain_id/);
    const unsafe = run(root, "begin", [
      "--nonce",
      "1",
      "--calldata-hash",
      hash,
      "--expected-effect",
      "contains private key material",
    ]);
    assert.notEqual(unsafe.status, 0);
    assert.match(unsafe.stderr, /unsafe_expected_effect/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(new URL("../..", import.meta.url).pathname);
const runner = await readFile(
  path.join(repo, "scripts/run-schema19-mainnet-rehearsal.sh"),
  "utf8",
);
const sealer = await readFile(
  path.join(repo, "scripts/seal-schema19-mainnet-rehearsal.mjs"),
  "utf8",
);

test("Mainnet rehearsal is pinned to LAN, chain 4663, and local Anvil", () => {
  assert.match(runner, /http:\/\/127\.0\.0\.1:18549/);
  assert.match(runner, /--fork-block-number/);
  assert.match(runner, /--chain-id 4663/);
  assert.match(runner, /--auto-impersonate/);
  assert.match(runner, /http:\/\/127\.0\.0\.1:28548/);
  assert.doesNotMatch(runner, /alchemy\.com|--fork-url https:/i);
});

test("Mainnet rehearsal executes the complete lifecycle and final shutdown", () => {
  for (const stage of [
    "routes",
    "launch",
    "maintenance",
    "claims",
    "unwind",
    "post-settle",
    "shutdown",
    "reconcile",
  ]) {
    assert.match(runner, new RegExp(stage));
    assert.match(sealer, new RegExp(`\\"${stage}\\"`));
  }
  assert.match(sealer, /recoveryBps/);
  assert.match(sealer, /fallbackEvidence/);
  assert.match(sealer, /guardianShutdown: true/);
  assert.match(sealer, /lan-sourced-local-fork-broadcast/);
});

test("receipt sealing rejects failures, duplicates, and missing stages", () => {
  assert.match(sealer, /missing lifecycle stage/);
  assert.match(sealer, /receiptHashes\.size !== receipts\.length/);
  assert.match(sealer, /entry\.status !== "success"/);
  assert.match(sealer, /entry\.status !== "0x1"/);
});

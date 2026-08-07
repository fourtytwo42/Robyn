import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source = readFileSync(
  path.join(repo, "scripts/run-schema20-network-acceptance.mjs"),
  "utf8",
);

test("Schema-20 network acceptance covers every public subsystem", () => {
  for (const stage of [
    "routes",
    "stake-activate",
    "rdao-sale",
    "rdao-graduate",
    "rdao-rewards",
    "launch",
    "maintenance-claims",
    "reconcile",
  ])
    assert.match(source, new RegExp(`"${stage}"`));
  for (const behavior of [
    "quoteNativeToAsset",
    "swapExactAssetForNative",
    "activateFor",
    "quoteSell",
    "finalizeGraduation",
    "harvest",
    "createLaunch",
    "processRewards",
    "claimAll",
  ])
    assert.match(source, new RegExp(behavior));
});

test("Schema-20 acceptance is restart-safe and live writes are Testnet-only", () => {
  assert.match(source, /classifyCanaryJournal/);
  assert.match(source, /unresolved signed intent; replay prohibited/);
  assert.match(source, /live acceptance transactions are Testnet-only/);
  assert.match(source, /fallbackTrafficAuthorized !== false/);
  assert.match(source, /1_500_000_000_000_000n/);
});

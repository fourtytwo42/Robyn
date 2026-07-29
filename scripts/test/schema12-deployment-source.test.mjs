import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/deploy-testnet-v4-protocol.sh", "utf8");

test("schema-12 deployment creates fresh v4 mock assets and preserves nonce state", () => {
  for (const symbol of ["GOOGL", "MSFT", "NVDA", "SPY"]) {
    assert.match(source, new RegExp(`^${symbol}\\t`, "m"));
  }
  assert.match(source, /asset_key="schema12Asset\$\{symbol\}"/);
  assert.match(source, /googl="\$\{addresses\[schema12AssetGOOGL\]\}"/);
  assert.match(source, /provenance:"schema12-fresh-mock-v4-pool"/);
  assert.match(source, /official_asset_routes='\[\]'/);
  assert.doesNotMatch(source, /seed_tx="\$\(\s*send_transaction/);
  assert.match(source, /seed_tx="\$LAST_TRANSACTION_HASH"/);
});

test("schema-12 provider route encodes a bytes32 disabled reason", () => {
  assert.match(source, /zero_bytes32="0x[0]{64}"/);
  assert.match(source, /provider_guard_hash,\$zero_bytes32,true/);
  assert.doesNotMatch(source, /provider_guard_hash,\$zero,true/);
});

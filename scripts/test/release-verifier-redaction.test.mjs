import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const verifier = readFileSync(
  new URL("../verify-testnet-release.sh", import.meta.url),
  "utf8",
);

test("release verification output never exposes the protected RPC URL", () => {
  assert.doesNotMatch(verifier, /--arg serverRpcUrl/);
  assert.doesNotMatch(verifier, /serverRpcUrl:/);
  assert.match(verifier, /serverRpcProvider/);
});

test("release verification uses event-driven head liveness", () => {
  assert.match(verifier, /observedHeadBlock/);
  assert.match(verifier, /indexed_at_epoch/);
  assert.match(verifier, /observed_head_gap/);
  assert.doesNotMatch(
    verifier,
    /jq -r \.ingestionLagBlocks[\s\S]{0,80}-le 100/,
  );
});

test("release verification pins the deployed heartbeat interval", () => {
  assert.match(verifier, /INDEXER_HEARTBEAT_MS[\s\S]{0,160}"5200"/);
});

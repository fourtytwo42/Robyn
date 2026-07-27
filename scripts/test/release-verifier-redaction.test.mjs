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

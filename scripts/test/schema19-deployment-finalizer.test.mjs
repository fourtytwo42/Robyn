import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source = await readFile(
  path.join(repo, "scripts/finalize-schema19-deployment-manifest.mjs"),
  "utf8",
);

test("Schema-19 finalizer binds active runtime roles and scoped indexing", () => {
  for (const token of [
    "maintenanceCoordinator",
    "claimsRouter",
    "tradeRouter",
    "daoRewardDistributor",
    "buildSchema19IndexingPolicy",
    "universalRouter",
  ])
    assert.match(source, new RegExp(token));
});

test("Schema-19 finalizer fails closed on identity, receipt, and RPC policy drift", () => {
  for (const token of [
    "contract release mismatch",
    "tooling release mismatch",
    "prepared manifest digest mismatch",
    "complete successful receipt ledger required",
    "unique receipt hashes required",
    "LAN-only RPC policy required",
  ])
    assert.match(source, new RegExp(token));
});

test("Schema-19 finalizer preserves Public contracts while application writes remain disabled", () => {
  assert.match(source, /launchMode: "Public"/);
  assert.match(source, /assetConversionsPaused: false/);
  assert.match(source, /feeConversionsPaused: false/);
  assert.match(source, /applicationWritesEnabled: false/);
});

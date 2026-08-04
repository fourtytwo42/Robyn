import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../finalize-schema19-live-testnet-manifest.mjs", import.meta.url),
  "utf8",
);
const deploymentFinalizerSource = await readFile(
  new URL("../finalize-schema19-deployment-manifest.mjs", import.meta.url),
  "utf8",
);
const indexerSource = await readFile(
  new URL("../../apps/indexer/src/server.ts", import.meta.url),
  "utf8",
);

test("live Schema-19 finalizer rejects incomplete or ambiguous deployment evidence", () => {
  assert.match(source, /intents\.length !== 36/);
  assert.match(source, /receipts\.length !== 36/);
  assert.match(source, /submission-rejected/);
  assert.match(source, /receiptHashes\.size !== 36/);
  assert.match(source, /receiptDigest/);
});

test("live Schema-19 finalizer requires the complete reconciled lifecycle", () => {
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
    assert.match(source, new RegExp(`"${stage}"`));
  }
  assert.match(source, /recoveryBps/);
  assert.match(source, /observationsReset/);
  assert.match(source, /finalBalanceWei/);
});

test("qualified live Testnet manifest is fail-closed Paused", () => {
  assert.match(deploymentFinalizerSource, /liquidityVenue: "uniswap-v4"/);
  assert.match(source, /liquidityVenue: "uniswap-v4"/);
  assert.match(
    indexerSource,
    /Schema-19 manifest must declare the Uniswap v4 liquidity venue/,
  );
  assert.match(source, /launchMode: "Paused"/);
  assert.match(source, /assetConversionsPaused: true/);
  assert.match(source, /feeConversionsPaused: true/);
  assert.match(source, /applicationWritesEnabled: false/);
  assert.match(source, /qualificationPassed: true/);
  assert.match(source, /qualification: \{/);
  assert.match(source, /maintenancePolicy/);
  assert.match(source, /assetCatalog/);
  assert.match(source, /lockedPrincipal: lifecycle\.lockedPrincipal/);
  assert.match(source, /token: lifecycle\.token/);
});

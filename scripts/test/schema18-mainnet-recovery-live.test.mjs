import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runner = await readFile(
  "scripts/run-schema18-mainnet-recovery-live.mjs",
  "utf8",
);
const prepare = await readFile(
  "scripts/prepare-schema18-mainnet-recovery.mjs",
  "utf8",
);
const rehearsal = await readFile(
  "scripts/run-schema18-mainnet-recovery-rehearsal.mjs",
  "utf8",
);

test("Gate 2 recovery runner is exact-release, LAN-only, and separately authorized", () => {
  assert.match(runner, /4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4/);
  assert.match(runner, /8327b250122cd9050a7da6a44e12859e3cf521aa/);
  assert.match(runner, /ROBYN_SCHEMA18_MAINNET_RECOVERY_AUTHORIZED/);
  assert.match(runner, /sealed recovery manifest SHA-256 mismatch/);
  assert.match(runner, /bootstrapFinalizationAuthorized !== false/);
  assert.match(runner, /unanimousRecoveryAuthorized !== false/);
  assert.match(runner, /canaryTransactionsAuthorized !== false/);
  assert.match(runner, /ROBYN_SCHEMA18_MAINNET_RECOVERY_AUTHORIZATION_RECEIPT/);
  assert.match(
    runner,
    /ROBYN_SCHEMA18_MAINNET_RECOVERY_AUTHORIZATION_RECEIPT_SHA256/,
  );
  assert.match(runner, /finalize-bootstrap-through-final-guardian-shutdown/);
  assert.match(runner, /matching protected authorization receipt/);
  assert.match(runner, /publicActivationAuthorized !== false/);
  assert.match(runner, /applicationWritesAuthorized !== false/);
  assert.doesNotMatch(runner, /bootstrap2/);
  assert.doesNotMatch(runner, /alchemy\.com|automaticAlchemyFallback/);
});

test("runner refuses replay, ambiguous nonces, fee drift, and reserve breaches", () => {
  assert.match(runner, /automatic replay is prohibited/);
  assert.match(
    runner,
    /submission is ambiguous; manual reconciliation required/,
  );
  assert.match(runner, /has a pending nonce/);
  assert.match(runner, /exceeds sealed phase gas ceiling/);
  assert.match(runner, /exceeds sealed fee ceiling/);
  assert.match(runner, /would breach the fixed Mainnet reserve/);
  assert.match(runner, /const RESERVE = 20_000_000_000_000_000n/);
});

test("preflight failures are persisted and force shutdown before resume", () => {
  const runStart = runner.indexOf("const run = async () => {");
  const outerTry = runner.lastIndexOf("try {\n  await run();");
  assert.ok(runStart >= 0 && outerTry > runStart);
  assert.ok(runner.indexOf("await assertGateway();", runStart) < outerTry);
  assert.ok(
    runner.indexOf("await assertRuntimeIdentities();", runStart) < outerTry,
  );
  assert.match(runner, /shutdownRequired: true/);
  assert.match(runner, /failedRun: true/);
  assert.match(
    runner,
    /lifecycle is invalidated after a prior failure; use a new manifest and evidence identity/,
  );
  assert.match(runner, /shutdownRequired: false/);
});

test("runner binds bootstrap, claims, recovery, accounting, and shutdown", () => {
  assert.match(
    runner,
    /live bootstrap is not the consumed-step-one recovery state/,
  );
  assert.match(runner, /one-hour recovery Timelock is not complete/);
  for (const action of [
    "finalizeBootstrap",
    "scheduleUnanimous",
    "executeBatch",
    "swapExactNativeForAsset",
    "swapExactAssetForNative",
    "createLaunch",
    "setCreatorFeeSplit",
    "convertTokenFees",
    "claimAll",
    "claimCreatorFees",
    "claimRewards",
    "pauseLaunches",
    "pauseConversions",
    "disableRoute",
  ])
    assert.match(runner, new RegExp(`"${action}"`));
  assert.match(runner, /one-hour reward release is not complete/);
  assert.match(runner, /recovered less than 75%/);
  assert.match(runner, /50\/25\/20\/5 conservation failed/);
  assert.match(runner, /locked principal changed/);
});

test("exact-state rehearsal broadcasts only to Anvil and manifest remains unauthorized", () => {
  assert.match(rehearsal, /--fork-url/);
  assert.match(rehearsal, /127\.0\.0\.1:28619/);
  assert.match(rehearsal, /mainnetTransactionsBroadcast:0/);
  assert.match(rehearsal, /evm_increaseTime/);
  assert.match(prepare, /bootstrapFinalizationAuthorized:false/);
  assert.match(prepare, /unanimousRecoveryAuthorized:false/);
  assert.match(prepare, /canaryTransactionsAuthorized:false/);
  assert.match(prepare, /publicActivationAuthorized:false/);
  assert.match(prepare, /applicationWritesAuthorized:false/);
  assert.match(rehearsal, /authorizationEligible:true/);
  assert.match(prepare, /additionalBridgeAuthorized:false/);
  assert.match(prepare, /bootstrapPlanHash/);
  assert.match(prepare, /Gate 2 funding shortfall/);
});

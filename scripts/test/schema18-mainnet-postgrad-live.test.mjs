import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resumeFundingRequirement } from "../lib/schema18-canary-resume.mjs";

const runner = await readFile(
  "scripts/run-schema18-mainnet-postgrad-live.mjs",
  "utf8",
);
const prepare = await readFile(
  "scripts/prepare-schema18-mainnet-postgrad.mjs",
  "utf8",
);
const rehearsal = await readFile(
  "scripts/run-schema18-mainnet-postgrad-rehearsal.mjs",
  "utf8",
);

test("post-graduation funding preserves reserve and applies 150 percent gas headroom", () => {
  assert.deepEqual(
    resumeFundingRequirement({
      operationalReserveWei: 20_000n,
      exactFinalPurchaseWei: 101n,
      measuredGas: 1_000n,
      maxFeePerGasWei: 2n,
    }),
    {
      gasWithHeadroom: 1_500n,
      gasAllowanceWei: 3_000n,
      requiredBalanceWei: 23_101n,
    },
  );
});

test("post-graduation runner is exact-release, LAN-only, restart-safe, and separately authorized", () => {
  assert.match(runner, /4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4/);
  assert.match(runner, /8327b250122cd9050a7da6a44e12859e3cf521aa/);
  assert.match(runner, /ROBYN_SCHEMA18_MAINNET_POSTGRAD_AUTHORIZED/);
  assert.match(runner, /postgrad-reactivation-through-final-guardian-shutdown/);
  assert.match(runner, /automatic replay is prohibited/);
  assert.match(
    runner,
    /submission is ambiguous; manual reconciliation required/,
  );
  assert.match(runner, /would breach the fixed Mainnet reserve/);
  assert.match(runner, /const RESERVE = 20_000_000_000_000_000n/);
  assert.doesNotMatch(runner, /alchemy\.com|automaticAlchemyFallback/);
});

test("runner binds the graduated Canary and never repeats launch or graduation", () => {
  assert.match(
    runner,
    /graduated Canary state changed from the sealed manifest/,
  );
  assert.match(runner, /graduated Canary profile or locked principal changed/);
  assert.match(runner, /sourceGate2StateSha256/);
  assert.match(
    runner,
    /consumed Gate-2 journal is failed, duplicated, or ambiguous/,
  );
  assert.doesNotMatch(runner, /exact-final-bonding-purchase/);
  assert.doesNotMatch(runner, /create-canary-launch/);
  assert.doesNotMatch(runner, /"graduate",/);
  assert.match(runner, /recovered less than 75%/);
  assert.match(runner, /50\/25\/20\/5 conservation failed/);
  assert.match(runner, /reward backing failed/);
});

test("not-ready Timelock and reward checks are read-only results", () => {
  assert.match(runner, /status: "not-ready"/);
  assert.match(
    rehearsal,
    /early Timelock execution was not a journal-free readiness result/,
  );
  assert.match(
    rehearsal,
    /early reward claim was not a journal-free readiness result/,
  );
  assert.match(rehearsal, /const journalCount = async/);
});

test("rehearsal broadcasts locally without inflating the live fork balance", () => {
  assert.match(rehearsal, /--fork-url/);
  assert.match(rehearsal, /127\.0\.0\.1:28639/);
  assert.match(rehearsal, /mainnetTransactionsBroadcast: 0/);
  assert.match(rehearsal, /anvil_impersonateAccount/);
  assert.doesNotMatch(rehearsal, /anvil_setBalance/);
  assert.match(rehearsal, /evm_increaseTime/);
});

test("sealer binds consumed evidence and retains every unauthorized boundary", () => {
  assert.match(prepare, /sourceGate2: rehearsalInput\.sourceGate2/);
  assert.match(prepare, /live graduated Canary changed after rehearsal/);
  assert.match(prepare, /consumed Gate-2 evidence changed after rehearsal/);
  assert.match(prepare, /additionalBridgeAuthorized: false/);
  assert.match(prepare, /publicActivationAuthorized: false/);
  assert.match(prepare, /applicationWritesAuthorized: false/);
  assert.match(prepare, /post-graduation funding shortfall/);
  assert.doesNotMatch(prepare, /incident/);
});

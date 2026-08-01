import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  exactFinalBondingPurchase,
  resumeFundingRequirement,
} from "../lib/schema18-canary-resume.mjs";

const runner = await readFile(
  "scripts/run-schema18-mainnet-resume-live.mjs",
  "utf8",
);
const prepare = await readFile(
  "scripts/prepare-schema18-mainnet-resume.mjs",
  "utf8",
);
const rehearsal = await readFile(
  "scripts/run-schema18-mainnet-resume-rehearsal.mjs",
  "utf8",
);

test("exact remaining-principal purchase includes the curve fee without a full-cap overbuy", () => {
  assert.equal(
    exactFinalBondingPurchase({
      nativeRaised: 9_900_000_000_000_000n,
      graduationThreshold: 10_000_000_000_000_000n,
      feeBps: 100n,
    }),
    101_010_101_010_102n,
  );
});

test("remaining-principal sizing rejects completed or invalid curves", () => {
  assert.throws(
    () =>
      exactFinalBondingPurchase({
        nativeRaised: 10n,
        graduationThreshold: 10n,
        feeBps: 100n,
      }),
    /threshold must exceed/,
  );
  assert.throws(
    () =>
      exactFinalBondingPurchase({
        nativeRaised: 1n,
        graduationThreshold: 10n,
        feeBps: 10_000n,
      }),
    /fee basis points/,
  );
});

test("funding calculation preserves reserve and applies 150 percent gas headroom", () => {
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

test("resume runner is exact-release, LAN-only, restart-safe, and separately authorized", () => {
  assert.match(runner, /4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4/);
  assert.match(runner, /8327b250122cd9050a7da6a44e12859e3cf521aa/);
  assert.match(runner, /ROBYN_SCHEMA18_MAINNET_RESUME_AUTHORIZED/);
  assert.match(runner, /unanimous-resume-through-final-guardian-shutdown/);
  assert.match(runner, /automatic replay is prohibited/);
  assert.match(
    runner,
    /submission is ambiguous; manual reconciliation required/,
  );
  assert.match(runner, /would breach the fixed Mainnet reserve/);
  assert.match(runner, /const RESERVE = 20_000_000_000_000_000n/);
  assert.doesNotMatch(runner, /alchemy\.com|automaticAlchemyFallback/);
});

test("runner binds the exact incident and performs one exact final bonding purchase", () => {
  assert.match(
    runner,
    /incident bonding state changed from the sealed manifest/,
  );
  assert.match(runner, /exactFinalBondingPurchase/);
  assert.match(runner, /exact-final-bonding-purchase/);
  assert.doesNotMatch(
    runner,
    /while \(!\(await read\(market, marketAbi, "graduated"\)\)\)/,
  );
  assert.doesNotMatch(runner, /create-canary-launch/);
  assert.match(runner, /one-hour recovery Timelock is not complete/);
  assert.match(runner, /one-hour reward release is not complete/);
  assert.match(runner, /recovered less than 75%/);
  assert.match(runner, /50\/25\/20\/5 conservation failed/);
});

test("rehearsal broadcasts locally without inflating the live fork balance", () => {
  assert.match(rehearsal, /--fork-url/);
  assert.match(rehearsal, /127\.0\.0\.1:28629/);
  assert.match(rehearsal, /mainnetTransactionsBroadcast: 0/);
  assert.match(rehearsal, /anvil_impersonateAccount/);
  assert.doesNotMatch(rehearsal, /anvil_setBalance/);
  assert.match(rehearsal, /evm_increaseTime/);
});

test("sealer keeps all unauthorized boundaries and fails closed on funding", () => {
  assert.match(prepare, /additionalBridgeAuthorized: false/);
  assert.match(prepare, /publicActivationAuthorized: false/);
  assert.match(prepare, /applicationWritesAuthorized: false/);
  assert.match(prepare, /Gate 2 resume funding shortfall/);
  assert.match(prepare, /resumeFundingRequirement/);
  assert.match(prepare, /live incident state changed after rehearsal/);
});

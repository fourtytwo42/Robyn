import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runner = await readFile(
  "scripts/run-schema18-mainnet-final-settlement-live.mjs",
  "utf8",
);
const prepare = await readFile(
  "scripts/prepare-schema18-mainnet-final-settlement.mjs",
  "utf8",
);
const rehearsal = await readFile(
  "scripts/run-schema18-mainnet-final-settlement-rehearsal.mjs",
  "utf8",
);

test("final-settlement runner binds exact releases, source evidence, and LAN-only policy", () => {
  assert.match(runner, /4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4/);
  assert.match(runner, /5ea50ed836d81416a7a6a32c8078a864fca28d0b/);
  assert.match(runner, /sourcePostgradSumsRaw/);
  assert.match(runner, /sourcePostgradSummaryRaw/);
  assert.match(runner, /fallbackTrafficAuthorized/);
  assert.match(runner, /automatic replay is prohibited/);
  assert.match(
    runner,
    /submission is ambiguous; manual reconciliation required/,
  );
  assert.match(runner, /const RESERVE = 20_000_000_000_000_000n/);
  assert.doesNotMatch(runner, /alchemy\.com|automaticAlchemyFallback/);
});

test("only exact-state recovery stages are exposed and completed actions are absent", () => {
  for (const stage of [
    "verify",
    "schedule-reactivation",
    "oracle-readiness",
    "execute-reactivation",
    "refresh-start",
    "refresh-finish",
    "post-settle",
    "shutdown",
    "reconcile",
    "status",
  ]) {
    assert.match(runner, new RegExp(`"${stage}"`));
  }
  assert.doesNotMatch(runner, /stage === "claims"/);
  assert.doesNotMatch(runner, /stage === "unwind"/);
  assert.doesNotMatch(runner, /stage === "launch"/);
  assert.doesNotMatch(runner, /stage === "graduate"/);
  assert.doesNotMatch(
    runner,
    /create-canary-launch|exact-final-bonding-purchase/,
  );
});

test("oracle readiness is read-only and enforces history, age, deviation, quote, and reserve", () => {
  assert.match(runner, /"insufficient-history"/);
  assert.match(runner, /"stale-observation"/);
  assert.match(runner, /"spot-twap-deviation"/);
  assert.match(runner, /"twap-window-incomplete"/);
  assert.match(runner, /MAX_OBSERVATION_AGE/);
  assert.match(runner, /MAX_SPOT_TWAP_TICK_DEVIATION/);
  assert.match(runner, /remainingGasAllowanceWei/);
  assert.match(runner, /if \(!readiness\.ready\)/);
  assert.match(rehearsal, /journal-free readiness result/);
});

test("bounded oracle refresh round trip clears balances and allowances", () => {
  assert.match(runner, /oracleRefreshNativeInputWei/);
  assert.match(runner, /oracle-refresh-buy/);
  assert.match(runner, /oracle-refresh-sell/);
  assert.match(runner, /quoteExactInputSingle/);
  assert.match(runner, /\(quote\[0\] \* 99n\) \/ 100n/);
  assert.match(runner, /oracle-refresh-router-clear/);
  assert.match(runner, /oracle-refresh-token-clear/);
  assert.match(runner, /round trip left tokens or allowances/);
});

test("exact-state rehearsal uses a LAN-sourced local fork and never broadcasts Mainnet", () => {
  assert.match(rehearsal, /--fork-url/);
  assert.match(rehearsal, /127\.0\.0\.1:28640/);
  assert.match(rehearsal, /anvil_impersonateAccount/);
  assert.match(rehearsal, /evm_increaseTime/);
  assert.match(rehearsal, /mainnetTransactionsBroadcast: 0/);
  assert.doesNotMatch(rehearsal, /anvil_setBalance/);
  assert.match(
    rehearsal,
    /early oracle probe was not a journal-free readiness result/,
  );
});

test("manifest sealer binds receipt-derived ceilings and keeps every broadcast boundary unauthorized", () => {
  assert.match(prepare, /"oracle-refresh"/);
  assert.match(prepare, /"final-settlement"/);
  assert.match(prepare, /oracleRefreshNativeInputWei/);
  assert.match(prepare, /remainingGasAllowanceWei/);
  assert.match(
    prepare,
    /consumed post-unwind evidence changed after rehearsal/,
  );
  assert.match(prepare, /additionalBridgeAuthorized: false/);
  assert.match(prepare, /unanimousRecoveryAuthorized: false/);
  assert.match(prepare, /publicActivationAuthorized: false/);
  assert.match(prepare, /applicationWritesAuthorized: false/);
});

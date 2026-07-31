import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "scripts/recover-failed-endurance-bonding.mjs",
  "utf8",
);

test("bonding recovery is bounded, project-only, and restart-safe", () => {
  assert.match(source, /failedRun\.failed !== true/);
  assert.match(source, /failedRun\.completed === true/);
  assert.match(source, /Bonding recovery refuses ambiguous run transactions/);
  assert.match(source, /malformedExpectedFailures/);
  assert.match(source, /entry\.expectedFailure === true/);
  assert.match(source, /getTransactionReceipt/);
  assert.match(source, /receipt-rpc-url/);
  assert.match(source, /retainedGraduatedLaunches/);
  assert.match(source, /minimumOutputBps/);
  assert.match(source, /quote-does-not-cover-conservative-gas/);
  assert.match(source, /5_000_000n \* economicFeeEnvelope\.maxFeePerGas/);
  assert.match(source, /quotedNativeOutput \* minimumOutputBps/);
  assert.match(source, /simulateContract/);
  assert.match(source, /transactionFundingTarget/);
  assert.match(source, /transactionFundingShortfall/);
  assert.match(source, /estimatedGas: 2_000_000n/);
  assert.match(source, /preparedOverride/);
  assert.match(source, /ENDURANCE_RESERVE_WEI/);
  assert.match(source, /would breach the project reserve/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /status: "prepared"/);
  assert.match(source, /Prepared recovery transaction identity mismatch/);
  assert.match(source, /unbroadcast-fee-envelope-refresh/);
  assert.match(source, /supersededPreparations/);
  assert.match(source, /if \(!entry\)/);
  assert.match(source, /status = "submitted"/);
  assert.match(source, /status = "confirmed"/);
  assert.match(source, /remainingTokenBalance !== 0n/);
  assert.match(source, /remainingAllowance !== 0n/);
  assert.match(source, /resumedAfterConfirmedSell/);
  assert.match(source, /sweepRecoveredNative/);
  assert.match(source, /receipt\.effectiveGasPrice/);
  assert.doesNotMatch(source, /privateKey.*console|console.*privateKey/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "scripts/recover-failed-endurance-funding.mjs",
  "utf8",
);

test("failed endurance funding recovery is fail-closed and journaled", () => {
  assert.match(source, /failedRun\.failed !== true/);
  assert.match(source, /allow-incomplete-history/);
  assert.match(source, /incompleteHistoryIsEligible/);
  assert.match(source, /failedRun\.completed !== true/);
  assert.match(source, /failedRun\.terminalFailure/);
  assert.match(source, /healthySeconds !== 0 && !incompleteHistoryIsEligible/);
  assert.match(source, /hasGraduationHistory && !incompleteHistoryIsEligible/);
  assert.match(source, /failedRun\.enduranceLaunches \?\? \[\]/);
  assert.match(source, /allow-bonding-history/);
  assert.match(source, /Incomplete-history recovery also requires/);
  assert.match(source, /hasGraduationHistory/);
  assert.match(source, /bondingHistoryRecovery/);
  assert.match(source, /incompleteHistoryRecovery/);
  assert.match(source, /graduationHistoryRecovery/);
  assert.match(source, /graduationTransactions/);
  assert.match(source, /originalHealthySeconds/);
  assert.match(source, /retainedLaunches/);
  assert.match(source, /failedRunStateSha256/);
  assert.match(source, /status: "submitted"/);
  assert.match(source, /status = "confirmed"/);
  assert.match(source, /getTransactionReceipt/);
  assert.match(source, /retryCount: 0/);
  assert.match(source, /recover-rdao-/);
  assert.match(source, /recover-native-/);
  assert.doesNotMatch(source, /privateKey.*console|console.*privateKey/);
});

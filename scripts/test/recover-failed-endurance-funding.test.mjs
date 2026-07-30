import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "scripts/recover-failed-endurance-funding.mjs",
  "utf8",
);

test("failed endurance funding recovery is fail-closed and journaled", () => {
  assert.match(source, /failedRun\.failed !== true/);
  assert.match(source, /Number\(failedRun\.healthySeconds \?\? 0\) !== 0/);
  assert.match(source, /failedRun\.enduranceLaunches\?\.length \?\? 0/);
  assert.match(source, /failedRunStateSha256/);
  assert.match(source, /status: "submitted"/);
  assert.match(source, /status = "confirmed"/);
  assert.match(source, /getTransactionReceipt/);
  assert.match(source, /retryCount: 0/);
  assert.match(source, /recover-rdao-/);
  assert.match(source, /recover-native-/);
  assert.doesNotMatch(source, /privateKey.*console|console.*privateKey/);
});

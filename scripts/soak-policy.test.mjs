import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProcessContinuity,
  isRetryableNonceError,
  maximumCreatedLaunches,
  processRestartChanges,
  realisticSoakSymbol,
  shouldCreateLaunch,
  shouldGraduateLaunch,
} from "./soak-policy.mjs";

const baseline = [
  { name: "robyn-web", restartCount: 0 },
  { name: "robyn-keeper", restartCount: 0 },
];

test("accepts unchanged per-process restart counters", () => {
  assert.deepEqual(processRestartChanges(baseline, structuredClone(baseline)), []);
  assert.doesNotThrow(() =>
    assertProcessContinuity(baseline, structuredClone(baseline)),
  );
});

test("rejects a restart immediately even when every process is online", () => {
  const current = [
    { name: "robyn-web", restartCount: 0 },
    { name: "robyn-keeper", restartCount: 1 },
  ];
  assert.throws(
    () => assertProcessContinuity(baseline, current),
    /robyn-keeper restarts changed 0 -> 1/,
  );
});

test("rejects PM2 process replacement that resets or changes membership", () => {
  assert.throws(
    () =>
      assertProcessContinuity(
        [
          { name: "robyn-web", restartCount: 3 },
          { name: "robyn-keeper", restartCount: 2 },
        ],
        [
          { name: "robyn-web", restartCount: 0 },
          { name: "robyn-api", restartCount: 0 },
        ],
      ),
    /robyn-web restarts changed 3 -> 0; robyn-keeper disappeared; robyn-api appeared/,
  );
});

test("only retries explicit pre-broadcast nonce contention", () => {
  assert.equal(isRetryableNonceError(new Error("nonce too low")), true);
  assert.equal(
    isRetryableNonceError(new Error("nonce has already been used")),
    true,
  );
  assert.equal(
    isRetryableNonceError(new Error("replacement transaction underpriced")),
    true,
  );
  assert.equal(isRetryableNonceError(new Error("execution reverted")), false);
  assert.equal(isRetryableNonceError(new Error("request timed out")), false);
});

test("schedules bounded realistic launch and graduation lifecycles", () => {
  assert.equal(shouldCreateLaunch(3, 4), false);
  assert.equal(shouldCreateLaunch(4, 4), true);
  assert.equal(shouldCreateLaunch(8, 4), true);
  assert.equal(shouldGraduateLaunch(1, 2), false);
  assert.equal(shouldGraduateLaunch(2, 2), true);
  assert.equal(maximumCreatedLaunches(8 * 60 * 60, 30, 10, 4), 23);
});

test("creates valid deterministic display symbols without reusing salts", () => {
  assert.equal(realisticSoakSymbol(1), "R0001");
  assert.equal(realisticSoakSymbol(35), "R000Z");
  assert.match(realisticSoakSymbol(36), /^[A-Z0-9]{2,8}$/);
  assert.throws(() => realisticSoakSymbol(0), /positive integer/);
});

test("rejects invalid realistic workload policy values", () => {
  assert.throws(() => shouldCreateLaunch(0, 4), /positive integer/);
  assert.throws(() => shouldGraduateLaunch(1, 0), /positive integer/);
  assert.throws(
    () => maximumCreatedLaunches(0, 30, 10, 4),
    /must be positive/,
  );
});

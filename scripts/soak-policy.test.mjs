import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProcessContinuity,
  processRestartChanges,
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

import assert from "node:assert/strict";
import test from "node:test";
import {
  accumulatedHealthySeconds,
  diskHeadroomPass,
  dueCount,
  dueLaunchCount,
  isRetryablePublicRpcError,
  percentile,
} from "../testnet-endurance-policy.mjs";

test("healthy duration excludes failed samples", () => {
  assert.equal(
    accumulatedHealthySeconds(
      { sampledAtMs: 1_000, healthySeconds: 10 },
      31_000,
      true,
    ),
    40,
  );
  assert.equal(
    accumulatedHealthySeconds(
      { sampledAtMs: 1_000, healthySeconds: 10 },
      31_000,
      false,
    ),
    10,
  );
});

test("launch and cadence thresholds are deterministic", () => {
  assert.equal(dueCount(0, 600), 1);
  assert.equal(dueCount(1_199, 600), 2);
  assert.equal(dueLaunchCount(0), 1);
  assert.equal(dueLaunchCount(7_199), 1);
  assert.equal(dueLaunchCount(21_600), 4);
});

test("disk gate requires bytes and percentage", () => {
  assert.equal(
    diskHeadroomPass(13n * 1024n ** 3n, 61n * 1024n ** 3n).passed,
    true,
  );
  assert.equal(
    diskHeadroomPass(11n * 1024n ** 3n, 61n * 1024n ** 3n).passed,
    false,
  );
  assert.equal(
    diskHeadroomPass(13n * 1024n ** 3n, 100n * 1024n ** 3n).passed,
    false,
  );
});

test("RPC retry classification and p95 are bounded", () => {
  assert.equal(
    isRetryablePublicRpcError(new Error("HTTP 429 rate limit")),
    true,
  );
  assert.equal(
    isRetryablePublicRpcError(new Error("execution reverted")),
    false,
  );
  assert.equal(percentile([10, 20, 30, 40, 50], 0.95), 50);
});

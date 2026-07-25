import assert from "node:assert/strict";
import test from "node:test";
import {
  accumulatedHealthySeconds,
  diskHeadroomPass,
  dueCount,
  dueLaunchCount,
  isRetryablePublicRpcError,
  percentile,
  processContinuityFailures,
  reconcileReleaseIdentity,
  rewardClaimIndexes,
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

test("holder rewards are queried by canonical asset index", () => {
  assert.deepEqual(rewardClaimIndexes(3), [0n, 1n, 2n]);
  assert.throws(() => rewardClaimIndexes(-1), /non-negative safe integer/);
});

test("same-deployment release repair resumes the durable journal", () => {
  const state = {
    runId: "run-1",
    releaseSha: "old",
    deploymentManifestSha256: "manifest",
    healthySeconds: 0,
    transactions: [{ hash: "0x1" }],
    paused: false,
    baselineProcesses: [{ name: "old-release-process" }],
  };
  const repaired = reconcileReleaseIdentity(state, {
    runId: "run-1",
    releaseSha: "new",
    deploymentManifestSha256: "manifest",
    migratedAt: "2026-07-25T00:00:00Z",
  });
  assert.equal(repaired.releaseSha, "new");
  assert.equal(repaired.paused, true);
  assert.equal(repaired.transactions.length, 1);
  assert.equal(repaired.baselineProcesses, undefined);
  assert.deepEqual(repaired.releaseTransitions, [
    {
      fromReleaseSha: "old",
      toReleaseSha: "new",
      migratedAt: "2026-07-25T00:00:00Z",
      healthySeconds: 0,
      transactionCount: 1,
    },
  ]);
  assert.throws(
    () =>
      reconcileReleaseIdentity(state, {
        runId: "other",
        releaseSha: "new",
        deploymentManifestSha256: "manifest",
        migratedAt: "2026-07-25T00:00:00Z",
      }),
    /identity does not match/,
  );
});

test("PM2 continuity preserves each process-specific working directory", () => {
  const baseline = [
    {
      name: "robyn-web-testnet",
      status: "online",
      restarts: 0,
      cwd: "/release/apps/web",
    },
    {
      name: "robyn-api-testnet",
      status: "online",
      restarts: 0,
      cwd: "/release",
    },
  ];
  assert.deepEqual(processContinuityFailures(baseline, baseline), []);
  assert.deepEqual(
    processContinuityFailures(baseline, [
      baseline[0],
      { ...baseline[1], restarts: 1 },
    ]),
    ["PM2 continuity failed for robyn-api-testnet"],
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  accumulatedHealthySeconds,
  diskHeadroomPass,
  enduranceCoverageFailures,
  dueCount,
  dueLaunchCount,
  enduranceSamplePassed,
  isApprovedTestnetRpcUrl,
  isRetryablePublicRpcError,
  percentile,
  processContinuityFailures,
  reconcileReleaseIdentity,
  rewardClaimIndexes,
  boundedTerminalCurveBuyValue,
  terminalCurveBuyValue,
  transactionFundingTarget,
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
test("approved testnet RPC allowlist rejects arbitrary endpoints", () => {
  assert.equal(
    isApprovedTestnetRpcUrl("https://rpc.testnet.chain.robinhood.com"),
    true,
  );
  assert.equal(isApprovedTestnetRpcUrl("http://192.168.50.117:8547"), true);
  assert.equal(isApprovedTestnetRpcUrl("http://127.0.0.1:8545"), false);
  assert.equal(isApprovedTestnetRpcUrl("https://attacker.invalid"), false);
});

test("holder rewards are queried by canonical asset index", () => {
  assert.deepEqual(rewardClaimIndexes(3), [0n, 1n, 2n]);
  assert.throws(() => rewardClaimIndexes(-1), /non-negative safe integer/);
});

test("terminal curve buy exhausts the remaining inventory", () => {
  assert.equal(
    terminalCurveBuyValue({
      virtualTokenReserve: 552_763_819_095_477_386_934_673_367n,
      virtualNativeReserve: 995_000_000_000_000n,
      realCurveTokenReserve: 252_763_819_095_477_386_934_673_367n,
      feeBps: 100n,
    }),
    846_801_346_801_348n,
  );
  assert.throws(
    () =>
      terminalCurveBuyValue({
        virtualTokenReserve: 100n,
        virtualNativeReserve: 100n,
        realCurveTokenReserve: 100n,
        feeBps: 100n,
      }),
    /invalid/,
  );
});

test("terminal curve buy is bounded by the immutable market cap", () => {
  const state = {
    virtualTokenReserve: 552_763_819_095_477_386_934_673_367n,
    virtualNativeReserve: 995_000_000_000_000n,
    realCurveTokenReserve: 252_763_819_095_477_386_934_673_367n,
    feeBps: 100n,
  };
  assert.equal(
    boundedTerminalCurveBuyValue({
      ...state,
      maximumCurvePurchase: 250_000_000_000_000n,
    }),
    250_000_000_000_000n,
  );
  assert.equal(
    boundedTerminalCurveBuyValue({
      ...state,
      maximumCurvePurchase: 1_000_000_000_000_000n,
    }),
    terminalCurveBuyValue(state),
  );
  assert.throws(
    () =>
      boundedTerminalCurveBuyValue({
        ...state,
        maximumCurvePurchase: 0n,
      }),
    /must be positive/,
  );
});

test("final endurance coverage requires every schema-v9 lifecycle action", () => {
  const complete = {
    enduranceLaunches: [{}, {}, {}, {}],
    transactions: [
      { label: "endurance-graduate-0-a" },
      { label: "endurance-graduate-1-b" },
      { label: "endurance-v4-buy-1" },
      { label: "endurance-v4-sell-1" },
      { label: "endurance-lp-harvest-token-1" },
      { label: "endurance-hook-native-token-1" },
      { label: "endurance-hook-token-token-1" },
      { label: "endurance-holder-claim-1" },
      { label: "endurance-creator-claim-token-1" },
      { label: "endurance-rdao-claim-1" },
      { label: "endurance-governance-execute" },
    ],
  };
  assert.deepEqual(enduranceCoverageFailures(complete), []);
  assert.match(
    enduranceCoverageFailures({
      ...complete,
      transactions: complete.transactions.filter(
        ({ label }) => !label.startsWith("endurance-hook-token-"),
      ),
    }).join(" "),
    /launch-token hook-fee conversion/,
  );
});

test("transaction funding includes dynamic EIP-1559 fee headroom", () => {
  assert.equal(
    transactionFundingTarget({
      valueWei: 1_000n,
      estimatedGas: 100n,
      maxFeePerGas: 12n,
    }),
    2_875n,
  );
  assert.throws(
    () =>
      transactionFundingTarget({
        valueWei: 0n,
        estimatedGas: 0n,
        maxFeePerGas: 12n,
      }),
    /invalid/,
  );
});

test("unresolved workload failures keep passing infrastructure paused", () => {
  assert.equal(enduranceSamplePassed(true, undefined), true);
  assert.equal(
    enduranceSamplePassed(true, { message: "graduation incomplete" }),
    false,
  );
  assert.equal(enduranceSamplePassed(false, undefined), false);
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

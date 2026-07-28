import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  accumulatedHealthySeconds,
  diskHeadroomPass,
  enduranceCoverageFailures,
  dueCount,
  dueLaunchCount,
  enduranceRelevantFiringAlerts,
  enduranceSamplePassed,
  isApprovedTestnetRpcUrl,
  isRetryablePublicRpcError,
  percentile,
  processContinuityFailures,
  reconcileReleaseIdentity,
  protocolHealthFailures,
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
  assert.equal(dueCount(0, 300), 1);
  assert.equal(dueCount(599, 300), 2);
  assert.equal(dueLaunchCount(0), 1);
  assert.equal(dueLaunchCount(899), 1);
  assert.equal(dueLaunchCount(900), 2);
  assert.equal(dueLaunchCount(6_300), 8);
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
test("approved testnet RPC policy requires protected Alchemy HTTPS", () => {
  assert.equal(
    isApprovedTestnetRpcUrl(
      "https://robinhood-testnet.g.alchemy.com/v2/protected_key-1",
    ),
    true,
  );
  assert.equal(
    isApprovedTestnetRpcUrl("https://rpc.testnet.chain.robinhood.com"),
    false,
  );
  assert.equal(isApprovedTestnetRpcUrl("http://192.168.50.117:8547"), false);
  assert.equal(
    isApprovedTestnetRpcUrl("https://attacker.invalid/v2/key"),
    false,
  );
});

test("testnet endurance excludes explicitly mainnet-only alerts", () => {
  assert.deepEqual(
    enduranceRelevantFiringAlerts([
      {
        state: "firing",
        labels: { alertname: "RobinhoodMainnetHeadLagHigh" },
      },
      {
        state: "firing",
        labels: { alertname: "RpcHeadLagHigh", chain_id: "4663" },
      },
      {
        state: "firing",
        labels: { alertname: "TestnetProjectionLagHigh", chain_id: "46630" },
      },
      {
        state: "firing",
        labels: { alertname: "RobynApiUnavailable" },
      },
      {
        state: "pending",
        labels: { alertname: "TestnetPendingAlert", chain_id: "46630" },
      },
    ]),
    ["TestnetProjectionLagHigh", "RobynApiUnavailable"],
  );
  assert.deepEqual(enduranceRelevantFiringAlerts(null), []);
});

test("runner is fixed to one uninterrupted two-hour release gate", () => {
  const source = readFileSync(
    new URL("../testnet-endurance.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /targetHealthySeconds:\s*ENDURANCE_DURATION_SECONDS/);
  assert.match(source, /mode:\s*"uninterrupted"/);
  assert.match(source, /terminalFailure/);
  assert.match(source, /dueLaunchCount\(state\.healthySeconds\)/);
  assert.doesNotMatch(source, /ROBYN_ENDURANCE_DURATION/);
  assert.doesNotMatch(source, /accumulated healthy/i);
  assert.match(source, /status\.observedHeadBlock \?\? status\.asOfBlock/);
  assert.match(source, /readinessPasses < 2/);
  assert.match(source, /phase: readiness \? "readiness" : "endurance"/);
});

test("pre-clock readiness tolerates an empty ingestion-lag history", () => {
  const source = readFileSync(
    new URL("../testnet-endurance.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const ingestionLagSamples = state\.ingestionLagSamples \?\? \[\]/,
  );
  assert.match(source, /ingestionLagSamples\.length >= 20/);
  assert.doesNotMatch(source, /state\.ingestionLagSamples\.length >= 20/);
});

test("advanced fee probes use runnable one-shot maintenance cycles", () => {
  const source = readFileSync(
    new URL("../testnet-endurance.mjs", import.meta.url),
    "utf8",
  );
  for (const cycle of [6000, 6006, 6012]) {
    assert.equal(cycle % 6, 0);
    assert.match(
      source,
      new RegExp(`maintainGraduatedFees\\([^\\n]+${cycle}\\)`),
    );
  }
  assert.match(source, /firstFeesMaintained/);
  assert.match(source, /secondFeesMaintained/);
  assert.match(source, /thirdFeesMaintained/);
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

test("final endurance coverage requires the schema-11 two-hour lifecycle", () => {
  const assets = Array.from(
    { length: 24 },
    (_, index) => `0x${index.toString(16).padStart(40, "0")}`,
  );
  const requiredLabels = [
    "endurance-v4-buy-1",
    "endurance-v4-sell-1",
    "endurance-lp-harvest-token-1",
    "endurance-hook-native-token-1",
    "endurance-hook-token-token-1",
    "endurance-holder-claim-1",
    "endurance-creator-claim-token-1",
    "endurance-rdao-claim-1",
    "endurance-governance-execute",
    "endurance-universal-exact-in-buy-1",
    "endurance-universal-exact-in-sell-1",
    "endurance-universal-exact-out-buy-1",
    "endurance-universal-exact-out-sell-1",
    "endurance-external-liquidity-full-1",
    "endurance-external-liquidity-concentrated-1",
    "endurance-pregraduation-swap-rejected-1",
    "endurance-pregraduation-liquidity-rejected-1",
    "endurance-pregraduation-donation-rejected-1",
    "endurance-stream-claim-10-1",
    "endurance-stream-claim-30-1",
    "endurance-stream-claim-59-1",
    "endurance-stream-claim-60-1",
    "endurance-creator-split-open-1",
    "endurance-creator-split-update-1",
    "endurance-creator-split-lock-1",
    "endurance-creator-claim-to-1",
    "endurance-creator-batch-claim-1",
    "endurance-creator-batch-claim-to-1",
  ];
  const complete = {
    requiredRewardAssets: assets,
    enduranceLaunches: Array.from({ length: 8 }, (_, index) => ({
      assets: assets.slice(index * 3, index * 3 + 3),
    })),
    transactions: [
      { label: "endurance-graduate-0-a" },
      { label: "endurance-graduate-1-b" },
      { label: "endurance-graduate-2-c" },
      ...requiredLabels.map((label) => ({ label })),
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
      additionalFeeReserveWei: 500n,
    }),
    3_375n,
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
  assert.throws(
    () =>
      transactionFundingTarget({
        valueWei: 0n,
        estimatedGas: 100n,
        maxFeePerGas: 12n,
        additionalFeeReserveWei: -1n,
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

test("protocol health gate rejects every conservation mismatch", () => {
  const healthy = {
    status: "ok",
    routerSolvent: true,
    daoStreamConserved: true,
    creatorStreamConserved: true,
    phaseMismatchCount: 0,
    lockerMismatchCount: 0,
    rewardStreamMismatchCount: 0,
    unattributedNative: "0",
  };
  assert.deepEqual(protocolHealthFailures(healthy), []);
  assert.match(
    protocolHealthFailures({
      ...healthy,
      status: "degraded",
      rewardStreamMismatchCount: 1,
    }).join(" "),
    /status is not ok.*reward stream mismatch count is 1/,
  );
  assert.match(
    protocolHealthFailures({
      ...healthy,
      routerSolvent: false,
      daoStreamConserved: false,
      creatorStreamConserved: false,
      phaseMismatchCount: 1,
      lockerMismatchCount: 2,
      unattributedNative: "1",
    }).join(" "),
    /router is insolvent.*DAO reward stream.*pool phase.*locker accounting.*unattributed native/,
  );
  assert.deepEqual(protocolHealthFailures(undefined), [
    "protocol invariant snapshot is unavailable",
  ]);
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

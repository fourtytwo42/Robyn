export const ENDURANCE_DURATION_SECONDS = 10 * 60 * 60;
const APPROVED_TESTNET_RPC_URLS = new Set([
  "https://rpc.testnet.chain.robinhood.com",
]);

export const isApprovedTestnetRpcUrl = (url) => APPROVED_TESTNET_RPC_URLS.has(url);

export const ENDURANCE_SAMPLE_INTERVAL_SECONDS = 30;
export const ENDURANCE_WRITE_INTERVAL_SECONDS = 10 * 60;
export const ENDURANCE_REVIEW_INTERVAL_SECONDS = 20 * 60;
export const ENDURANCE_LAUNCH_THRESHOLDS_SECONDS = [
  0,
  2.5 * 60 * 60,
  5 * 60 * 60,
  7.5 * 60 * 60,
];
export const ENDURANCE_RESERVE_WEI = 1_500_000_000_000_000n;
export const ENDURANCE_L1_DATA_FEE_RESERVE_WEI = 25_000_000_000_000n;
export const ENDURANCE_MINIMUM_DISK_BYTES = 12n * 1024n * 1024n * 1024n;
export const ENDURANCE_MINIMUM_DISK_PERCENT = 15;
export const ENDURANCE_MINIMUM_MEMORY_BYTES = 1024n * 1024n * 1024n;
export const ENDURANCE_MAXIMUM_API_P95_MS = 750;

export function dueCount(healthySeconds, intervalSeconds) {
  if (!Number.isFinite(healthySeconds) || healthySeconds < 0 || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error("Endurance timing values are invalid");
  }
  return Math.floor(healthySeconds / intervalSeconds) + 1;
}

export function dueLaunchCount(healthySeconds) {
  return ENDURANCE_LAUNCH_THRESHOLDS_SECONDS.filter((threshold) => healthySeconds >= threshold).length;
}

export function rewardClaimIndexes(rewardCount) {
  if (!Number.isSafeInteger(rewardCount) || rewardCount < 0) {
    throw new Error("rewardCount must be a non-negative safe integer");
  }
  return Array.from({ length: rewardCount }, (_, index) => BigInt(index));
}

function ceilDiv(value, divisor) {
  return (value + divisor - 1n) / divisor;
}

export function transactionFundingTarget({
  valueWei,
  estimatedGas,
  maxFeePerGas,
  additionalFeeReserveWei = 0n,
}) {
  if (
    valueWei < 0n ||
    estimatedGas <= 0n ||
    maxFeePerGas <= 0n ||
    additionalFeeReserveWei < 0n
  ) {
    throw new Error("Transaction funding values are invalid");
  }
  const bps = 10_000n;
  const headroomBps = 2_500n;
  const gasLimit =
    estimatedGas + ceilDiv(estimatedGas * headroomBps, bps);
  const feeReserve = gasLimit * maxFeePerGas;
  const bufferedFeeReserve =
    feeReserve + ceilDiv(feeReserve * headroomBps, bps);
  return valueWei + bufferedFeeReserve + additionalFeeReserveWei;
}

export function terminalCurveBuyValue({
  virtualTokenReserve,
  virtualNativeReserve,
  realCurveTokenReserve,
  feeBps,
}) {
  const bps = 10_000n;
  if (
    virtualTokenReserve <= 0n ||
    virtualNativeReserve <= 0n ||
    realCurveTokenReserve <= 0n ||
    realCurveTokenReserve >= virtualTokenReserve ||
    feeBps <= 0n ||
    feeBps >= bps
  ) {
    throw new Error("Terminal curve state is invalid");
  }
  const terminalVirtualTokenReserve =
    virtualTokenReserve - realCurveTokenReserve;
  const invariant = virtualNativeReserve * virtualTokenReserve;
  const terminalVirtualNativeReserve = ceilDiv(
    invariant,
    terminalVirtualTokenReserve,
  );
  const requiredNet =
    terminalVirtualNativeReserve - virtualNativeReserve;
  return ceilDiv(requiredNet * bps, bps - feeBps);
}

export function boundedTerminalCurveBuyValue(curveState) {
  const { maximumCurvePurchase } = curveState;
  if (typeof maximumCurvePurchase !== "bigint" || maximumCurvePurchase <= 0n) {
    throw new Error("Maximum curve purchase must be positive");
  }
  const terminal = terminalCurveBuyValue(curveState);
  return terminal < maximumCurvePurchase ? terminal : maximumCurvePurchase;
}

export function enduranceSamplePassed(
  infrastructurePassed,
  workloadFailure,
) {
  return infrastructurePassed && !workloadFailure;
}

export function protocolHealthFailures(protocol) {
  if (!protocol || typeof protocol !== "object") {
    return ["protocol invariant snapshot is unavailable"];
  }
  const failures = [];
  if (protocol.status !== "ok") {
    failures.push("protocol invariant status is not ok");
  }
  if (protocol.routerSolvent !== true) {
    failures.push("protocol router is insolvent");
  }
  if (protocol.daoStreamConserved !== true) {
    failures.push("DAO reward stream is not conserved");
  }
  for (const [field, description] of [
    ["phaseMismatchCount", "pool phase"],
    ["lockerMismatchCount", "locker accounting"],
    ["rewardStreamMismatchCount", "reward stream"],
  ]) {
    const count = Number(protocol[field]);
    if (!Number.isSafeInteger(count) || count !== 0) {
      failures.push(`${description} mismatch count is ${protocol[field]}`);
    }
  }
  if (BigInt(protocol.unattributedNative ?? "-1") !== 0n) {
    failures.push("protocol has unattributed native balance");
  }
  return failures;
}

export function enduranceCoverageFailures(state) {
  const labels = (state.transactions ?? []).map(({ label }) => label);
  const has = (prefix) => labels.some((label) => label.startsWith(prefix));
  const failures = [];
  if ((state.enduranceLaunches?.length ?? 0) < 4) {
    failures.push("fewer than four endurance launches");
  }
  for (const index of [0, 1]) {
    if (!has(`endurance-graduate-${index}-`)) {
      failures.push(`endurance launch ${index} did not graduate`);
    }
  }
  for (const [prefix, description] of [
    ["endurance-v4-buy-", "post-graduation v4 buy"],
    ["endurance-v4-sell-", "post-graduation v4 sell"],
    ["endurance-lp-harvest-", "locked-position fee harvest"],
    ["endurance-hook-native-", "native hook-fee settlement"],
    ["endurance-hook-token-", "launch-token hook-fee conversion"],
    ["endurance-holder-claim-", "holder reward claim"],
    ["endurance-creator-claim-", "creator reward claim"],
    ["endurance-rdao-claim-", "governance-holder reward claim"],
    ["endurance-governance-execute", "governance execution"],
  ]) {
    if (!has(prefix)) failures.push(`missing ${description}`);
  }
  return failures;
}

export function reconcileReleaseIdentity(state, expected) {
  if (
    state.runId !== expected.runId ||
    state.deploymentManifestSha256 !== expected.deploymentManifestSha256
  ) {
    throw new Error("Existing endurance state identity does not match");
  }
  if (state.releaseSha === expected.releaseSha) return state;
  return {
    ...state,
    releaseSha: expected.releaseSha,
    paused: true,
    baselineProcesses: undefined,
    releaseTransitions: [
      ...(state.releaseTransitions ?? []),
      {
        fromReleaseSha: state.releaseSha,
        toReleaseSha: expected.releaseSha,
        migratedAt: expected.migratedAt,
        healthySeconds: state.healthySeconds,
        transactionCount: state.transactions.length,
      },
    ],
  };
}

export function processContinuityFailures(baseline, currentProcesses) {
  return baseline.flatMap((prior) => {
    const current = currentProcesses.find((entry) => entry.name === prior.name);
    return !current ||
      current.status !== "online" ||
      current.restarts !== prior.restarts ||
      current.cwd !== prior.cwd
      ? [`PM2 continuity failed for ${prior.name}`]
      : [];
  });
}

export function diskHeadroomPass(availableBytes, totalBytes) {
  if (availableBytes < 0n || totalBytes <= 0n || availableBytes > totalBytes) throw new Error("Disk values are invalid");
  const percent = Number((availableBytes * 10_000n) / totalBytes) / 100;
  return {
    availablePercent: percent,
    passed: availableBytes >= ENDURANCE_MINIMUM_DISK_BYTES && percent >= ENDURANCE_MINIMUM_DISK_PERCENT,
  };
}

export function percentile(values, percentileValue) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  if (percentileValue <= 0 || percentileValue > 1) throw new Error("Percentile must be in (0,1]");
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * percentileValue) - 1];
}

export function isRetryablePublicRpcError(error) {
  const message = String(error?.shortMessage ?? error?.message ?? error);
  return /429|rate.?limit|timeout|timed out|temporar|missing block|header not found|connection|socket|fetch failed|503|502|504/i.test(message);
}

export function accumulatedHealthySeconds(previous, sampledAtMs, samplePassed) {
  if (!previous || !Number.isFinite(previous.sampledAtMs) || !Number.isFinite(previous.healthySeconds)) {
    return samplePassed ? 0 : 0;
  }
  if (!Number.isFinite(sampledAtMs) || sampledAtMs < previous.sampledAtMs) throw new Error("Sample time moved backward");
  if (!samplePassed) return previous.healthySeconds;
  return previous.healthySeconds + (sampledAtMs - previous.sampledAtMs) / 1000;
}

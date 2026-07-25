export const ENDURANCE_DURATION_SECONDS = 8 * 60 * 60;
export const ENDURANCE_SAMPLE_INTERVAL_SECONDS = 30;
export const ENDURANCE_WRITE_INTERVAL_SECONDS = 10 * 60;
export const ENDURANCE_REVIEW_INTERVAL_SECONDS = 20 * 60;
export const ENDURANCE_LAUNCH_THRESHOLDS_SECONDS = [0, 2 * 60 * 60, 4 * 60 * 60, 6 * 60 * 60];
export const ENDURANCE_RESERVE_WEI = 1_500_000_000_000_000n;
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

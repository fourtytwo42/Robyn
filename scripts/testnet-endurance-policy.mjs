export const ENDURANCE_DURATION_SECONDS = 2 * 60 * 60;
export const isApprovedTestnetRpcUrl = (value) => {
  try {
    const url = new URL(value);
    if (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port === "18548" &&
      url.pathname === "/"
    ) {
      return true;
    }
    return (
      url.protocol === "https:" &&
      url.hostname === "robinhood-testnet.g.alchemy.com" &&
      /^\/v2\/[A-Za-z0-9_-]+$/.test(url.pathname)
    );
  } catch {
    return false;
  }
};

export function enduranceRelevantFiringAlerts(alerts) {
  if (!Array.isArray(alerts)) return [];
  return alerts
    .filter((entry) => entry?.state === "firing")
    .filter((entry) => {
      const name = String(entry?.labels?.alertname ?? "");
      const chainId = String(entry?.labels?.chain_id ?? "");
      return (
        name.length > 0 &&
        chainId !== "4663" &&
        !name.startsWith("RobinhoodMainnet")
      );
    })
    .map((entry) => entry.labels.alertname);
}

export const ENDURANCE_SAMPLE_INTERVAL_SECONDS = 30;
export const ENDURANCE_WRITE_INTERVAL_SECONDS = 5 * 60;
export const ENDURANCE_REVIEW_INTERVAL_SECONDS = 20 * 60;
export const ENDURANCE_LAUNCH_THRESHOLDS_SECONDS = [
  0,
  15 * 60,
  30 * 60,
  45 * 60,
  60 * 60,
  75 * 60,
  90 * 60,
  105 * 60,
];
export const ENDURANCE_GRADUATION_THRESHOLDS_SECONDS = [
  20 * 60,
  50 * 60,
  80 * 60,
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
  const executionHeadroomBps = 10_000n;
  const feeHeadroomBps = 2_500n;
  const gasLimit =
    estimatedGas + ceilDiv(estimatedGas * executionHeadroomBps, bps);
  const feeReserve = gasLimit * maxFeePerGas;
  const bufferedFeeReserve =
    feeReserve + ceilDiv(feeReserve * feeHeadroomBps, bps);
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
  if (protocol.creatorStreamConserved !== true) {
    failures.push("creator reward stream is not conserved");
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
  if ((state.enduranceLaunches?.length ?? 0) < 8) {
    failures.push("fewer than eight endurance launches");
  }
  for (const index of [0, 1, 2]) {
    if (!has(`endurance-graduate-${index}-`)) {
      failures.push(`endurance launch ${index} did not graduate`);
    }
  }
  const requiredAssets = new Set(
    (state.requiredRewardAssets ?? []).map((asset) => asset.toLowerCase()),
  );
  const coveredAssets = new Set(
    (state.enduranceLaunches ?? [])
      .flatMap((launch) => launch.assets ?? [])
      .map((asset) => asset.toLowerCase()),
  );
  if (
    requiredAssets.size !== 24 ||
    coveredAssets.size !== 24 ||
    [...requiredAssets].some((asset) => !coveredAssets.has(asset))
  ) {
    failures.push("the complete 24-asset reward catalog was not covered");
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
    ["endurance-universal-exact-in-buy-", "Universal Router exact-input buy"],
    ["endurance-universal-exact-in-sell-", "Universal Router exact-input sell"],
    ["endurance-universal-exact-out-buy-", "Universal Router exact-output buy"],
    ["endurance-universal-exact-out-sell-", "Universal Router exact-output sell"],
    ["endurance-external-liquidity-full-", "external full-range liquidity"],
    ["endurance-external-liquidity-concentrated-", "external concentrated liquidity"],
    ["endurance-pregraduation-swap-rejected-", "pre-graduation swap rejection"],
    ["endurance-pregraduation-liquidity-rejected-", "pre-graduation liquidity rejection"],
    ["endurance-pregraduation-donation-rejected-", "pre-graduation donation rejection"],
    ["endurance-stream-claim-10-", "ten-minute stream claim"],
    ["endurance-stream-claim-30-", "thirty-minute stream claim"],
    ["endurance-stream-claim-59-", "fifty-nine-minute stream claim"],
    ["endurance-stream-claim-60-", "completed one-hour stream claim"],
    ["endurance-creator-split-open-", "open creator split"],
    ["endurance-creator-split-update-", "future-only creator split update"],
    ["endurance-creator-split-lock-", "locked creator split"],
    ["endurance-creator-claim-to-", "creator claim-to"],
    ["endurance-creator-batch-claim-", "creator batch claim"],
    ["endurance-creator-batch-claim-to-", "creator batch claim-to"],
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

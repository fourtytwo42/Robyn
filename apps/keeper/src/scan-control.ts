export type KeeperScanRequestState = {
  highestBlock: bigint;
  transactionHash: string;
  logIndex: number;
  triggerCount: number;
};

export function coalesceKeeperScanRequest(
  current: KeeperScanRequestState,
  incoming: KeeperScanRequestState,
): KeeperScanRequestState {
  const incomingIsNewer =
    incoming.highestBlock > current.highestBlock ||
    (incoming.highestBlock === current.highestBlock &&
      incoming.logIndex >= current.logIndex);
  return {
    highestBlock:
      incoming.highestBlock > current.highestBlock
        ? incoming.highestBlock
        : current.highestBlock,
    transactionHash: incomingIsNewer
      ? incoming.transactionHash
      : current.transactionHash,
    logIndex: incomingIsNewer ? incoming.logIndex : current.logIndex,
    triggerCount: current.triggerCount + incoming.triggerCount,
  };
}

export function scanRequestRetryDelayMs(attempts: number) {
  if (!Number.isInteger(attempts) || attempts < 0) {
    throw new Error("Keeper scan attempts must be a non-negative integer");
  }
  return Math.min(300_000, 5_000 * 2 ** Math.min(attempts, 6));
}

export function requestCompletionIsCurrent(
  claimedHighestBlock: bigint,
  storedHighestBlock: bigint,
  storedStatus: string,
) {
  return (
    storedStatus === "processing" && claimedHighestBlock === storedHighestBlock
  );
}

export function projectedDailyComputeUnits(
  computeUnits: number,
  elapsedMs: number,
) {
  if (
    !Number.isFinite(computeUnits) ||
    computeUnits < 0 ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs <= 0
  ) {
    throw new Error("Compute-unit projection inputs are invalid");
  }
  return Math.round((computeUnits / elapsedMs) * 86_400_000);
}

export function projectedScheduledDailyComputeUnits(
  computeUnits: number,
  completedRuns: number,
  intervalMs: number,
) {
  if (
    !Number.isFinite(computeUnits) ||
    computeUnits < 0 ||
    !Number.isInteger(completedRuns) ||
    completedRuns <= 0 ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0
  ) {
    throw new Error("Scheduled compute-unit projection inputs are invalid");
  }
  return Math.round((computeUnits / completedRuns) * (86_400_000 / intervalMs));
}

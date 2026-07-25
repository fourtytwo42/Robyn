export type Checkpoint = {
  lastBlock: bigint;
  lastHash: string;
};

export function checkpointDisposition(
  checkpointBlock: bigint,
  capturedHead: bigint,
  storedHash: string,
  observedHash: string,
) {
  if (checkpointBlock > capturedHead) return "rpc-behind" as const;
  return storedHash.toLowerCase() === observedHash.toLowerCase()
    ? ("continue" as const)
    : ("reset" as const);
}

export function boundedRangeEnd(
  start: bigint,
  head: bigint,
  rangeSize: bigint,
) {
  if (start < 0n || head < 0n || rangeSize <= 0n || start > head) {
    throw new Error("Invalid canonical ingestion range");
  }
  const candidate = start + rangeSize - 1n;
  return candidate > head ? head : candidate;
}

export function requiredBlockNumbers(logBlocks: bigint[], rangeEnd: bigint) {
  return [...new Set([...logBlocks, rangeEnd].map(String))]
    .map(BigInt)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function projectionWindow(
  deploymentBlock: bigint,
  projectedBlock: bigint | undefined,
  ingestedBlock: bigint,
) {
  const fromBlock =
    projectedBlock === undefined ? deploymentBlock : projectedBlock + 1n;
  if (ingestedBlock < fromBlock) return null;
  return { fromBlock, toBlock: ingestedBlock };
}

export function projectionRequiresReset(
  projectedBlock: bigint | undefined,
  ingestedBlock: bigint,
) {
  return projectedBlock !== undefined && projectedBlock > ingestedBlock;
}

export function blockLag(head: bigint, checkpoint: bigint) {
  if (checkpoint > head) return 0n;
  return head - checkpoint;
}

export function normalIngestionLagPassed(samples: number[]) {
  if (samples.length === 0) return true;
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1]! <= 50;
}

export function uniqueLaunchIds(ids: bigint[]) {
  return [...new Set(ids.map((id) => id.toString()))]
    .map(BigInt)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function failureBackoffMs(
  baseMs: number,
  consecutiveFailures: number,
  maximumMs = 30_000,
) {
  if (
    !Number.isFinite(baseMs) ||
    baseMs <= 0 ||
    !Number.isInteger(consecutiveFailures) ||
    consecutiveFailures < 0 ||
    !Number.isFinite(maximumMs) ||
    maximumMs <= 0
  ) {
    throw new Error("Invalid retry backoff configuration");
  }
  return Math.min(maximumMs, baseMs * 2 ** Math.min(consecutiveFailures, 10));
}

export function ingestionCycleResult(
  head: bigint,
  checkpoint: string | null,
  rangeCount: number,
  logCount: number,
  cycleMs: number,
) {
  return {
    head: head.toString(),
    checkpoint,
    rangeCount,
    logCount,
    cycleMs,
  };
}

export async function completeProjectionBatch<T>(
  items: T[],
  project: (item: T) => Promise<void>,
  reconcileMetadata: () => Promise<void>,
  advanceCheckpoint: () => Promise<void>,
) {
  for (const item of items) await project(item);
  await reconcileMetadata();
  await advanceCheckpoint();
  return items.length;
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  blockLag,
  boundedRangeEnd,
  capturedProjectionBlockMatches,
  checkpointDisposition,
  completeProjectionBatch,
  decodedEventArgs,
  failureBackoffMs,
  ingestionCycleResult,
  mergeIndexedAddresses,
  normalIngestionLagPassed,
  projectionRequiresReset,
  projectionWindow,
  requiredBlockNumbers,
  uniqueLaunchIds,
} from "../dist/pipeline.js";

test("canonical ranges are bounded and validated", () => {
  assert.equal(boundedRangeEnd(100n, 500n, 200n), 299n);
  assert.equal(boundedRangeEnd(400n, 500n, 200n), 500n);
  assert.throws(() => boundedRangeEnd(2n, 1n, 200n), /Invalid/);
});

test("every range commits verified metadata for logs and its range end", () => {
  assert.deepEqual(requiredBlockNumbers([102n, 101n, 102n], 200n), [
    101n,
    102n,
    200n,
  ]);
  assert.deepEqual(requiredBlockNumbers([], 200n), [200n]);
});

test("launch addresses discovered in an earlier range remain indexed in later ranges", () => {
  assert.deepEqual(
    mergeIndexedAddresses(
      ["0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
      ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      [
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      ],
    ),
    [
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "0xcccccccccccccccccccccccccccccccccccccccc",
    ],
  );
});

test("checkpoint verification fails closed on stale heads and resets on reorgs", () => {
  assert.equal(
    checkpointDisposition(100n, 99n, "0xaaa", "0xaaa"),
    "rpc-behind",
  );
  assert.equal(checkpointDisposition(100n, 100n, "0xAaA", "0xaaa"), "continue");
  assert.equal(checkpointDisposition(100n, 101n, "0xaaa", "0xbbb"), "reset");
});

test("projection resumes after its durable checkpoint", () => {
  assert.deepEqual(projectionWindow(10n, undefined, 20n), {
    fromBlock: 10n,
    toBlock: 20n,
  });
  assert.deepEqual(projectionWindow(10n, 15n, 20n), {
    fromBlock: 16n,
    toBlock: 20n,
  });
  assert.equal(projectionWindow(10n, 20n, 20n), null);
});

test("a projector checkpoint ahead of ingestion resets for deterministic replay", () => {
  assert.equal(projectionRequiresReset(undefined, 20n), false);
  assert.equal(projectionRequiresReset(20n, 20n), false);
  assert.equal(projectionRequiresReset(21n, 20n), true);
  assert.deepEqual(projectionWindow(10n, undefined, 20n), {
    fromBlock: 10n,
    toBlock: 20n,
  });
});

test("projection may advance to a captured canonical block while ingestion continues", () => {
  const captured = {
    number: "100",
    hash: "0xAaA",
    canonical: true,
  };
  assert.equal(capturedProjectionBlockMatches(100n, "0xaaa", captured), true);
  assert.equal(
    capturedProjectionBlockMatches(100n, "0xaaa", {
      ...captured,
      hash: "0xbbb",
    }),
    false,
  );
  assert.equal(
    capturedProjectionBlockMatches(100n, "0xaaa", {
      ...captured,
      canonical: false,
    }),
    false,
  );
  assert.equal(capturedProjectionBlockMatches(100n, "0xaaa", undefined), false);
});

test("failed launch validation leaves the projector checkpoint unchanged", async () => {
  const projected = [];
  let reconciled = false;
  let advanced = false;
  await assert.rejects(
    completeProjectionBatch(
      [1n, 2n, 3n],
      async (id) => {
        if (id === 2n) throw new Error("market is not seeded");
        projected.push(id);
      },
      async () => {
        reconciled = true;
      },
      async () => {
        advanced = true;
      },
    ),
    /not seeded/,
  );
  assert.deepEqual(projected, [1n]);
  assert.equal(reconciled, false);
  assert.equal(advanced, false);
});

test("successful projection reconciles delayed metadata before checkpointing", async () => {
  const order = [];
  const count = await completeProjectionBatch(
    [1n, 2n],
    async (id) => {
      order.push(`launch-${id}`);
    },
    async () => {
      order.push("metadata");
    },
    async () => {
      order.push("checkpoint");
    },
  );
  assert.equal(count, 2);
  assert.deepEqual(order, ["launch-1", "launch-2", "metadata", "checkpoint"]);
});

test("launch event replay is idempotent and ordered", () => {
  assert.deepEqual(uniqueLaunchIds([3n, 1n, 3n, 2n]), [1n, 2n, 3n]);
});

test("public-RPC failures use bounded exponential recovery backoff", () => {
  assert.equal(failureBackoffMs(1_000, 0), 1_000);
  assert.equal(failureBackoffMs(1_000, 1), 2_000);
  assert.equal(failureBackoffMs(1_000, 20), 30_000);
  assert.throws(() => failureBackoffMs(0, 1), /Invalid/);
});

test("ingestion heartbeat metadata is JSON-safe", () => {
  const result = ingestionCycleResult(93405202n, "93405202", 1, 4, 214.83);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.deepEqual(result, {
    head: "93405202",
    checkpoint: "93405202",
    rangeCount: 1,
    logCount: 4,
    cycleMs: 214.83,
  });
});

test("lag policy accepts normal p95 and rejects sustained delay", () => {
  assert.equal(blockLag(100n, 80n), 20n);
  assert.equal(blockLag(80n, 100n), 0n);
  assert.equal(normalIngestionLagPassed([10, 20, 30, 40, 50]), true);
  assert.equal(normalIngestionLagPassed([10, 20, 30, 40, 51]), false);
});

test("zero-argument events project as an empty argument record", () => {
  assert.deepEqual(decodedEventArgs(undefined), {});
  assert.deepEqual(decodedEventArgs(null), {});
  const args = { account: "0xabc" };
  assert.equal(decodedEventArgs(args), args);
});

import { describe, expect, it } from "vitest";
import {
  coalesceKeeperScanRequest,
  projectedDailyComputeUnits,
  projectedScheduledDailyComputeUnits,
  requestCompletionIsCurrent,
  scanRequestRetryDelayMs,
} from "../src/scan-control.js";

describe("event-driven keeper scan control", () => {
  it("coalesces repeated token events without losing the newest identity", () => {
    expect(
      coalesceKeeperScanRequest(
        {
          highestBlock: 100n,
          transactionHash: "0xold",
          logIndex: 2,
          triggerCount: 3,
          logIdentities: [
            {
              blockNumber: 100n,
              transactionHash: "0xold",
              logIndex: 2,
            },
          ],
        },
        {
          highestBlock: 101n,
          transactionHash: "0xnew",
          logIndex: 1,
          triggerCount: 1,
          logIdentities: [
            {
              blockNumber: 101n,
              transactionHash: "0xnew",
              logIndex: 1,
            },
          ],
        },
      ),
    ).toEqual({
      highestBlock: 101n,
      transactionHash: "0xnew",
      logIndex: 1,
      triggerCount: 4,
      logIdentities: [
        {
          blockNumber: 100n,
          transactionHash: "0xold",
          logIndex: 2,
        },
        {
          blockNumber: 101n,
          transactionHash: "0xnew",
          logIndex: 1,
        },
      ],
    });
  });

  it("deduplicates and bounds retained trigger log identities", () => {
    const identities = Array.from({ length: 70 }, (_, index) => ({
      blockNumber: BigInt(index),
      transactionHash: `0x${index.toString(16)}`,
      logIndex: index,
    }));
    const result = coalesceKeeperScanRequest(
      {
        highestBlock: 68n,
        transactionHash: "0x44",
        logIndex: 68,
        triggerCount: 69,
        logIdentities: identities.slice(0, 69),
      },
      {
        highestBlock: 69n,
        transactionHash: "0x45",
        logIndex: 69,
        triggerCount: 2,
        logIdentities: [identities[68]!, identities[69]!],
      },
    );
    expect(result.triggerCount).toBe(71);
    expect(result.logIdentities).toHaveLength(64);
    expect(result.logIdentities[0]?.blockNumber).toBe(6n);
    expect(result.logIdentities.at(-1)?.blockNumber).toBe(69n);
  });

  it("does not complete a request that received a newer canonical event", () => {
    expect(requestCompletionIsCurrent(100n, 100n, "processing")).toBe(true);
    expect(requestCompletionIsCurrent(100n, 101n, "pending")).toBe(false);
  });

  it("bounds retry backoff and rejects invalid attempts", () => {
    expect(scanRequestRetryDelayMs(0)).toBe(5_000);
    expect(scanRequestRetryDelayMs(2)).toBe(20_000);
    expect(scanRequestRetryDelayMs(20)).toBe(300_000);
    expect(() => scanRequestRetryDelayMs(-1)).toThrow("non-negative");
  });

  it("projects daily compute units from the measured service window", () => {
    expect(projectedDailyComputeUnits(10_000, 3_600_000)).toBe(240_000);
    expect(() => projectedDailyComputeUnits(1, 0)).toThrow("invalid");
  });

  it("projects scheduled work without extrapolating the startup burst", () => {
    expect(projectedScheduledDailyComputeUnits(1_800, 2, 900_000)).toBe(86_400);
    expect(() => projectedScheduledDailyComputeUnits(1, 0, 900_000)).toThrow(
      "invalid",
    );
  });
});

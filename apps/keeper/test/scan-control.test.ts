import { describe, expect, it } from "vitest";
import {
  coalesceKeeperScanRequest,
  projectedDailyComputeUnits,
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
        },
        {
          highestBlock: 101n,
          transactionHash: "0xnew",
          logIndex: 1,
          triggerCount: 1,
        },
      ),
    ).toEqual({
      highestBlock: 101n,
      transactionHash: "0xnew",
      logIndex: 1,
      triggerCount: 4,
    });
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
});

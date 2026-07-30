import { describe, expect, it } from "vitest";
import { projectionCheckpointsHealthy } from "../src/projection-health.js";

describe("projection checkpoint health", () => {
  it("accepts sequential in-cycle checkpoints within the bounded lag", () => {
    expect(
      projectionCheckpointsHealthy({
        ingestionBlock: 1_000n,
        launchBlock: 960n,
        kingBlock: 1_000n,
        rewardBlock: 960n,
        requireKing: true,
      }),
    ).toBe(true);
  });

  it("rejects any required projection beyond the lag budget", () => {
    expect(
      projectionCheckpointsHealthy({
        ingestionBlock: 1_000n,
        launchBlock: 899n,
        kingBlock: 1_000n,
        rewardBlock: 1_000n,
        requireKing: true,
      }),
    ).toBe(false);
  });

  it("rejects missing or ahead-of-ingestion checkpoints", () => {
    expect(
      projectionCheckpointsHealthy({
        ingestionBlock: 1_000n,
        launchBlock: 1_000n,
        rewardBlock: undefined,
        requireKing: false,
      }),
    ).toBe(false);
    expect(
      projectionCheckpointsHealthy({
        ingestionBlock: 1_000n,
        launchBlock: 1_001n,
        rewardBlock: 1_000n,
        requireKing: false,
      }),
    ).toBe(false);
  });

  it("requires the King checkpoint only when the policy is active", () => {
    expect(
      projectionCheckpointsHealthy({
        ingestionBlock: 1_000n,
        launchBlock: 1_000n,
        rewardBlock: 1_000n,
        requireKing: false,
      }),
    ).toBe(true);
    expect(
      projectionCheckpointsHealthy({
        ingestionBlock: 1_000n,
        launchBlock: 1_000n,
        rewardBlock: 1_000n,
        requireKing: true,
      }),
    ).toBe(false);
  });
});

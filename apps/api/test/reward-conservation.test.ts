import { describe, expect, it } from "vitest";
import { rewardStreamConservation } from "../src/reward-conservation.js";

describe("reward stream conservation", () => {
  it("accepts exact conservation", () => {
    expect(rewardStreamConservation(10n, 2n, 3n, 5n)).toEqual({
      conserved: true,
      uncheckpointedRoundingDust: 0n,
    });
  });

  it("accepts one base unit of uncheckpointed rounding dust", () => {
    expect(rewardStreamConservation(11n, 2n, 3n, 5n)).toEqual({
      conserved: true,
      uncheckpointedRoundingDust: 1n,
    });
  });

  it("rejects excess positive residuals", () => {
    expect(rewardStreamConservation(12n, 2n, 3n, 5n)).toEqual({
      conserved: false,
      uncheckpointedRoundingDust: 2n,
    });
  });

  it("rejects over-accounted streams", () => {
    expect(rewardStreamConservation(9n, 2n, 3n, 5n)).toEqual({
      conserved: false,
      uncheckpointedRoundingDust: -1n,
    });
  });
});

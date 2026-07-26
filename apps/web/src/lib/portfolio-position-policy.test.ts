import { describe, expect, it } from "vitest";
import { isActivePortfolioPosition } from "./portfolio-position-policy";

describe("portfolio position policy", () => {
  it("includes a launch token the wallet currently holds", () => {
    expect(
      isActivePortfolioPosition({
        balance: 1n,
        rewards: [{ claimable: 0n }],
      }),
    ).toBe(true);
  });

  it("includes a zero-balance token with currently claimable rewards", () => {
    expect(
      isActivePortfolioPosition({
        balance: 0n,
        rewards: [{ claimable: 2n }],
      }),
    ).toBe(true);
  });

  it("excludes unrelated launches with zero wallet-specific value", () => {
    expect(
      isActivePortfolioPosition({
        balance: 0n,
        rewards: [{ claimable: 0n }, { claimable: 0n }],
      }),
    ).toBe(false);
  });

  it("does not treat launch-wide pending conversion as wallet ownership", () => {
    expect(
      isActivePortfolioPosition({
        balance: 0n,
        pendingBase: 100n,
        rewards: [{ claimable: 0n }],
      }),
    ).toBe(false);
  });

  it("does not treat claimed history as a current position", () => {
    expect(
      isActivePortfolioPosition({
        balance: 0n,
        rewards: [{ claimable: 0n, claimed: 100n }],
      }),
    ).toBe(false);
  });
});

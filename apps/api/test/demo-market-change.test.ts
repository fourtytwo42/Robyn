import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  demoMarketChangeBps,
  isDemoMarketChangeEnabled,
} from "../src/demo-market-change.js";

describe("demo market change", () => {
  it("can only be enabled explicitly on the controlled Anvil chain", () => {
    expect(isDemoMarketChangeEnabled(31337, "true")).toBe(true);
    expect(isDemoMarketChangeEnabled(31337, "false")).toBe(false);
    expect(isDemoMarketChangeEnabled(46630, "true")).toBe(false);
    expect(isDemoMarketChangeEnabled(4663, "true")).toBe(false);
  });

  it("is deterministic, non-zero and bounded", () => {
    const tokens = [
      "0x1000000000000000000000000000000000000001",
      "0x2000000000000000000000000000000000000002",
      "0x3000000000000000000000000000000000000003",
    ] as Address[];

    for (const token of tokens) {
      const change = demoMarketChangeBps(token);
      expect(change).toBe(demoMarketChangeBps(token));
      expect(Math.abs(change)).toBeGreaterThanOrEqual(125);
      expect(Math.abs(change)).toBeLessThanOrEqual(1_800);
    }
  });

  it("produces both positive and negative demo movement", () => {
    expect(
      demoMarketChangeBps("0x1000000000000000000000000000000000000001"),
    ).toBeLessThan(0);
    expect(
      demoMarketChangeBps("0x2000000000000000000000000000000000000002"),
    ).toBeGreaterThan(0);
  });
});

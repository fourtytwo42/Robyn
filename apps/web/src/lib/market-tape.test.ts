import { describe, expect, it } from "vitest";
import {
  marketTapeDurationSeconds,
  marketTapeRepeatCount,
} from "./market-tape";

describe("market tape repetition", () => {
  it("repeats a short market group beyond the viewport", () => {
    expect(marketTapeRepeatCount(1200, 180)).toBe(8);
  });

  it("keeps one copy when a market group already exceeds the viewport", () => {
    expect(marketTapeRepeatCount(800, 1200)).toBe(2);
  });

  it("uses safe fallbacks before layout is measurable", () => {
    expect(marketTapeRepeatCount(0, 0)).toBe(1);
    expect(marketTapeDurationSeconds(0)).toBe(24);
  });

  it("keeps a constant readable scroll speed", () => {
    expect(marketTapeDurationSeconds(580)).toBe(18);
    expect(marketTapeDurationSeconds(2320)).toBe(40);
  });
});

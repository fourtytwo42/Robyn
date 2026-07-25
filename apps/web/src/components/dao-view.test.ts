import { describe, expect, it } from "vitest";
import { governanceDuration } from "../lib/display-format";

describe("governanceDuration", () => {
  it("formats the shortened testnet governance durations", () => {
    expect(governanceDuration("600")).toBe("10 minutes");
    expect(governanceDuration("1800")).toBe("30 minutes");
  });

  it("formats production-scale and edge-case durations", () => {
    expect(governanceDuration("86400")).toBe("1 day");
    expect(governanceDuration("259200")).toBe("3 days");
    expect(governanceDuration("0")).toBe("No delay");
    expect(governanceDuration("1")).toBe("1 second");
    expect(governanceDuration("invalid")).toBe("Unavailable");
  });
});

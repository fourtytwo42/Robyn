import { describe, expect, it } from "vitest";
import {
  boundedProtocolInput,
  conversionJobId,
  isLegExecutable,
} from "../src/eligibility.js";

describe("keeper eligibility", () => {
  const base = {
    pendingBase: 9n,
    pendingSince: 100n,
    minimumConversionBase: 10n,
    maximumPendingDelay: 60n,
    chainTimestamp: 159n,
  };

  it("executes at the amount threshold", () => {
    expect(isLegExecutable({ ...base, pendingBase: 10n })).toBe(true);
  });

  it("executes after the maximum pending delay", () => {
    expect(isLegExecutable({ ...base, chainTimestamp: 160n })).toBe(true);
  });

  it("does not execute an empty or immature leg", () => {
    expect(isLegExecutable(base)).toBe(false);
    expect(isLegExecutable({ ...base, pendingBase: 0n })).toBe(false);
  });

  it("builds a stable BullMQ-safe idempotency key", () => {
    expect(conversionJobId("0xABCDEF", 2n, 100n, 500n)).toBe(
      "convert-abcdef-2-100-500",
    );
  });

  it("quotes and executes the same bounded protocol batch", () => {
    expect(boundedProtocolInput(25_500n, 100n)).toBe(100n);
    expect(boundedProtocolInput(75n, 100n)).toBe(75n);
    expect(() => boundedProtocolInput(1n, 0n)).toThrow(
      "Maximum protocol batch must be positive",
    );
  });
});

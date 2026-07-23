import { describe, expect, it } from "vitest";
import {
  boundedProtocolInput,
  conversionJobId,
  failureAuditState,
  isLegExecutable,
  protocolObservationChanged,
  shouldSupersedeProtocolFailure,
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

  it("keeps auto-retried protocol failures in retrying state", () => {
    expect(failureAuditState("protocol-native", true)).toBe("retrying");
    expect(failureAuditState("protocol-launch", true)).toBe("retrying");
  });

  it("dead-letters terminal jobs without an automatic retry path", () => {
    expect(failureAuditState("convert", true)).toBe("dead_letter");
    expect(failureAuditState("harvest", true)).toBe("dead_letter");
    expect(failureAuditState("convert", false)).toBe("retrying");
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

  it("supersedes only observations that no longer match onchain work", () => {
    expect(protocolObservationChanged("100", 100n)).toBe(false);
    expect(protocolObservationChanged("100", 75n)).toBe(true);
    expect(protocolObservationChanged("not-an-amount", 100n)).toBe(true);
  });

  it("processes a changed failed observation exactly once", () => {
    expect(shouldSupersedeProtocolFailure("dead_letter", "100", 75n)).toBe(
      true,
    );
    expect(shouldSupersedeProtocolFailure("superseded", "100", 75n)).toBe(
      false,
    );
    expect(shouldSupersedeProtocolFailure("dead_letter", "100", 100n)).toBe(
      false,
    );
  });
});

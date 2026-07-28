import { describe, expect, it } from "vitest";
import {
  boundedProtocolInput,
  completedConversionBatchIsDue,
  conversionQuoteIsUsable,
  conversionJobId,
  failedJobRetryDelayMs,
  isFailedJobRetryDue,
  failureAuditState,
  harvestJobId,
  isLegacyConversionJobId,
  isLegacyStreamJobId,
  isLegExecutable,
  isReusableStreamJobKind,
  jobBelongsToActiveDeployment,
  protocolObservationChanged,
  protocolLaunchJobId,
  protocolNativeJobId,
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

  it("does not queue native conversion dust that rounds to zero", () => {
    expect(conversionQuoteIsUsable(0n)).toBe(false);
    expect(conversionQuoteIsUsable(1n)).toBe(false);
    expect(conversionQuoteIsUsable(2n)).toBe(true);
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
    expect(conversionJobId("0xABCDEF", 2n)).toBe("convert-abcdef-2");
  });

  it("recognizes only legacy observation-stamped conversion ids", () => {
    const address = "1234567890123456789012345678901234567890";
    const legacy = `convert-${address}-2-100-500`;
    expect(isLegacyConversionJobId("convert", legacy)).toBe(true);
    expect(isLegacyConversionJobId(undefined, legacy)).toBe(true);
    expect(isLegacyConversionJobId("protocol-native", legacy)).toBe(false);
    expect(isLegacyConversionJobId("convert", `convert-${address}-2`)).toBe(
      false,
    );
  });

  it("backs failed-job retries off exponentially with a one-hour cap", () => {
    expect(failedJobRetryDelayMs(1)).toBe(30_000);
    expect(failedJobRetryDelayMs(2)).toBe(60_000);
    expect(failedJobRetryDelayMs(20)).toBe(3_600_000);
    expect(isFailedJobRetryDue(2, 1_000, 60_999)).toBe(false);
    expect(isFailedJobRetryDue(2, 1_000, 61_000)).toBe(true);
    expect(isFailedJobRetryDue(1, undefined, 1_000_000)).toBe(false);
    expect(() => failedJobRetryDelayMs(-1)).toThrow("retry policy");
  });

  it("paces completed conversion batches by the reconciliation interval", () => {
    expect(completedConversionBatchIsDue(1_000, 900_999, 900_000)).toBe(false);
    expect(completedConversionBatchIsDue(1_000, 901_000, 900_000)).toBe(true);
    expect(completedConversionBatchIsDue(undefined, 901_000, 900_000)).toBe(
      false,
    );
    expect(completedConversionBatchIsDue(1_000, 901_000, 0)).toBe(false);
  });

  it("uses one reusable job id for each financial stream", () => {
    expect(protocolNativeJobId("0xABCDEF")).toBe("protocol-native-0xabcdef");
    expect(protocolLaunchJobId("0xABCDEF")).toBe("protocol-launch-0xabcdef");
    expect(harvestJobId("0xABCDEF")).toBe("harvest-0xabcdef");
  });

  it("identifies reusable stream jobs", () => {
    expect(isReusableStreamJobKind("protocol-native")).toBe(true);
    expect(isReusableStreamJobKind("protocol-launch")).toBe(true);
    expect(isReusableStreamJobKind("harvest")).toBe(true);
    expect(isReusableStreamJobKind("convert")).toBe(false);
  });

  it("recognizes only legacy amount-stamped stream ids", () => {
    const address = "0x1234567890123456789012345678901234567890";
    expect(
      isLegacyStreamJobId("protocol-native", `protocol-native-${address}-100`),
    ).toBe(true);
    expect(isLegacyStreamJobId("harvest", `harvest-${address}-1234`)).toBe(
      true,
    );
    expect(
      isLegacyStreamJobId("protocol-native", `protocol-native-${address}`),
    ).toBe(false);
    expect(isLegacyStreamJobId("convert", `convert-${address}-100`)).toBe(
      false,
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
    expect(shouldSupersedeProtocolFailure("retrying", "100", 75n)).toBe(true);
    expect(shouldSupersedeProtocolFailure("superseded", "100", 75n)).toBe(
      false,
    );
    expect(shouldSupersedeProtocolFailure("dead_letter", "100", 100n)).toBe(
      false,
    );
  });

  it("rejects jobs from archived deployments", () => {
    const active = new Set(["0xabcdef"]);
    expect(jobBelongsToActiveDeployment("0xABCDEF", active)).toBe(true);
    expect(jobBelongsToActiveDeployment("0x123456", active)).toBe(false);
    expect(jobBelongsToActiveDeployment(undefined, active)).toBe(false);
  });
});

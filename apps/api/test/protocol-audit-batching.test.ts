import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("protocol audit batching", () => {
  it("combines every launch audit plan into one verified batch read", () => {
    const source = readFileSync(
      new URL("../src/server.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(
      /const launchAuditValues = launchAuditPlans\.length\s+\? await verifiedBatchRead\(\s+launchAuditPlans\.flatMap\(\(\{ calls \}\) => calls\),/,
    );
    expect(source).toMatch(
      /for \(const \{ launch, calls \} of launchAuditPlans\)/,
    );
  });
});

import { describe, expect, it } from "vitest";
import { hasDaoMembership } from "../lib/dao-access-policy";

describe("hasDaoMembership", () => {
  it("rejects a zero RDAO balance", () => {
    expect(hasDaoMembership(0n)).toBe(false);
  });

  it("accepts any positive RDAO balance", () => {
    expect(hasDaoMembership(1n)).toBe(true);
    expect(hasDaoMembership(10n ** 18n)).toBe(true);
  });
});

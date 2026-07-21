import { describe, expect, it } from "vitest";
import { parseDiscoveryQuery } from "../src/discovery-query.js";

describe("parseDiscoveryQuery", () => {
  it("normalizes bounded search and filters", () => {
    expect(
      parseDiscoveryQuery({
        limit: "250",
        before: "99",
        q: "  MYCO  ",
        asset: "0x70e0bA845a1A0F2DA3359C97E0285013525FFC49",
        basketSize: "3",
      }),
    ).toEqual({
      limit: 100,
      before: "99",
      query: "myco",
      asset: "0x70e0ba845a1a0f2da3359c97e0285013525ffc49",
      basketSize: 3,
      invalidCursor: false,
      invalidCanonicalAddress: false,
    });
  });

  it("identifies address-like invalid searches without fuzzy matching", () => {
    const parsed = parseDiscoveryQuery({ q: "0x1234" });
    expect(parsed.invalidCanonicalAddress).toBe(true);
    expect(parsed.query).toBe("0x1234");
  });

  it("fails malformed cursors and ignores stale optional filters", () => {
    const parsed = parseDiscoveryQuery({
      limit: "not-a-number",
      before: "later",
      asset: "not-an-address",
      basketSize: "99",
    });
    expect(parsed.limit).toBe(20);
    expect(parsed.invalidCursor).toBe(true);
    expect(parsed.before).toBeNull();
    expect(parsed.asset).toBeNull();
    expect(parsed.basketSize).toBeNull();
    expect(
      parseDiscoveryQuery({ before: "999999999999999999999999999999" })
        .invalidCursor,
    ).toBe(true);
  });
});

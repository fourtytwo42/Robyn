import { describe, expect, it } from "vitest";
import {
  decodeDiscoveryCursor,
  encodeDiscoveryCursor,
  parseDiscoveryQuery,
} from "../src/discovery-query.js";

describe("parseDiscoveryQuery", () => {
  it("normalizes bounded search and filters", () => {
    expect(
      parseDiscoveryQuery({
        limit: "250",
        before: "99",
        q: "  MYCO  ",
        asset: "0x70e0bA845a1A0F2DA3359C97E0285013525FFC49",
        basketSize: "3",
        sort: "trending",
        window: "24h",
        phase: "bonding",
      }),
    ).toEqual({
      limit: 100,
      before: "99",
      query: "myco",
      asset: "0x70e0ba845a1a0f2da3359c97e0285013525ffc49",
      basketSize: 3,
      creator: null,
      invalidCreator: false,
      sort: "trending",
      window: "24h",
      phase: "bonding",
      invalidCursor: false,
      cursor: null,
      invalidCanonicalAddress: false,
    });
  });

  it("normalizes and validates canonical creator filters", () => {
    const creator = "0x70e0bA845a1A0F2DA3359C97E0285013525FFC49";
    expect(parseDiscoveryQuery({ creator }).creator).toBe(
      creator.toLowerCase(),
    );
    const invalid = parseDiscoveryQuery({ creator: "0x1234" });
    expect(invalid.creator).toBeNull();
    expect(invalid.invalidCreator).toBe(true);
  });

  it("fails unknown market views back to backward-compatible defaults", () => {
    const parsed = parseDiscoveryQuery({
      sort: "viral",
      window: "forever",
      phase: "paused",
    });
    expect(parsed.sort).toBe("new");
    expect(parsed.window).toBe("all");
    expect(parsed.phase).toBe("all");
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

  it("round-trips an opaque sort-aware cursor", () => {
    const cursor = encodeDiscoveryCursor({
      launchId: "42",
      sort: "trending",
      window: "24h",
      phase: "all",
    });
    expect(decodeDiscoveryCursor(cursor)?.launchId).toBe("42");
    expect(
      parseDiscoveryQuery({
        cursor,
        sort: "trending",
        window: "24h",
        phase: "all",
      }).invalidCursor,
    ).toBe(false);
  });

  it("accepts short canonical activity windows", () => {
    expect(parseDiscoveryQuery({ window: "1h" }).window).toBe("1h");
    expect(parseDiscoveryQuery({ window: "6h" }).window).toBe("6h");
    const cursor = encodeDiscoveryCursor({
      launchId: "43",
      sort: "volume",
      window: "1h",
      phase: "all",
    });
    expect(decodeDiscoveryCursor(cursor)?.window).toBe("1h");
  });

  it("accepts the permanent King of the Forest history view", () => {
    const parsed = parseDiscoveryQuery({
      sort: "king_of_forest",
      window: "all",
    });
    expect(parsed.sort).toBe("king_of_forest");
    const cursor = encodeDiscoveryCursor({
      launchId: "44",
      sort: "king_of_forest",
      window: "all",
      phase: "all",
    });
    expect(decodeDiscoveryCursor(cursor)?.sort).toBe("king_of_forest");
  });

  it("rejects opaque cursors reused with a different market view", () => {
    const cursor = encodeDiscoveryCursor({
      launchId: "42",
      sort: "trending",
      window: "24h",
      phase: "all",
    });
    expect(
      parseDiscoveryQuery({ cursor, sort: "new", window: "all", phase: "all" })
        .invalidCursor,
    ).toBe(true);
    expect(decodeDiscoveryCursor("not-json")).toBeNull();
  });
});

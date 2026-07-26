import { describe, expect, it } from "vitest";
import { forestCanopyClassName } from "./forest-canopy-policy";

describe("forestCanopyClassName", () => {
  it("keeps the base and compact selectors distinct", () => {
    expect(forestCanopyClassName()).toBe("forest-canopy");
    expect(forestCanopyClassName(true)).toBe("forest-canopy compact");
  });
});

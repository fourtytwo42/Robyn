import { describe, expect, it } from "vitest";
import { resolvePortfolioAccess } from "./portfolio-access-policy";

const connected = "0x1111111111111111111111111111111111111111";
const uat = "0x2222222222222222222222222222222222222222";

describe("resolvePortfolioAccess", () => {
  it("hides Portfolio without a connected or configured UAT wallet", () => {
    expect(resolvePortfolioAccess()).toEqual({ mode: "hidden", href: null });
    expect(resolvePortfolioAccess(undefined, uat, connected)).toEqual({
      mode: "hidden",
      href: null,
    });
  });

  it("shows the private Portfolio route for a connected wallet", () => {
    expect(resolvePortfolioAccess(connected, uat, uat)).toEqual({
      mode: "connected",
      href: "/portfolio",
    });
  });

  it("allows only the configured public UAT wallet in read-only mode", () => {
    expect(resolvePortfolioAccess(undefined, uat, uat.toUpperCase())).toEqual({
      mode: "uat-read-only",
      href: `/users/${uat}`,
    });
  });
});

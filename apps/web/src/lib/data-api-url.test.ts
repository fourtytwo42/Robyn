import { describe, expect, it } from "vitest";
import { resolveDataApiUrl } from "./data-api-url";

describe("resolveDataApiUrl", () => {
  it("uses the same-origin API proxy when configuration is absent or empty", () => {
    expect(resolveDataApiUrl(undefined)).toBe("/api");
    expect(resolveDataApiUrl("")).toBe("/api");
    expect(resolveDataApiUrl("   ")).toBe("/api");
  });

  it("normalizes a configured absolute API URL", () => {
    expect(resolveDataApiUrl("https://api.example.test///")).toBe(
      "https://api.example.test",
    );
  });
});

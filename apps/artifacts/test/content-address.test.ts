import { describe, expect, it } from "vitest";
import {
  artifactKey,
  normalizeArtifactContentType,
  sha256Hex,
} from "../src/content-address.js";

describe("content addressing", () => {
  it("generates the known SHA-256 digest", () => {
    expect(sha256Hex(Buffer.from("robyn-artifact-v1"))).toBe(
      "7eea3b58e1e972693cee7464a6348e1cd8724e43586978a2555f8af9b7bb8735",
    );
  });

  it("builds a stable sharded object key", () => {
    const digest = "a".repeat(64);
    expect(artifactKey(digest)).toBe("sha256/aa/" + digest);
  });

  it("rejects a malformed digest", () => {
    expect(() => artifactKey("../escape")).toThrow("Invalid SHA-256");
  });

  it("defaults and normalizes safe media types", () => {
    expect(normalizeArtifactContentType(undefined)).toBe(
      "application/octet-stream",
    );
    expect(normalizeArtifactContentType(" Application/JSON ")).toBe(
      "application/json",
    );
    expect(normalizeArtifactContentType("image/webp")).toBe("image/webp");
    expect(normalizeArtifactContentType("image/png")).toBe("image/png");
  });

  it("rejects active and parameterized media types", () => {
    expect(() => normalizeArtifactContentType("text/html")).toThrow();
    expect(() =>
      normalizeArtifactContentType("text/plain; charset=utf-8"),
    ).toThrow();
  });
});

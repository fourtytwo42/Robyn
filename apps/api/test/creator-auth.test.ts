import { describe, expect, it } from "vitest";
import {
  createCreatorChallenge,
  resolveAuthOrigin,
  validateCreatorChallenge,
} from "../src/creator-auth.js";

const address = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const;
const allowed = new Set(["https://preview.example", "http://127.0.0.1:3003"]);

describe("creator authentication scope", () => {
  it("creates and validates a five minute origin-bound challenge", () => {
    const authOrigin = resolveAuthOrigin(
      {
        host: "preview.example",
        origin: "https://preview.example",
        forwardedProto: "https",
      },
      allowed,
      31337,
    );
    const now = new Date("2026-07-22T12:00:00Z");
    const message = createCreatorChallenge({
      address,
      chainId: 31337,
      nonce: "0123456789abcdef",
      authOrigin,
      now,
    });
    expect(
      validateCreatorChallenge({
        message,
        nonce: "0123456789abcdef",
        address,
        chainId: 31337,
        authOrigin,
        now: new Date("2026-07-22T12:04:59Z"),
      }).chainId,
    ).toBe(31337);
  });

  it("rejects origin, domain, chain and expiry mismatches", () => {
    expect(() =>
      resolveAuthOrigin(
        {
          host: "preview.example",
          origin: "https://evil.example",
          forwardedProto: "https",
        },
        allowed,
        31337,
      ),
    ).toThrow("origin_header_mismatch");
    expect(() =>
      resolveAuthOrigin(
        { host: "127.0.0.1:3003", forwardedProto: "http" },
        allowed,
        46630,
      ),
    ).toThrow("secure_transport_required");

    const authOrigin = resolveAuthOrigin(
      { host: "preview.example", forwardedProto: "https" },
      allowed,
      31337,
    );
    const message = createCreatorChallenge({
      address,
      chainId: 31337,
      nonce: "fedcba9876543210",
      authOrigin,
      now: new Date("2026-07-22T12:00:00Z"),
    });
    expect(() =>
      validateCreatorChallenge({
        message,
        nonce: "fedcba9876543210",
        address,
        chainId: 46630,
        authOrigin,
        now: new Date("2026-07-22T12:01:00Z"),
      }),
    ).toThrow("invalid_siwe_scope");
    expect(() =>
      validateCreatorChallenge({
        message,
        nonce: "fedcba9876543210",
        address,
        chainId: 31337,
        authOrigin,
        now: new Date("2026-07-22T12:05:01Z"),
      }),
    ).toThrow("invalid_siwe_message");
  });
});

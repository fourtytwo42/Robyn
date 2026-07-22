import { describe, expect, it } from "vitest";
import {
  validateCreatorProfile,
  validateReportReason,
} from "../src/profile-validation.js";

describe("creator profile validation", () => {
  it("normalizes supported HTTPS profile links", () => {
    expect(
      validateCreatorProfile({
        displayName: " Robyn Labs ",
        bio: "Reward baskets for communities.",
        website: "https://robyn.example/about#team",
        xUrl: "https://x.com/robyn",
        telegramUrl: "https://t.me/robyn",
        discordUrl: "https://discord.gg/robyn",
      }),
    ).toMatchObject({
      displayName: "Robyn Labs",
      website: "https://robyn.example/about",
      xUrl: "https://x.com/robyn",
    });
  });

  it("rejects insecure, wrong-host and oversized profile fields", () => {
    expect(() =>
      validateCreatorProfile({
        displayName: "A",
        website: "http://example.com",
      }),
    ).toThrow("https_url_required");
    expect(() =>
      validateCreatorProfile({
        displayName: "A",
        xUrl: "https://example.com/me",
      }),
    ).toThrow("unexpected_social_host");
    expect(() =>
      validateCreatorProfile({ displayName: "x".repeat(49) }),
    ).toThrow("invalid_display_name");
  });

  it("validates public report reasons", () => {
    expect(validateReportReason(" Misleading copyrighted artwork. ")).toBe(
      "Misleading copyrighted artwork.",
    );
    expect(() => validateReportReason("short")).toThrow(
      "invalid_report_reason",
    );
  });
});

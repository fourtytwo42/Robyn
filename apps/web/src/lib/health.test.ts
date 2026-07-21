import { describe, expect, it } from "vitest";

import { foundationChecks, getHealthStatus } from "./health";

describe("getHealthStatus", () => {
  it("returns deterministic service metadata", () => {
    const now = new Date("2026-07-20T18:00:00.000Z");

    expect(getHealthStatus(now, "test")).toEqual({
      service: "robyn-web",
      status: "ok",
      environment: "test",
      timestamp: "2026-07-20T18:00:00.000Z",
    });
  });

  it("declares every foundation check", () => {
    expect(foundationChecks).toHaveLength(3);
  });
});

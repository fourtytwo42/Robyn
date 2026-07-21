import { describe, expect, it } from "vitest";

import { foundationChecks, getGatewayHealth, getHealthStatus } from "./health";

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

  describe("getGatewayHealth", () => {
    it("accepts the expected controlled chain", async () => {
      const request = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ status: "ok", chainId: 31337, upstream: "ok" }),
            { status: 200 },
          ),
        );

      await expect(getGatewayHealth(request)).resolves.toEqual({
        status: "ok",
        chainId: 31337,
        upstream: "ok",
      });
    });

    it("fails closed when the gateway is unavailable", async () => {
      const request = () => Promise.reject(new Error("offline"));

      await expect(getGatewayHealth(request)).resolves.toEqual({
        status: "degraded",
        chainId: 31337,
        upstream: "unavailable",
      });
    });
  });
});

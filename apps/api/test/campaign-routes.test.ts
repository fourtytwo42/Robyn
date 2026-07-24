import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerCampaignRoutes } from "../src/campaign-routes.js";

const token = "x".repeat(32);

function database() {
  return {
    unsafe: async (query: string) =>
      query.includes("FROM launches")
        ? [
            {
              launch_count: "8",
              binding_count: "8",
              first_block: "100",
              last_block: "200",
            },
          ]
        : [
            { status: "bound", count: "8" },
            { status: "abandoned", count: "1" },
          ],
  };
}

describe("campaign operator route", () => {
  it("is undiscoverable without the operator token and reports bounded status with it", async () => {
    const app = Fastify();
    registerCampaignRoutes(app, {
      sql: database() as never,
      chainId: 46630,
      operatorToken: token,
      releaseSha: "a".repeat(40),
    });
    const hidden = await app.inject({
      method: "GET",
      url: "/operator/campaigns/schema8-assurance",
    });
    expect(hidden.statusCode).toBe(404);
    const visible = await app.inject({
      method: "GET",
      url: "/operator/campaigns/schema8-assurance",
      headers: { "x-robyn-operator-token": token },
    });
    expect(visible.statusCode).toBe(200);
    expect(visible.json().data).toMatchObject({
      campaignId: "schema8-assurance",
      chainId: 46630,
      launchCount: 8,
      verifiedBindingCount: 8,
    });
    await app.close();
  });
});

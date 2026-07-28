import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("protects and returns the append-only endurance status projection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "robyn-endurance-"));
    const statusFile = join(directory, "state.json");
    await writeFile(
      statusFile,
      JSON.stringify({
        runId: "schema11-two-hour-endurance",
        releaseSha: "b".repeat(40),
        healthySeconds: 1200,
        targetHealthySeconds: 7200,
        remainingHealthySeconds: 6000,
        mode: "uninterrupted",
        paused: false,
        terminalFailure: null,
        coverage: {
          requiredAssetCount: 24,
          coveredAssetCount: 6,
          pendingRequirements: ["graduate at least three launches"],
        },
        rpcComputeUnits: {
          projectedIdleCuPerDay: 120_000,
          projectedNormalCuPerMonth: 8_000_000,
        },
      }),
    );
    const app = Fastify();
    registerCampaignRoutes(app, {
      sql: database() as never,
      chainId: 46630,
      operatorToken: token,
      releaseSha: "c".repeat(40),
      enduranceStatusFile: statusFile,
    });
    const hidden = await app.inject({
      method: "GET",
      url: "/operator/endurance",
    });
    expect(hidden.statusCode).toBe(404);
    const visible = await app.inject({
      method: "GET",
      url: "/operator/endurance",
      headers: { "x-robyn-operator-token": token },
    });
    expect(visible.statusCode).toBe(200);
    expect(visible.json().data).toMatchObject({
      runId: "schema11-two-hour-endurance",
      healthySeconds: 1200,
      targetHealthySeconds: 7200,
      remainingHealthySeconds: 6000,
      mode: "uninterrupted",
      chainId: 46630,
      apiReleaseSha: "c".repeat(40),
      coverage: {
        requiredAssetCount: 24,
        coveredAssetCount: 6,
      },
      rpcComputeUnits: {
        projectedIdleCuPerDay: 120_000,
        projectedNormalCuPerMonth: 8_000_000,
      },
    });
    await app.close();
  });
});

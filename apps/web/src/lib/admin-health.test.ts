import { afterEach, describe, expect, it } from "vitest";
import { getAdminHealthSnapshot } from "./admin-health";

const originalChainId = process.env.CHAIN_ID;
const originalReleaseSha = process.env.ROBYN_RELEASE_SHA;
const originalEnvironment = process.env.ROBYN_ENV;

afterEach(() => {
  process.env.CHAIN_ID = originalChainId;
  process.env.ROBYN_RELEASE_SHA = originalReleaseSha;
  process.env.ROBYN_ENV = originalEnvironment;
});

describe("getAdminHealthSnapshot", () => {
  it("combines RPC and data-plane diagnostics", async () => {
    process.env.CHAIN_ID = "46630";
    process.env.ROBYN_RELEASE_SHA = "a".repeat(40);
    process.env.ROBYN_ENV = "testnet";
    const request = (input: URL | RequestInfo, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (body?.method === "eth_chainId") {
        return Promise.resolve(
          new Response(JSON.stringify({ result: "0xb626" }), { status: 200 }),
        );
      }
      if (body?.method === "eth_blockNumber") {
        return Promise.resolve(
          new Response(JSON.stringify({ result: "0x64" }), { status: 200 }),
        );
      }
      expect(String(input)).toContain("/status");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            asOfBlock: "99",
            projectionAsOfBlock: "99",
            kingProjectionAsOfBlock: "99",
            kingProjectionLagBlocks: "0",
            ingestionLagBlocks: "1",
            projectionLagBlocks: "1",
            ingestionCycleMs: 120,
            projectionCycleMs: 2,
            rpcRetryCount: 3,
            lastRpcDegradationAt: null,
            indexedAt: "2026-07-25T23:00:00.000Z",
            ingestionStatus: "ok",
            projectionStatus: "ok",
            keeperStatus: "ok",
            keeperUpdatedAt: "2026-07-25T23:00:00.000Z",
            artifactStatus: "ok",
            artifactUpdatedAt: "2026-07-25T23:00:00.000Z",
            launchCount: "12",
            rawLogCount: "7000",
            kingOfForestAwardCount: "2",
            currentKingOfForest: "0x1111111111111111111111111111111111111111",
          }),
          { status: 200 },
        ),
      );
    };

    const snapshot = await getAdminHealthSnapshot(
      request as typeof fetch,
      new Date("2026-07-25T23:01:00.000Z"),
    );

    expect(snapshot).toMatchObject({
      overall: "ok",
      generatedAt: "2026-07-25T23:01:00.000Z",
      releaseSha: "a".repeat(40),
      environment: "testnet",
      rpc: { status: "ok", chainId: 46630, blockNumber: "100" },
      indexer: {
        status: "ok",
        asOfBlock: "99",
        projectionAsOfBlock: "99",
        kingProjectionAsOfBlock: "99",
        kingProjectionLagBlocks: "0",
        ingestionLagBlocks: "1",
        projectionLagBlocks: "1",
        rpcRetryCount: 3,
      },
      keeper: { status: "ok" },
      artifacts: { status: "ok" },
      data: {
        launchCount: "12",
        rawLogCount: "7000",
        kingOfForestAwardCount: "2",
        currentKingOfForest: "0x1111111111111111111111111111111111111111",
      },
    });
  });

  it("fails closed when RPC and status reads fail", async () => {
    process.env.CHAIN_ID = "46630";
    const snapshot = await getAdminHealthSnapshot((() =>
      Promise.reject(new Error("offline"))) as typeof fetch);
    expect(snapshot.overall).toBe("degraded");
    expect(snapshot.rpc).toMatchObject({
      status: "degraded",
      chainId: 0,
      blockNumber: null,
    });
    expect(snapshot.indexer.status).toBe("degraded");
    expect(snapshot.keeper.status).toBe("degraded");
    expect(snapshot.artifacts.status).toBe("degraded");
  });
});

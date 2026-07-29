import { describe, expect, it, vi } from "vitest";

import {
  TestnetRpcFailover,
  type RpcBody,
  type UpstreamRequest,
} from "../src/failover.js";

const primaryUrl = "http://192.0.2.10:8547";
const fallbackUrl = "https://alchemy.invalid/key";

function result(id: unknown, value: unknown) {
  return { jsonrpc: "2.0", id, result: value };
}

function createUpstream(options?: {
  primaryHead?: bigint;
  fallbackHead?: bigint;
  primaryOnline?: boolean;
  primaryChainId?: number;
}) {
  let primaryHead = options?.primaryHead ?? 1_000n;
  let fallbackHead = options?.fallbackHead ?? 1_000n;
  let primaryOnline = options?.primaryOnline ?? true;
  let fallbackOnline = true;
  let primaryChainId = options?.primaryChainId ?? 46_630;
  const request = vi.fn<UpstreamRequest>((url, payload) => {
    if (url === primaryUrl && !primaryOnline) {
      return Promise.reject(new Error("primary offline"));
    }
    if (url === fallbackUrl && !fallbackOnline) {
      return Promise.reject(new Error("fallback offline"));
    }
    const entry = (Array.isArray(payload) ? payload[0] : payload) as RpcBody & {
      method: string;
      id?: unknown;
    };
    if (entry.method === "eth_chainId") {
      const chainId = url === primaryUrl ? primaryChainId : 46_630;
      return Promise.resolve(result(entry.id, `0x${chainId.toString(16)}`));
    }
    if (entry.method === "eth_blockNumber") {
      const head = url === primaryUrl ? primaryHead : fallbackHead;
      return Promise.resolve(result(entry.id, `0x${head.toString(16)}`));
    }
    return Promise.resolve(result(entry.id, "0xfeed"));
  });
  return {
    request,
    setPrimaryHead: (value: bigint) => {
      primaryHead = value;
    },
    setFallbackHead: (value: bigint) => {
      fallbackHead = value;
    },
    setPrimaryOnline: (value: boolean) => {
      primaryOnline = value;
    },
    setPrimaryChainId: (value: number) => {
      primaryChainId = value;
    },
    setFallbackOnline: (value: boolean) => {
      fallbackOnline = value;
    },
  };
}

function controller(request: UpstreamRequest) {
  return new TestnetRpcFailover({
    primaryUrl,
    fallbackUrl,
    expectedChainId: 46_630,
    probeIntervalMs: 30_000,
    maximumHeadLagBlocks: 50,
    recoveryHeadLagBlocks: 10,
    recoveryHealthyProbeTarget: 2,
    request,
    now: () => 1_000_000,
  });
}

describe("testnet RPC failover", () => {
  it("uses the LAN provider immediately when the initial comparison is healthy", async () => {
    const upstream = createUpstream();
    const failover = controller(upstream.request);

    await failover.probe();
    expect(failover.snapshot()).toMatchObject({
      status: "ok",
      activeProvider: "primary",
      headLagBlocks: "0",
    });

    await failover.request({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: [],
    });
    expect(upstream.request).toHaveBeenLastCalledWith(
      primaryUrl,
      expect.objectContaining({ method: "eth_blockNumber" }),
    );
  });

  it("fails over when the LAN provider is unreachable", async () => {
    const upstream = createUpstream();
    const failover = controller(upstream.request);
    await failover.probe();
    await failover.probe();
    upstream.setPrimaryOnline(false);

    await failover.probe();

    expect(failover.snapshot()).toMatchObject({
      status: "degraded",
      activeProvider: "fallback",
      primary: { healthy: false },
      fallback: { healthy: true },
    });
  });

  it("fails over when the LAN provider is more than 50 blocks behind", async () => {
    const upstream = createUpstream({
      primaryHead: 900n,
      fallbackHead: 1_000n,
    });
    const failover = controller(upstream.request);

    await failover.probe();

    expect(failover.snapshot()).toMatchObject({
      activeProvider: "fallback",
      headLagBlocks: "100",
    });
  });

  it("rejects a LAN endpoint on the wrong chain", async () => {
    const upstream = createUpstream({ primaryChainId: 4_663 });
    const failover = controller(upstream.request);

    await failover.probe();

    expect(failover.snapshot()).toMatchObject({
      activeProvider: "fallback",
      primary: { healthy: false },
    });
  });

  it("returns to LAN only after two recovery probes", async () => {
    const upstream = createUpstream({
      primaryHead: 900n,
      fallbackHead: 1_000n,
    });
    const failover = controller(upstream.request);
    await failover.probe();
    upstream.setPrimaryHead(995n);

    await failover.probe();
    expect(failover.snapshot().activeProvider).toBe("fallback");
    await failover.probe();
    expect(failover.snapshot().activeProvider).toBe("primary");
  });

  it("retries the identical request through Alchemy after a primary transport failure", async () => {
    const upstream = createUpstream();
    const failover = controller(upstream.request);
    await failover.probe();
    await failover.probe();
    upstream.setPrimaryOnline(false);
    const payload = {
      jsonrpc: "2.0" as const,
      id: 9,
      method: "eth_sendRawTransaction",
      params: ["0x1234"],
    };

    await failover.request(payload);

    expect(failover.snapshot()).toMatchObject({
      activeProvider: "fallback",
      primaryRequestFailures: 1,
      paidFallbackCu: 10,
    });
    expect(upstream.request).toHaveBeenLastCalledWith(fallbackUrl, payload);
  });

  it("projects only paid probes while LAN serves application traffic", async () => {
    const upstream = createUpstream();
    const failover = controller(upstream.request);
    await failover.probe();
    await failover.probe();

    expect(failover.snapshot()).toMatchObject({
      activeProvider: "primary",
      paidProjectedDailyCu: 57_600,
      paidProjectedMonthlyCu: 1_728_000,
    });
  });

  it("reports unavailable when both request paths fail", async () => {
    const upstream = createUpstream();
    const failover = controller(upstream.request);
    await failover.probe();
    upstream.setPrimaryOnline(false);
    upstream.setFallbackOnline(false);

    await expect(
      failover.request({
        jsonrpc: "2.0",
        id: 3,
        method: "eth_blockNumber",
        params: [],
      }),
    ).rejects.toThrow("fallback offline");
    expect(failover.snapshot()).toMatchObject({
      status: "unavailable",
      primary: { healthy: false },
      fallback: { healthy: false },
    });
  });
});

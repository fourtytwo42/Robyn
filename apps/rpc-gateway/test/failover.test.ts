import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHttpUpstreamRequest,
  TestnetRpcFailover,
  type RpcBody,
  type UpstreamRequest,
} from "../src/failover.js";

const primaryUrl = "http://192.0.2.10:8547";
const fallbackUrl = "https://alchemy.invalid/key";

afterEach(() => {
  vi.unstubAllGlobals();
});

function result(id: unknown, value: unknown) {
  return { jsonrpc: "2.0", id, result: value };
}

function createUpstream(options?: {
  primaryHead?: bigint;
  fallbackHead?: bigint;
  primaryOnline?: boolean;
  primaryChainId?: number;
  primarySyncing?: boolean;
}) {
  let primaryHead = options?.primaryHead ?? 1_000n;
  let fallbackHead = options?.fallbackHead ?? 1_000n;
  let primaryOnline = options?.primaryOnline ?? true;
  let fallbackOnline = true;
  let primaryChainId = options?.primaryChainId ?? 46_630;
  let primarySyncing = options?.primarySyncing ?? false;
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
    if (entry.method === "eth_syncing") {
      return Promise.resolve(
        result(
          entry.id,
          url === primaryUrl && primarySyncing
            ? { currentBlock: "0x3e8" }
            : false,
        ),
      );
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
    setPrimarySyncing: (value: boolean) => {
      primarySyncing = value;
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

  it("fails over while the LAN provider reports active synchronization", async () => {
    const upstream = createUpstream({ primarySyncing: true });
    const failover = controller(upstream.request);

    await failover.probe();

    expect(failover.snapshot()).toMatchObject({
      status: "degraded",
      activeProvider: "fallback",
      primary: {
        syncing: true,
        healthy: false,
        error: "upstream is still syncing",
      },
      fallback: { syncing: false, healthy: true },
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

  it("does not replay a signed transaction after an ambiguous primary transport failure", async () => {
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

    await expect(failover.request(payload)).rejects.toThrow(
      "primary write outcome is unknown; reconcile before retry",
    );

    expect(failover.snapshot()).toMatchObject({
      activeProvider: "fallback",
      primaryRequestFailures: 1,
      paidFallbackCu: 0,
    });
    expect(upstream.request).not.toHaveBeenCalledWith(fallbackUrl, payload);
  });

  it("falls back for read-only requests when the LAN node cannot serve state", async () => {
    const request = vi.fn<UpstreamRequest>((url, payload) => {
      const entry = (Array.isArray(payload) ? payload[0] : payload) as {
        id?: unknown;
        method: string;
      };
      if (entry.method === "eth_chainId") {
        return Promise.resolve(result(entry.id, "0xb626"));
      }
      if (entry.method === "eth_blockNumber") {
        return Promise.resolve(result(entry.id, "0x3e8"));
      }
      if (entry.method === "eth_syncing") {
        return Promise.resolve(result(entry.id, false));
      }
      if (url === primaryUrl && entry.method === "eth_getCode") {
        return Promise.resolve({
          jsonrpc: "2.0",
          id: entry.id,
          error: {
            code: -32_603,
            message: "missing trie node: state is not available",
          },
        });
      }
      return Promise.resolve(result(entry.id, "0x6000"));
    });
    const failover = controller(request);
    await failover.probe();
    const payload = {
      jsonrpc: "2.0" as const,
      id: 10,
      method: "eth_getCode",
      params: ["0x0000000000000000000000000000000000000001", "latest"],
    };

    await expect(failover.request(payload)).resolves.toEqual(
      result(10, "0x6000"),
    );
    expect(failover.snapshot()).toMatchObject({
      activeProvider: "fallback",
      primaryRequestFailures: 1,
      paidFallbackCu: 10,
    });
    expect(request).toHaveBeenLastCalledWith(fallbackUrl, payload);
  });

  it("does not replay a signed transaction after a primary JSON-RPC rejection", async () => {
    const rejection = {
      jsonrpc: "2.0",
      id: 11,
      error: { code: -32_000, message: "nonce too low" },
    };
    const request = vi.fn<UpstreamRequest>((url, payload) => {
      const entry = (Array.isArray(payload) ? payload[0] : payload) as {
        id?: unknown;
        method: string;
      };
      if (entry.method === "eth_chainId") {
        return Promise.resolve(result(entry.id, "0xb626"));
      }
      if (entry.method === "eth_blockNumber") {
        return Promise.resolve(result(entry.id, "0x3e8"));
      }
      if (entry.method === "eth_syncing") {
        return Promise.resolve(result(entry.id, false));
      }
      if (url === primaryUrl && entry.method === "eth_sendRawTransaction") {
        return Promise.resolve(rejection);
      }
      return Promise.resolve(result(entry.id, "0xfeed"));
    });
    const failover = controller(request);
    await failover.probe();

    await expect(
      failover.request({
        jsonrpc: "2.0",
        id: 11,
        method: "eth_sendRawTransaction",
        params: ["0x1234"],
      }),
    ).resolves.toEqual(rejection);
    expect(request).not.toHaveBeenCalledWith(
      fallbackUrl,
      expect.objectContaining({ method: "eth_sendRawTransaction" }),
    );
    expect(failover.snapshot().activeProvider).toBe("primary");
  });

  it("projects only paid probes while LAN serves application traffic", async () => {
    const upstream = createUpstream();
    const failover = controller(upstream.request);
    await failover.probe();
    await failover.probe();

    expect(failover.snapshot()).toMatchObject({
      activeProvider: "primary",
      paidProjectedDailyCu: 86_400,
      paidProjectedMonthlyCu: 2_592_000,
    });
  });

  it("uses a network-specific service identity in persisted health state", () => {
    const upstream = createUpstream();
    const failover = new TestnetRpcFailover({
      primaryUrl,
      fallbackUrl,
      expectedChainId: 4_663,
      request: upstream.request,
      serviceName: "robyn-mainnet-rpc-failover",
    });

    expect(failover.snapshot()).toMatchObject({
      service: "robyn-mainnet-rpc-failover",
      expectedChainId: 4_663,
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

describe("HTTP upstream retries", () => {
  it("retries a transient read failure with the identical payload", async () => {
    const payload = {
      jsonrpc: "2.0" as const,
      id: 21,
      method: "eth_blockNumber",
      params: [],
    };
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(result(21, "0x3e8")), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createHttpUpstreamRequest(1_000, 2, 1)(fallbackUrl, payload),
    ).resolves.toEqual(result(21, "0x3e8"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const secondRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(firstRequest.body).toBe(secondRequest.body);
  });

  it("never retries a signed transaction transport failure", async () => {
    const payload = {
      jsonrpc: "2.0" as const,
      id: 22,
      method: "eth_sendRawTransaction",
      params: ["0x1234"],
    };
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(result(22, "0xhash")), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createHttpUpstreamRequest(1_000, 3, 1)(primaryUrl, payload),
    ).rejects.toThrow("connection reset");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

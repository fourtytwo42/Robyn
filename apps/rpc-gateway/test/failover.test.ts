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
  fallbackOnline?: boolean;
  primaryChainId?: number;
  primarySyncing?: boolean;
}) {
  let primaryHead = options?.primaryHead ?? 1_000n;
  const fallbackHead = options?.fallbackHead ?? 1_000n;
  let primaryOnline = options?.primaryOnline ?? true;
  let fallbackOnline = options?.fallbackOnline ?? true;
  const primaryChainId = options?.primaryChainId ?? 46_630;
  const primarySyncing = options?.primarySyncing ?? false;
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
    setPrimaryOnline: (value: boolean) => {
      primaryOnline = value;
    },
    setFallbackOnline: (value: boolean) => {
      fallbackOnline = value;
    },
  };
}

function controller(
  request: UpstreamRequest,
  options?: {
    selectedProvider?: "primary" | "fallback";
    authorizeFallback?: boolean;
  },
) {
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
    ...(options?.selectedProvider
      ? { selectedProvider: options.selectedProvider }
      : {}),
    ...(options?.authorizeFallback !== undefined
      ? { fallbackTrafficAuthorized: options.authorizeFallback }
      : {}),
  });
}

describe("operator-selected RPC policy", () => {
  it("serves application traffic only from the LAN provider by default", async () => {
    const upstream = createUpstream();
    const gateway = controller(upstream.request);

    await gateway.probe();
    expect(gateway.snapshot()).toMatchObject({
      status: "ok",
      activeProvider: "primary",
      providerSelection: "operator",
      fallbackTrafficAuthorized: false,
      trafficAvailable: true,
      headLagBlocks: "0",
    });

    const payload = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "eth_getBalance",
      params: ["0x0000000000000000000000000000000000000001", "latest"],
    };
    await gateway.request(payload);
    expect(upstream.request).toHaveBeenLastCalledWith(primaryUrl, payload);
    expect(upstream.request).not.toHaveBeenCalledWith(fallbackUrl, payload);
  });

  it("uses Alchemy only for bounded health probes while LAN is selected", async () => {
    const upstream = createUpstream();
    const gateway = controller(upstream.request);

    await gateway.probe();

    const fallbackMethods = upstream.request.mock.calls
      .filter(([url]) => url === fallbackUrl)
      .map(([, body]) => (Array.isArray(body) ? body[0]?.method : body.method));
    expect(fallbackMethods.sort()).toEqual([
      "eth_blockNumber",
      "eth_chainId",
      "eth_syncing",
    ]);
  });

  it("reports degraded without switching when LAN is unreachable", async () => {
    const upstream = createUpstream({ primaryOnline: false });
    const gateway = controller(upstream.request);

    await gateway.probe();

    expect(gateway.snapshot()).toMatchObject({
      status: "degraded",
      activeProvider: "primary",
      fallbackTrafficAuthorized: false,
      trafficAvailable: false,
      primary: { healthy: false },
      fallback: { healthy: true },
      providerChanges: 0,
    });
  });

  it("reports degraded without switching when LAN is too far behind", async () => {
    const upstream = createUpstream({
      primaryHead: 900n,
      fallbackHead: 1_000n,
    });
    const gateway = controller(upstream.request);

    await gateway.probe();

    expect(gateway.snapshot()).toMatchObject({
      status: "degraded",
      activeProvider: "primary",
      trafficAvailable: false,
      headLagBlocks: "100",
    });
  });

  it("reports degraded without switching for wrong-chain or syncing LAN state", async () => {
    const wrongChain = createUpstream({ primaryChainId: 4_663 });
    const wrongChainGateway = controller(wrongChain.request);
    await wrongChainGateway.probe();
    expect(wrongChainGateway.snapshot()).toMatchObject({
      status: "degraded",
      activeProvider: "primary",
      primary: { healthy: false },
    });

    const syncing = createUpstream({ primarySyncing: true });
    const syncingGateway = controller(syncing.request);
    await syncingGateway.probe();
    expect(syncingGateway.snapshot()).toMatchObject({
      status: "degraded",
      activeProvider: "primary",
      primary: { syncing: true, healthy: false },
    });
  });

  it("never sends a failed LAN read to Alchemy", async () => {
    const upstream = createUpstream();
    const gateway = controller(upstream.request);
    await gateway.probe();
    upstream.setPrimaryOnline(false);
    const payload = {
      jsonrpc: "2.0" as const,
      id: 7,
      method: "eth_getCode",
      params: ["0x0000000000000000000000000000000000000001", "latest"],
    };

    await expect(gateway.request(payload)).rejects.toThrow(
      "Alchemy fallback requires operator authorization",
    );
    expect(upstream.request).not.toHaveBeenCalledWith(fallbackUrl, payload);
    expect(gateway.snapshot()).toMatchObject({
      status: "degraded",
      activeProvider: "primary",
      primaryRequestFailures: 1,
      paidFallbackCu: 0,
    });
  });

  it("never sends unavailable historical state to Alchemy", async () => {
    const request = vi.fn<UpstreamRequest>((url, payload) => {
      const entry = (Array.isArray(payload) ? payload[0] : payload) as {
        id?: unknown;
        method: string;
      };
      if (entry.method === "eth_chainId")
        return Promise.resolve(result(entry.id, "0xb626"));
      if (entry.method === "eth_blockNumber")
        return Promise.resolve(result(entry.id, "0x3e8"));
      if (entry.method === "eth_syncing")
        return Promise.resolve(result(entry.id, false));
      if (url === primaryUrl) {
        return Promise.resolve({
          jsonrpc: "2.0",
          id: entry.id,
          error: { code: -32_603, message: "missing trie node" },
        });
      }
      return Promise.resolve(result(entry.id, "0x6000"));
    });
    const gateway = controller(request);
    await gateway.probe();
    const payload = {
      jsonrpc: "2.0" as const,
      id: 8,
      method: "eth_getCode",
      params: ["0x0000000000000000000000000000000000000001", "latest"],
    };

    await expect(gateway.request(payload)).rejects.toThrow(
      "Alchemy fallback requires operator authorization",
    );
    expect(request).not.toHaveBeenCalledWith(fallbackUrl, payload);
  });

  it("does not replay a signed transaction after an ambiguous LAN failure", async () => {
    const upstream = createUpstream();
    const gateway = controller(upstream.request);
    await gateway.probe();
    upstream.setPrimaryOnline(false);
    const payload = {
      jsonrpc: "2.0" as const,
      id: 9,
      method: "eth_sendRawTransaction",
      params: ["0x1234"],
    };

    await expect(gateway.request(payload)).rejects.toThrow(
      "primary write outcome is unknown; reconcile before retry",
    );
    expect(upstream.request).not.toHaveBeenCalledWith(fallbackUrl, payload);
  });

  it("returns a LAN JSON-RPC rejection without sending it to Alchemy", async () => {
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
      if (entry.method === "eth_chainId")
        return Promise.resolve(result(entry.id, "0xb626"));
      if (entry.method === "eth_blockNumber")
        return Promise.resolve(result(entry.id, "0x3e8"));
      if (entry.method === "eth_syncing")
        return Promise.resolve(result(entry.id, false));
      return Promise.resolve(
        url === primaryUrl ? rejection : result(entry.id, "0xfeed"),
      );
    });
    const gateway = controller(request);
    await gateway.probe();
    const payload = {
      jsonrpc: "2.0" as const,
      id: 11,
      method: "eth_sendRawTransaction",
      params: ["0x1234"],
    };

    await expect(gateway.request(payload)).resolves.toEqual(rejection);
    expect(request).not.toHaveBeenCalledWith(fallbackUrl, payload);
  });

  it("requires a second explicit authorization flag to select Alchemy", () => {
    const upstream = createUpstream();
    expect(() =>
      controller(upstream.request, { selectedProvider: "fallback" }),
    ).toThrow("fallback RPC traffic requires explicit operator authorization");
  });

  it("uses only Alchemy application traffic after an explicit operator selection", async () => {
    const upstream = createUpstream();
    const gateway = controller(upstream.request, {
      selectedProvider: "fallback",
      authorizeFallback: true,
    });
    await gateway.probe();
    const payload = {
      jsonrpc: "2.0" as const,
      id: 12,
      method: "eth_getBalance",
      params: ["0x0000000000000000000000000000000000000001", "latest"],
    };

    await gateway.request(payload);

    expect(upstream.request).toHaveBeenLastCalledWith(fallbackUrl, payload);
    expect(upstream.request).not.toHaveBeenCalledWith(primaryUrl, payload);
    expect(gateway.snapshot()).toMatchObject({
      status: "degraded",
      activeProvider: "fallback",
      fallbackTrafficAuthorized: true,
      trafficAvailable: true,
      paidFallbackCu: 10,
    });
  });

  it("does not silently return to LAN if the operator-selected fallback fails", async () => {
    const upstream = createUpstream();
    const gateway = controller(upstream.request, {
      selectedProvider: "fallback",
      authorizeFallback: true,
    });
    await gateway.probe();
    upstream.setFallbackOnline(false);
    const payload = {
      jsonrpc: "2.0" as const,
      id: 13,
      method: "eth_blockNumber",
      params: [],
    };

    await expect(gateway.request(payload)).rejects.toThrow("fallback offline");
    expect(upstream.request).not.toHaveBeenCalledWith(primaryUrl, payload);
  });

  it("keeps paid usage limited to probes while LAN serves", async () => {
    const upstream = createUpstream();
    const gateway = controller(upstream.request);
    await gateway.probe();
    await gateway.probe();

    expect(gateway.snapshot()).toMatchObject({
      activeProvider: "primary",
      paidFallbackCu: 0,
      paidProjectedDailyCu: 86_400,
      paidProjectedMonthlyCu: 2_592_000,
    });
  });

  it("keeps the operator selection while LAN health recovers", async () => {
    const upstream = createUpstream({
      primaryHead: 900n,
      fallbackHead: 1_000n,
    });
    const gateway = controller(upstream.request);
    await gateway.probe();
    upstream.setPrimaryHead(1_000n);
    await gateway.probe();

    expect(gateway.snapshot()).toMatchObject({
      status: "ok",
      activeProvider: "primary",
      trafficAvailable: true,
      providerChanges: 0,
    });
  });

  it("uses a network-specific service identity", () => {
    const upstream = createUpstream();
    const gateway = new TestnetRpcFailover({
      primaryUrl,
      fallbackUrl,
      expectedChainId: 4_663,
      request: upstream.request,
      serviceName: "robyn-mainnet-rpc-gateway",
    });

    expect(gateway.snapshot()).toMatchObject({
      service: "robyn-mainnet-rpc-gateway",
      expectedChainId: 4_663,
      activeProvider: "primary",
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

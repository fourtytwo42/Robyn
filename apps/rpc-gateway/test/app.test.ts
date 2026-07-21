import { afterEach, describe, expect, it, vi } from "vitest";

import { buildGateway, type RpcRequester } from "../src/app.js";

const address = "0x1111111111111111111111111111111111111111";
const openApps: Array<ReturnType<typeof buildGateway>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

function createApp(rpcRequest: RpcRequester, now?: () => number) {
  const app = buildGateway({ rpcRequest, ...(now ? { now } : {}) });
  openApps.push(app);
  return app;
}

describe("RPC gateway", () => {
  it("forwards an allowed standard method", async () => {
    const rpcRequest = vi.fn<RpcRequester>((payload) =>
      Promise.resolve({
        jsonrpc: "2.0",
        id: payload.id,
        result: "0x7a69",
      }),
    );
    const app = createApp(rpcRequest);

    const response = await app.inject({
      method: "POST",
      url: "/",
      payload: { jsonrpc: "2.0", id: 7, method: "eth_chainId", params: [] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: "0x7a69",
    });
    expect(rpcRequest).toHaveBeenCalledOnce();
  });

  it.each([
    "anvil_setBalance",
    "evm_snapshot",
    "hardhat_impersonateAccount",
    "debug_traceCall",
  ])("blocks privileged method %s", async (method) => {
    const rpcRequest = vi.fn<RpcRequester>();
    const app = createApp(rpcRequest);

    const response = await app.inject({
      method: "POST",
      url: "/",
      payload: { jsonrpc: "2.0", id: 9, method, params: [] },
    });

    expect(response.json()).toEqual({
      jsonrpc: "2.0",
      id: 9,
      error: { code: -32601, message: "Method not available" },
    });
    expect(rpcRequest).not.toHaveBeenCalled();
  });

  it("rejects oversized batches without forwarding", async () => {
    const rpcRequest = vi.fn<RpcRequester>();
    const app = createApp(rpcRequest);
    const payload = Array.from({ length: 21 }, (_, id) => ({
      jsonrpc: "2.0",
      id,
      method: "eth_chainId",
      params: [],
    }));

    const response = await app.inject({ method: "POST", url: "/", payload });

    expect(response.statusCode).toBe(400);
    expect(rpcRequest).not.toHaveBeenCalled();
  });
});

describe("faucet", () => {
  it("sets a low balance to the fixed devnet target", async () => {
    const rpcRequest = vi.fn<RpcRequester>((payload) => {
      if (payload.method === "eth_getBalance") {
        return Promise.resolve({
          jsonrpc: "2.0",
          id: payload.id,
          result: "0x0",
        });
      }
      if (payload.method === "anvil_setBalance") {
        return Promise.resolve({
          jsonrpc: "2.0",
          id: payload.id,
          result: null,
        });
      }
      return Promise.reject(new Error("unexpected method"));
    });
    const app = createApp(rpcRequest);

    const response = await app.inject({
      method: "POST",
      url: "/faucet",
      remoteAddress: "192.0.2.1",
      payload: { address },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      address,
      funded: true,
      targetBalanceWei: "10000000000000000000",
      network: { name: "Robyn Devnet", chainId: 31337 },
    });
    expect(rpcRequest).toHaveBeenLastCalledWith({
      jsonrpc: "2.0",
      id: 2,
      method: "anvil_setBalance",
      params: [address, "0x8ac7230489e80000"],
    });
  });

  it("limits the same address to one request per hour", async () => {
    const rpcRequest = vi.fn<RpcRequester>((payload) =>
      Promise.resolve({
        jsonrpc: "2.0",
        id: payload.id,
        result:
          payload.method === "eth_getBalance" ? "0x8ac7230489e80000" : true,
      }),
    );
    const app = createApp(rpcRequest, () => 1_000);

    const first = await app.inject({
      method: "POST",
      url: "/faucet",
      remoteAddress: "192.0.2.2",
      payload: { address },
    });
    const second = await app.inject({
      method: "POST",
      url: "/faucet",
      remoteAddress: "192.0.2.2",
      payload: { address },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: "Address already funded" });
  });
  it("does not consume quota when the upstream request fails", async () => {
    let available = false;
    const rpcRequest = vi.fn<RpcRequester>((payload) => {
      if (!available) return Promise.reject(new Error("offline"));
      return Promise.resolve({
        jsonrpc: "2.0",
        id: payload.id,
        result:
          payload.method === "eth_getBalance" ? "0x8ac7230489e80000" : null,
      });
    });
    const app = createApp(rpcRequest, () => 1_000);

    const failed = await app.inject({
      method: "POST",
      url: "/faucet",
      remoteAddress: "192.0.2.3",
      payload: { address },
    });
    available = true;
    const retried = await app.inject({
      method: "POST",
      url: "/faucet",
      remoteAddress: "192.0.2.3",
      payload: { address },
    });

    expect(failed.statusCode).toBe(503);
    expect(retried.statusCode).toBe(200);
  });
});

describe("health", () => {
  it("reports the expected controlled chain", async () => {
    const app = createApp(() =>
      Promise.resolve({ jsonrpc: "2.0", id: 1, result: "0x7a69" }),
    );

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: "robyn-rpc-gateway",
      status: "ok",
      chainId: 31337,
      upstream: "ok",
    });
  });
});

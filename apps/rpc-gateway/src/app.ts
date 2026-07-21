import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

const jsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);
const jsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: jsonRpcIdSchema.optional(),
    method: z.string().min(1).max(80),
    params: z.array(z.unknown()).optional(),
  })
  .strict();
const faucetRequestSchema = z
  .object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) })
  .strict();

type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;
export type RpcRequester = (payload: JsonRpcRequest) => Promise<unknown>;

const allowedMethods = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getBlockTransactionCountByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getProof",
  "eth_getStorageAt",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_sendRawTransaction",
  "eth_syncing",
  "net_version",
  "web3_clientVersion",
]);

const MAX_BATCH_SIZE = 20;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_IP_REQUESTS = 5;
const TARGET_BALANCE_WEI = 10_000_000_000_000_000_000n;

type RateRecord = { count: number; resetAt: number };

export type GatewayOptions = {
  now?: () => number;
  rpcRequest?: RpcRequester;
};

function errorResponse(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

function parseHexQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error("Upstream returned an invalid quantity");
  }
  return BigInt(value);
}

function toHexQuantity(value: bigint): string {
  return "0x" + value.toString(16);
}

function createDefaultRequester(): RpcRequester {
  const rpcUrl = process.env.RAW_RPC_URL ?? "http://127.0.0.1:8545";
  return async (payload) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error("Raw RPC returned HTTP " + String(response.status));
    return response.json() as Promise<unknown>;
  };
}

function takeRateLimit(
  records: Map<string, RateRecord>,
  key: string,
  maximum: number,
  now: number,
): boolean {
  const current = records.get(key);
  if (!current || current.resetAt <= now) {
    records.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= maximum) return false;
  current.count += 1;
  return true;
}

function releaseRateLimit(records: Map<string, RateRecord>, key: string): void {
  const current = records.get(key);
  if (!current) return;
  if (current.count <= 1) {
    records.delete(key);
    return;
  }
  current.count -= 1;
}

export function buildGateway(options: GatewayOptions = {}): FastifyInstance {
  const now = options.now ?? Date.now;
  const rpcRequest = options.rpcRequest ?? createDefaultRequester();
  const ipRates = new Map<string, RateRecord>();
  const addressRates = new Map<string, RateRecord>();
  const app = Fastify({
    logger: false,
    bodyLimit: 256 * 1024,
    trustProxy: false,
  });

  app.addHook("onSend", async (_request, reply) => {
    void reply
      .header("access-control-allow-origin", "*")
      .header("access-control-allow-methods", "GET,POST,OPTIONS")
      .header("access-control-allow-headers", "content-type")
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff");
  });

  app.options("/*", async (_request, reply) => reply.code(204).send());

  app.get("/health", async (_request, reply) => {
    try {
      const upstream = (await rpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      })) as { result?: unknown };
      if (upstream.result !== "0x7a69") throw new Error("Unexpected chain ID");
      return {
        service: "robyn-rpc-gateway",
        status: "ok",
        chainId: 31337,
        upstream: "ok",
      };
    } catch {
      return reply.code(503).send({
        service: "robyn-rpc-gateway",
        status: "degraded",
        chainId: 31337,
        upstream: "unavailable",
      });
    }
  });

  app.post("/", async (request, reply) => {
    const body = request.body;
    const entries = Array.isArray(body) ? body : [body];
    if (entries.length === 0 || entries.length > MAX_BATCH_SIZE) {
      return reply
        .code(400)
        .send(errorResponse(null, -32600, "Invalid request batch"));
    }

    const responses = await Promise.all(
      entries.map(async (entry) => {
        const parsed = jsonRpcRequestSchema.safeParse(entry);
        if (!parsed.success)
          return errorResponse(null, -32600, "Invalid request");
        if (!allowedMethods.has(parsed.data.method)) {
          return errorResponse(parsed.data.id, -32601, "Method not available");
        }
        try {
          return await rpcRequest(parsed.data);
        } catch {
          return errorResponse(
            parsed.data.id,
            -32000,
            "Upstream RPC unavailable",
          );
        }
      }),
    );

    return Array.isArray(body) ? responses : responses[0];
  });

  app.post("/faucet", async (request, reply) => {
    const parsed = faucetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "A valid EVM address is required" });
    }

    const timestamp = now();
    const address = parsed.data.address.toLowerCase();
    if (!takeRateLimit(ipRates, request.ip, MAX_IP_REQUESTS, timestamp)) {
      return reply
        .code(429)
        .send({ error: "Faucet IP limit reached", retryAfterSeconds: 3600 });
    }
    if (!takeRateLimit(addressRates, address, 1, timestamp)) {
      return reply
        .code(429)
        .send({ error: "Address already funded", retryAfterSeconds: 3600 });
    }

    try {
      const balanceResponse = (await rpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [address, "latest"],
      })) as { result?: unknown };
      const currentBalance = parseHexQuantity(balanceResponse.result);
      let funded = false;
      if (currentBalance < TARGET_BALANCE_WEI) {
        const setResponse = (await rpcRequest({
          jsonrpc: "2.0",
          id: 2,
          method: "anvil_setBalance",
          params: [address, toHexQuantity(TARGET_BALANCE_WEI)],
        })) as { result?: unknown; error?: unknown };
        if (
          setResponse.error ||
          (setResponse.result !== true && setResponse.result !== null)
        ) {
          throw new Error("Unable to set development balance");
        }
        funded = true;
      }

      return {
        address,
        funded,
        targetBalanceWei: TARGET_BALANCE_WEI.toString(),
        network: { name: "Robyn Devnet", chainId: 31337 },
      };
    } catch {
      releaseRateLimit(ipRates, request.ip);
      releaseRateLimit(addressRates, address);
      return reply.code(503).send({ error: "Faucet upstream unavailable" });
    }
  });

  return app;
}

import Fastify from "fastify";

import {
  createHttpUpstreamRequest,
  TestnetRpcFailover,
  type RpcBody,
} from "./failover.js";
import {
  publicRpcPolicyError,
  publicRpcPolicySnapshot,
} from "./public-policy.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name: string, fallback: string): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const host = process.env.HOST ?? "127.0.0.1";
if (host !== "127.0.0.1") {
  throw new Error("The backend RPC failover gateway must bind to loopback");
}
const port = positiveInteger("PORT", "18548");
const selectedProviderValue = process.env.RPC_ACTIVE_PROVIDER ?? "primary";
if (
  selectedProviderValue !== "primary" &&
  selectedProviderValue !== "fallback"
) {
  throw new Error("RPC_ACTIVE_PROVIDER must be primary or fallback");
}
const selectedProvider: "primary" | "fallback" = selectedProviderValue;
const fallbackTrafficAuthorized =
  process.env.RPC_FALLBACK_TRAFFIC_AUTHORIZED === "true";
const transactionSubmissionAuthorized =
  process.env.RPC_TRANSACTION_SUBMISSION_AUTHORIZED === "true";
const controller = new TestnetRpcFailover({
  primaryUrl: required("PRIMARY_RPC_URL"),
  fallbackUrl: required("FALLBACK_RPC_URL"),
  expectedChainId: positiveInteger("EXPECTED_CHAIN_ID", "46630"),
  probeIntervalMs: positiveInteger("RPC_PROBE_INTERVAL_MS", "30000"),
  maximumHeadLagBlocks: positiveInteger("RPC_MAX_HEAD_LAG_BLOCKS", "50"),
  recoveryHeadLagBlocks: positiveInteger("RPC_RECOVERY_HEAD_LAG_BLOCKS", "10"),
  recoveryHealthyProbeTarget: positiveInteger(
    "RPC_RECOVERY_CONSECUTIVE_PROBES",
    "2",
  ),
  request: createHttpUpstreamRequest(
    positiveInteger("RPC_UPSTREAM_TIMEOUT_MS", "15000"),
    positiveInteger("RPC_UPSTREAM_RETRY_COUNT", "3"),
    positiveInteger("RPC_UPSTREAM_RETRY_DELAY_MS", "250"),
  ),
  serviceName: process.env.RPC_SERVICE_NAME ?? "robyn-rpc-failover",
  statusFile:
    process.env.RPC_STATUS_FILE ??
    "/var/lib/robyn/testnet-rpc-gateway/status.json",
  selectedProvider,
  fallbackTrafficAuthorized,
});

await controller.probe();
controller.start();

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 4 * 1024 * 1024,
});

app.get("/health", async (_request, reply) => {
  const snapshot = controller.snapshot();
  return reply.code(snapshot.status === "unavailable" ? 503 : 200).send({
    ...snapshot,
    publicRpcPolicy: publicRpcPolicySnapshot(transactionSubmissionAuthorized),
  });
});

app.post("/", async (request, reply) => {
  try {
    const body = request.body as RpcBody;
    const policyError = publicRpcPolicyError(
      body,
      transactionSubmissionAuthorized,
    );
    if (policyError) return reply.code(200).send(policyError);
    const result = await controller.request(body);
    return reply.code(200).send(result);
  } catch {
    return reply.code(503).send({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32000,
        message: "Selected RPC upstream unavailable; fallback is not automatic",
      },
    });
  }
});

app.addHook("onClose", () => {
  controller.stop();
});

async function shutdown(signal: string) {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  controller.stop();
  process.exit(1);
}

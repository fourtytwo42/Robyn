import { getHealthStatus } from "./health";

export type AdminHealthSnapshot = {
  overall: "ok" | "degraded";
  generatedAt: string;
  releaseSha: string;
  environment: string;
  web: { status: "ok" };
  rpc: {
    status: "ok" | "degraded";
    chainId: number;
    expectedChainId: number;
    blockNumber: string | null;
    latencyMs: number | null;
  };
  indexer: {
    status: "ok" | "degraded";
    asOfBlock: string | null;
    projectionAsOfBlock: string | null;
    kingProjectionAsOfBlock: string | null;
    kingProjectionLagBlocks: string | null;
    ingestionLagBlocks: string | null;
    projectionLagBlocks: string | null;
    ingestionCycleMs: number | null;
    projectionCycleMs: number | null;
    rpcRetryCount: number | null;
    lastRpcDegradationAt: string | null;
    indexedAt: string | null;
  };
  keeper: { status: "ok" | "degraded"; updatedAt: string | null };
  artifacts: { status: "ok" | "degraded"; updatedAt: string | null };
  data: {
    launchCount: string;
    rawLogCount: string;
    kingOfForestAwardCount: string;
    currentKingOfForest: string | null;
  };
};

type StatusPayload = Record<string, unknown>;
type RpcPayload = { result?: unknown };

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function rpcRequest(
  request: typeof fetch,
  url: string,
  method: "eth_chainId" | "eth_blockNumber",
) {
  const response = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    cache: "no-store",
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`${method} failed`);
  return (await response.json()) as RpcPayload;
}

export async function getAdminHealthSnapshot(
  request: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<AdminHealthSnapshot> {
  const expectedChainId = Number(process.env.CHAIN_ID ?? "31337");
  const rpcUrl =
    process.env.RPC_GATEWAY_HEALTH_URL ?? "http://127.0.0.1:8546/health";
  const dataUrl =
    process.env.DATA_API_STATUS_URL ?? "http://127.0.0.1:3100/status";
  const started = Date.now();
  const [chainResult, blockResult, dataResult] = await Promise.allSettled([
    rpcRequest(request, rpcUrl, "eth_chainId"),
    rpcRequest(request, rpcUrl, "eth_blockNumber"),
    request(dataUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    }).then(async (response) => {
      if (!response.ok) throw new Error("data status failed");
      return (await response.json()) as StatusPayload;
    }),
  ]);
  const chainHex =
    chainResult.status === "fulfilled" &&
    typeof chainResult.value.result === "string"
      ? chainResult.value.result
      : null;
  const blockHex =
    blockResult.status === "fulfilled" &&
    typeof blockResult.value.result === "string"
      ? blockResult.value.result
      : null;
  const chainId = chainHex ? Number(BigInt(chainHex)) : 0;
  const blockNumber = blockHex ? BigInt(blockHex).toString() : null;
  const rpcOk = chainId === expectedChainId && blockNumber !== null;
  const data = dataResult.status === "fulfilled" ? dataResult.value : {};
  const ingestionOk = data.ingestionStatus === "ok";
  const projectionOk = data.projectionStatus === "ok";
  const keeperOk = data.keeperStatus === "ok";
  const artifactsOk = data.artifactStatus === "ok";
  const web = getHealthStatus(now);

  return {
    overall:
      rpcOk && ingestionOk && projectionOk && keeperOk && artifactsOk
        ? "ok"
        : "degraded",
    generatedAt: now.toISOString(),
    releaseSha: process.env.ROBYN_RELEASE_SHA ?? "unknown",
    environment: web.environment,
    web: { status: "ok" },
    rpc: {
      status: rpcOk ? "ok" : "degraded",
      chainId,
      expectedChainId,
      blockNumber,
      latencyMs:
        chainResult.status === "fulfilled" || blockResult.status === "fulfilled"
          ? Date.now() - started
          : null,
    },
    indexer: {
      status: ingestionOk && projectionOk ? "ok" : "degraded",
      asOfBlock: stringOrNull(data.asOfBlock),
      projectionAsOfBlock: stringOrNull(data.projectionAsOfBlock),
      kingProjectionAsOfBlock: stringOrNull(data.kingProjectionAsOfBlock),
      kingProjectionLagBlocks: stringOrNull(data.kingProjectionLagBlocks),
      ingestionLagBlocks: stringOrNull(data.ingestionLagBlocks),
      projectionLagBlocks: stringOrNull(data.projectionLagBlocks),
      ingestionCycleMs: numberOrNull(data.ingestionCycleMs),
      projectionCycleMs: numberOrNull(data.projectionCycleMs),
      rpcRetryCount: numberOrNull(data.rpcRetryCount),
      lastRpcDegradationAt: stringOrNull(data.lastRpcDegradationAt),
      indexedAt: stringOrNull(data.indexedAt),
    },
    keeper: {
      status: keeperOk ? "ok" : "degraded",
      updatedAt: stringOrNull(data.keeperUpdatedAt),
    },
    artifacts: {
      status: artifactsOk ? "ok" : "degraded",
      updatedAt: stringOrNull(data.artifactUpdatedAt),
    },
    data: {
      launchCount: stringOrNull(data.launchCount) ?? "0",
      rawLogCount: stringOrNull(data.rawLogCount) ?? "0",
      kingOfForestAwardCount: stringOrNull(data.kingOfForestAwardCount) ?? "0",
      currentKingOfForest: stringOrNull(data.currentKingOfForest),
    },
  };
}

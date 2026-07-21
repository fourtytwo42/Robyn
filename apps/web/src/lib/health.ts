export type HealthStatus = {
  service: "robyn-web";
  status: "ok";
  environment: string;
  timestamp: string;
};
export type GatewayHealth = {
  status: "ok" | "degraded";
  chainId: number;
  upstream: "ok" | "unavailable";
};

export function getHealthStatus(
  now: Date = new Date(),
  environment: string = process.env.ROBYN_ENV ?? "development",
): HealthStatus {
  return {
    service: "robyn-web",
    status: "ok",
    environment,
    timestamp: now.toISOString(),
  };
}

export async function getGatewayHealth(
  request: typeof fetch = fetch,
  url: string = process.env.RPC_GATEWAY_HEALTH_URL ??
    "http://127.0.0.1:8546/health",
  expectedChainId: number = Number(process.env.CHAIN_ID ?? "31337"),
): Promise<GatewayHealth> {
  try {
    const isTestnet = expectedChainId === 46630;
    const response = await request(
      url,
      isTestnet
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_chainId",
              params: [],
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(3_000),
          }
        : { cache: "no-store", signal: AbortSignal.timeout(3_000) },
    );
    if (!response.ok) throw new Error("RPC health request failed");
    if (isTestnet) {
      const payload = (await response.json()) as { result?: unknown };
      if (payload.result !== "0xb626") {
        throw new Error("Testnet RPC chain response was invalid");
      }
      return { status: "ok", chainId: expectedChainId, upstream: "ok" };
    }
    const payload = (await response.json()) as Partial<GatewayHealth>;
    if (
      payload.status !== "ok" ||
      payload.chainId !== expectedChainId ||
      payload.upstream !== "ok"
    ) {
      throw new Error("Gateway health response was invalid");
    }
    return {
      status: payload.status,
      chainId: payload.chainId,
      upstream: payload.upstream,
    };
  } catch {
    return {
      status: "degraded",
      chainId: expectedChainId,
      upstream: "unavailable",
    };
  }
}

export type DataPlaneHealth = {
  status: "ok" | "degraded";
  asOfBlock: string | null;
  launchCount: string;
  keeperStatus: "ok" | "degraded";
  artifactStatus: "ok" | "degraded";
};

export async function getDataPlaneHealth(
  request: typeof fetch = fetch,
  url: string = process.env.DATA_API_STATUS_URL ??
    "http://127.0.0.1:3100/status",
): Promise<DataPlaneHealth> {
  try {
    const response = await request(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error("Data API status request failed");
    const payload = (await response.json()) as Partial<DataPlaneHealth>;
    if (
      typeof payload.asOfBlock !== "string" ||
      typeof payload.launchCount !== "string" ||
      payload.keeperStatus !== "ok" ||
      payload.artifactStatus !== "ok"
    ) {
      throw new Error("Data API status response was invalid");
    }
    return {
      status: "ok",
      asOfBlock: payload.asOfBlock,
      launchCount: payload.launchCount,
      keeperStatus: payload.keeperStatus,
      artifactStatus: payload.artifactStatus,
    };
  } catch {
    return {
      status: "degraded",
      asOfBlock: null,
      launchCount: "0",
      keeperStatus: "degraded",
      artifactStatus: "degraded",
    };
  }
}

export const foundationChecks = [
  "VM-hosted runtime",
  "Controlled Anvil network",
  "Pinned reproducible toolchain",
] as const;

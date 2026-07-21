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
): Promise<GatewayHealth> {
  try {
    const response = await request(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error("Gateway health request failed");
    const payload = (await response.json()) as Partial<GatewayHealth>;
    if (
      payload.status !== "ok" ||
      payload.chainId !== 31337 ||
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
      chainId: 31337,
      upstream: "unavailable",
    };
  }
}

export type DataPlaneHealth = {
  status: "ok" | "degraded";
  asOfBlock: string | null;
  launchCount: string;
  keeperStatus: "ok" | "degraded";
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
      payload.keeperStatus !== "ok"
    ) {
      throw new Error("Data API status response was invalid");
    }
    return {
      status: "ok",
      asOfBlock: payload.asOfBlock,
      launchCount: payload.launchCount,
      keeperStatus: payload.keeperStatus,
    };
  } catch {
    return {
      status: "degraded",
      asOfBlock: null,
      launchCount: "0",
      keeperStatus: "degraded",
    };
  }
}

export const foundationChecks = [
  "VM-hosted runtime",
  "Controlled Anvil network",
  "Pinned reproducible toolchain",
] as const;

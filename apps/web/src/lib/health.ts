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

export const foundationChecks = [
  "VM-hosted runtime",
  "Controlled Anvil network",
  "Pinned reproducible toolchain",
] as const;

export type HealthStatus = {
  service: "robyn-web";
  status: "ok";
  environment: string;
  timestamp: string;
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

export const foundationChecks = [
  "VM-hosted runtime",
  "Controlled Anvil network",
  "Pinned reproducible toolchain",
] as const;

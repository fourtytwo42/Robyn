export type ObservedKeeperStatus = "ok" | "degraded";
export type KeeperHealthStatus = ObservedKeeperStatus | "external";

export function keeperExpectedFromEnvironment(value: string | undefined) {
  return value?.trim().toLowerCase() !== "false";
}

export function keeperExpectedForSchema(
  schemaVersion: number | undefined,
  configuredExpectation: boolean,
) {
  return schemaVersion === 19 ? false : configuredExpectation;
}

export function keeperHealthSatisfied(
  keeperExpected: boolean,
  observedStatus: ObservedKeeperStatus,
) {
  return !keeperExpected || observedStatus === "ok";
}

export function keeperStatusForHealth(
  keeperExpected: boolean,
  observedStatus: ObservedKeeperStatus,
): KeeperHealthStatus {
  return keeperExpected ? observedStatus : "external";
}

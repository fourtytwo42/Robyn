export type LegState = {
  pendingBase: bigint;
  pendingSince: bigint;
  minimumConversionBase: bigint;
  maximumPendingDelay: bigint;
  chainTimestamp: bigint;
};

export function isLegExecutable(state: LegState): boolean {
  if (state.pendingBase === 0n || state.pendingSince === 0n) return false;
  return (
    state.pendingBase >= state.minimumConversionBase ||
    state.chainTimestamp >= state.pendingSince + state.maximumPendingDelay
  );
}

export function conversionJobId(vault: string, legIndex: bigint): string {
  return [
    "convert",
    vault.toLowerCase().replace(/^0x/, ""),
    legIndex.toString(),
  ].join("-");
}

export function isLegacyConversionJobId(
  kind: string | undefined,
  id: string,
): boolean {
  if (kind !== undefined && kind !== "convert") return false;
  return /^convert-[0-9a-f]{40}-[0-9]+-[0-9]+-[0-9]+$/i.test(id);
}
export function failedJobRetryDelayMs(
  attemptsMade: number,
  baseDelayMs = 30_000,
  maximumDelayMs = 3_600_000,
): number {
  if (attemptsMade < 0 || baseDelayMs <= 0 || maximumDelayMs < baseDelayMs) {
    throw new Error("Failed-job retry policy is invalid");
  }
  const exponent = Math.min(Math.max(attemptsMade - 1, 0), 20);
  return Math.min(baseDelayMs * 2 ** exponent, maximumDelayMs);
}

export function isFailedJobRetryDue(
  attemptsMade: number,
  finishedOn: number | undefined,
  now: number,
  baseDelayMs = 30_000,
  maximumDelayMs = 3_600_000,
): boolean {
  if (finishedOn === undefined) return false;
  return (
    now - finishedOn >=
    failedJobRetryDelayMs(attemptsMade, baseDelayMs, maximumDelayMs)
  );
}

function normalizedAddress(address: string): string {
  return address.toLowerCase();
}

export function protocolNativeJobId(token: string): string {
  return `protocol-native-${normalizedAddress(token)}`;
}

export function protocolLaunchJobId(locker: string): string {
  return `protocol-launch-${normalizedAddress(locker)}`;
}

export function harvestJobId(locker: string): string {
  return `harvest-${normalizedAddress(locker)}`;
}

export function isReusableStreamJobKind(kind: string | undefined): boolean {
  return (
    kind === "protocol-native" ||
    kind === "protocol-launch" ||
    kind === "harvest"
  );
}

export function isLegacyStreamJobId(
  kind: string | undefined,
  id: string,
): boolean {
  if (!isReusableStreamJobKind(kind)) return false;
  const prefix = `${kind}-0x`;
  if (!id.startsWith(prefix)) return false;
  const suffix = id.slice(prefix.length);
  return /^[0-9a-f]{40}-[0-9]+$/i.test(suffix);
}

export function boundedProtocolInput(pending: bigint, maximum: bigint): bigint {
  if (maximum <= 0n) throw new Error("Maximum protocol batch must be positive");
  return pending < maximum ? pending : maximum;
}

export function protocolObservationChanged(
  observedAmount: string,
  authoritativeAmount: bigint,
): boolean {
  if (!/^[0-9]+$/.test(observedAmount)) return true;
  return BigInt(observedAmount) !== authoritativeAmount;
}

export function shouldSupersedeProtocolFailure(
  state: string,
  observedAmount: string,
  authoritativeAmount: bigint,
): boolean {
  return (
    (state === "dead_letter" || state === "retrying") &&
    protocolObservationChanged(observedAmount, authoritativeAmount)
  );
}

export function jobBelongsToActiveDeployment(
  token: string | undefined,
  activeTokens: ReadonlySet<string>,
): boolean {
  return typeof token === "string" && activeTokens.has(token.toLowerCase());
}

export function failureAuditState(
  kind: string | undefined,
  terminalAttempt: boolean,
): "retrying" | "dead_letter" {
  if (
    kind === "protocol-native" ||
    kind === "protocol-launch" ||
    !terminalAttempt
  ) {
    return "retrying";
  }
  return "dead_letter";
}

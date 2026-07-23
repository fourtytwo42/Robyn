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

export function conversionJobId(
  vault: string,
  legIndex: bigint,
  pendingSince: bigint,
  pendingBase: bigint,
): string {
  return [
    "convert",
    vault.toLowerCase().replace(/^0x/, ""),
    legIndex.toString(),
    pendingSince.toString(),
    pendingBase.toString(),
  ].join("-");
}

export function boundedProtocolInput(pending: bigint, maximum: bigint): bigint {
  if (maximum <= 0n) throw new Error("Maximum protocol batch must be positive");
  return pending < maximum ? pending : maximum;
}

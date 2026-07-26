import type { LaunchRecord } from "./data-api";

export type HomepageMetrics = {
  activeMarkets24h: number;
  trades24h: number;
  volume24hBase: string;
  volumeLeader24h: Pick<LaunchRecord, "symbol" | "token"> | null;
};

export function deriveHomepageMetrics(
  launches: LaunchRecord[],
): HomepageMetrics {
  let activeMarkets24h = 0;
  let trades24h = 0;
  let volume24hBase = 0n;
  let volumeLeader24h: LaunchRecord | null = null;
  let leadingVolume = 0n;

  for (const launch of launches) {
    const volume = BigInt(launch.metrics?.volume24hBase ?? "0");
    const trades = launch.metrics?.tradeCount24h ?? 0;

    if (volume > 0n || trades > 0) activeMarkets24h += 1;
    trades24h += trades;
    volume24hBase += volume;

    if (
      volume > leadingVolume ||
      (volume === leadingVolume &&
        volume > 0n &&
        volumeLeader24h !== null &&
        launch.token.localeCompare(volumeLeader24h.token) < 0)
    ) {
      volumeLeader24h = launch;
      leadingVolume = volume;
    }
  }

  return {
    activeMarkets24h,
    trades24h,
    volume24hBase: volume24hBase.toString(),
    volumeLeader24h: volumeLeader24h
      ? {
          symbol: volumeLeader24h.symbol,
          token: volumeLeader24h.token,
        }
      : null,
  };
}

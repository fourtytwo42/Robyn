import type { LaunchRecord } from "./data-api";

type RankedLaunch = { launch: LaunchRecord; score: number };

function descendingBigInt(
  launches: LaunchRecord[],
  read: (launch: LaunchRecord) => bigint,
) {
  return [...launches].sort((left, right) => {
    const a = read(left);
    const b = read(right);
    if (a !== b) return a > b ? -1 : 1;
    return Number(BigInt(right.launch_id) - BigInt(left.launch_id));
  });
}

function descendingNumber(
  launches: LaunchRecord[],
  read: (launch: LaunchRecord) => number,
) {
  return [...launches].sort((left, right) => {
    const difference = read(right) - read(left);
    return (
      difference || Number(BigInt(right.launch_id) - BigInt(left.launch_id))
    );
  });
}

function rankMap(launches: LaunchRecord[]) {
  return new Map(launches.map((launch, index) => [launch.token, index]));
}

export function rankActiveMarkets(launches: LaunchRecord[]) {
  const withMetrics = launches.filter((launch) => launch.metrics);
  const withoutMetrics = launches.filter((launch) => !launch.metrics);
  const volumeRanks = rankMap(
    descendingBigInt(withMetrics, (launch) =>
      BigInt(launch.metrics?.volume24hBase ?? "0"),
    ),
  );
  const marketCapRanks = rankMap(
    descendingBigInt(withMetrics, (launch) =>
      BigInt(launch.metrics?.marketCapBase ?? "0"),
    ),
  );
  const traderRanks = rankMap(
    descendingNumber(
      withMetrics,
      (launch) => launch.metrics?.uniqueTraders24h ?? 0,
    ),
  );
  const tradeRanks = rankMap(
    descendingNumber(
      withMetrics,
      (launch) => launch.metrics?.tradeCount24h ?? 0,
    ),
  );
  const ranked: RankedLaunch[] = withMetrics.map((launch) => ({
    launch,
    score:
      (volumeRanks.get(launch.token) ?? withMetrics.length) * 35 +
      (marketCapRanks.get(launch.token) ?? withMetrics.length) * 30 +
      (traderRanks.get(launch.token) ?? withMetrics.length) * 20 +
      (tradeRanks.get(launch.token) ?? withMetrics.length) * 15,
  }));
  ranked.sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    const leftMetrics = left.launch.metrics!;
    const rightMetrics = right.launch.metrics!;
    const leftVolume = BigInt(leftMetrics.volume24hBase);
    const rightVolume = BigInt(rightMetrics.volume24hBase);
    if (leftVolume !== rightVolume) return leftVolume > rightVolume ? -1 : 1;
    const leftCap = BigInt(leftMetrics.marketCapBase);
    const rightCap = BigInt(rightMetrics.marketCapBase);
    if (leftCap !== rightCap) return leftCap > rightCap ? -1 : 1;
    return Number(
      BigInt(right.launch.launch_id) - BigInt(left.launch.launch_id),
    );
  });
  return [...ranked.map(({ launch }) => launch), ...withoutMetrics];
}

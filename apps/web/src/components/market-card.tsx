import Link from "next/link";
import deployment from "@robyn/deployment";
import type { LaunchRecord } from "@/lib/data-api";
import { rewardAssetMetadata } from "@/lib/reward-assets";
import { TokenCardArt } from "@/components/launchpad-visuals";
import { marketAmount, marketCapAmount } from "@/lib/display-format";

function phaseLabel(phase: "legacy_fixed" | "bonding" | "graduated") {
  if (phase === "bonding") return "Bonding";
  if (phase === "graduated") return "Graduated";
  return "Live market";
}

export function MarketCard({
  launch,
  isTestnet,
  window = "24h",
  priority = false,
  ethUsdPrice,
}: {
  launch: LaunchRecord;
  isTestnet: boolean;
  window?: string;
  priority?: boolean;
  ethUsdPrice: number | null;
}) {
  const metrics = launch.metrics;
  const phase = metrics ? phaseLabel(metrics.marketPhase) : "Live market";
  const windowLabel =
    window === "all" ? "All-time" : window === "7d" ? "7d" : window;
  const windowVolume = metrics
    ? window === "1h"
      ? metrics.volume1hBase
      : window === "6h"
        ? metrics.volume6hBase
        : window === "7d"
          ? metrics.volume7dBase
          : window === "all"
            ? metrics.totalVolumeBase
            : metrics.volume24hBase
    : "0";
  const windowTraders = metrics
    ? window === "1h"
      ? metrics.uniqueTraders1h
      : window === "6h"
        ? metrics.uniqueTraders6h
        : window === "7d"
          ? metrics.uniqueTraders7d
          : window === "all"
            ? metrics.uniqueTraderCount
            : metrics.uniqueTraders24h
    : 0;
  const windowTrades = metrics
    ? window === "1h"
      ? metrics.tradeCount1h
      : window === "6h"
        ? metrics.tradeCount6h
        : window === "7d"
          ? metrics.tradeCount7d
          : window === "all"
            ? metrics.tradeCount
            : metrics.tradeCount24h
    : 0;
  const windowChange = metrics
    ? window === "1h"
      ? metrics.change1hBps
      : window === "6h"
        ? metrics.change6hBps
        : window === "7d"
          ? metrics.change7dBps
          : window === "all"
            ? metrics.priceChangeBps
            : metrics.change24hBps
    : null;

  return (
    <Link className="market-card" href={`/launches/${launch.token}`}>
      <TokenCardArt
        symbol={launch.symbol}
        name={launch.name}
        badge={phase}
        launchNumber={launch.launch_id}
        priority={priority}
        {...(launch.metadata?.media_status === "active"
          ? {
              artworkSrc: `/api/media/${launch.metadata.media_id}?cid=${launch.metadata.optimized_webp_cid ?? "active"}`,
            }
          : {})}
      />
      <div className="market-card-copy">
        {launch.kingOfForest?.awarded ? (
          <span
            className={`king-card-chip ${launch.kingOfForest.isCurrent ? "current" : "former"}`}
            title={
              launch.kingOfForest.isCurrent
                ? "Reigning King of the Forest"
                : "Former King of the Forest"
            }
          >
            <span aria-hidden="true">♛</span>
            {launch.kingOfForest.isCurrent
              ? "King of the Forest"
              : "Forest royalty"}
          </span>
        ) : null}
        {launch.automated_test_launch ? (
          <span
            className="campaign-test-chip"
            title={`Assurance campaign ${launch.campaign_id ?? "unavailable"}`}
          >
            Automated test launch
          </span>
        ) : null}
        <div
          className="home-market-basket"
          aria-label="Immutable basket weights"
        >
          {launch.assets.map((asset, index) => {
            const metadata = rewardAssetMetadata(
              asset,
              deployment.contracts.rewardAssets,
              isTestnet,
              deployment.assetCatalog?.assets,
            );
            const weight = (launch.weights_bps[index] ?? 0) / 100;
            return (
              <span
                key={asset}
                title={metadata.name}
                aria-label={`${metadata.name} ${weight}%`}
              >
                {metadata.symbol} · {weight}%
              </span>
            );
          })}
        </div>
        <div className="basket-weight-bar" aria-hidden="true">
          {launch.weights_bps.map((weight, index) => (
            <i
              className={`weight-${(index % 3) + 1}`}
              style={{ width: `${weight / 100}%` }}
              key={`${launch.token}-${index}`}
            />
          ))}
        </div>
        {metrics ? (
          <>
            <dl
              className="home-market-stats"
              aria-label={`${launch.name} market metrics`}
            >
              <div>
                <dt>Market cap</dt>
                <dd>
                  {marketCapAmount(
                    metrics.marketCapBase,
                    metrics.baseSymbol,
                    ethUsdPrice,
                  )}
                </dd>
              </div>
              <div>
                <dt>{windowLabel} volume</dt>
                <dd>{marketAmount(windowVolume, metrics.baseSymbol)}</dd>
              </div>
              <div>
                <dt>{windowLabel} traders</dt>
                <dd>{windowTraders.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{windowLabel} trades</dt>
                <dd>{windowTrades.toLocaleString()}</dd>
              </div>
            </dl>
            {metrics.marketPhase !== "legacy_fixed" ? (
              <div className="graduation-rail home-graduation-rail">
                <div>
                  <span>{phase}</span>
                  <strong>
                    {(metrics.graduationProgressBps / 100).toFixed(1)}%
                  </strong>
                </div>
                <div className="graduation-track" aria-hidden="true">
                  <i
                    style={{
                      width: `${Math.min(100, metrics.graduationProgressBps / 100)}%`,
                    }}
                  />
                </div>
                <small>
                  {metrics.marketPhase === "graduated"
                    ? "Liquidity locked · pool trading live"
                    : `${marketAmount(metrics.baseRaised, metrics.baseSymbol)} raised`}
                </small>
              </div>
            ) : null}
          </>
        ) : (
          <p className="home-market-phase-note">Market metrics unavailable</p>
        )}
        <span className="home-market-action">
          {metrics ? (
            <b
              className={
                windowChange === null
                  ? "market-change flat"
                  : windowChange > 0
                    ? "market-change up"
                    : windowChange < 0
                      ? "market-change down"
                      : "market-change flat"
              }
            >
              {windowChange === null
                ? `No data ${windowLabel}`
                : `${windowChange > 0 ? "+" : ""}${(windowChange / 100).toFixed(
                    2,
                  )}% ${windowLabel}`}
            </b>
          ) : null}
          <span>View market →</span>
        </span>
      </div>
    </Link>
  );
}

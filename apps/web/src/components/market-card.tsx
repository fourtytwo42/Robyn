import Link from "next/link";
import { formatEther } from "viem";
import deployment from "@robyn/deployment";
import type { LaunchRecord } from "@/lib/data-api";
import { rewardAssetMetadata } from "@/lib/reward-assets";
import { TokenCardArt } from "@/components/launchpad-visuals";

function marketAmount(value: string, symbol: string) {
  const amount = Number(formatEther(BigInt(value)));
  return `${amount.toLocaleString(undefined, {
    notation: amount >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: amount >= 1_000 ? 2 : 1,
  })} ${symbol}`;
}

function phaseLabel(phase: "legacy_fixed" | "bonding" | "graduated") {
  if (phase === "bonding") return "Bonding";
  if (phase === "graduated") return "Graduated";
  return "Live market";
}

export function MarketCard({
  launch,
  isTestnet,
  priority = false,
}: {
  launch: LaunchRecord;
  isTestnet: boolean;
  priority?: boolean;
}) {
  const metrics = launch.metrics;
  const phase = metrics ? phaseLabel(metrics.marketPhase) : "Live market";

  return (
    <Link className="market-card" href={`/launches/${launch.token}`}>
      <TokenCardArt
        symbol={launch.symbol}
        name={launch.name}
        badge={phase}
        launchNumber={launch.launch_id}
        priority={priority}
      />
      <div className="market-card-copy">
        <div
          className="home-market-basket"
          aria-label="Immutable basket weights"
        >
          {launch.assets.map((asset, index) => {
            const metadata = rewardAssetMetadata(
              asset,
              deployment.contracts.rewardAssets,
              isTestnet,
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
                  {marketAmount(metrics.marketCapBase, metrics.baseSymbol)}
                </dd>
              </div>
              <div>
                <dt>24h volume</dt>
                <dd>
                  {marketAmount(metrics.volume24hBase, metrics.baseSymbol)}
                </dd>
              </div>
              <div>
                <dt>Holders</dt>
                <dd>{metrics.holderCount.toLocaleString()}</dd>
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
                metrics.change24hBps === null
                  ? "market-change flat"
                  : metrics.change24hBps > 0
                    ? "market-change up"
                    : metrics.change24hBps < 0
                      ? "market-change down"
                      : "market-change flat"
              }
            >
              {metrics.change24hBps === null
                ? "— 24h"
                : `${metrics.change24hBps > 0 ? "+" : ""}${(
                    metrics.change24hBps / 100
                  ).toFixed(2)}% 24h`}
            </b>
          ) : null}
          <span>View market →</span>
        </span>
      </div>
    </Link>
  );
}

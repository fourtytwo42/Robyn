import Link from "next/link";
import type { KingOfForestResponse } from "@/lib/data-api";
import { TokenArt } from "@/components/launchpad-visuals";
import { marketCapAmount } from "@/lib/display-format";
import { rewardAssetMetadata } from "@/lib/reward-assets";
import { publicEnvironment } from "@/lib/public-environment";
import deployment from "@robyn/deployment";

export function KingOfForestSpotlight({
  forest,
  ethUsdPrice,
}: {
  forest: KingOfForestResponse | null;
  ethUsdPrice: number | null;
}) {
  const current = forest?.current ?? null;
  const policy = forest?.policy;
  if (!current) {
    return (
      <section
        className="king-spotlight king-unclaimed"
        aria-labelledby="king-heading"
      >
        <div className="king-crown" aria-hidden="true">
          ♛
        </div>
        <div>
          <p className="eyebrow">King of the Forest</p>
          <h2 id="king-heading">The crown is waiting.</h2>
          <p>
            The next token to reach{" "}
            {(policy?.progressThresholdBps ?? 5000) / 100}% bonding progress and{" "}
            {policy?.minimumUniqueTraders ?? 10} distinct traders will take the
            throne.
          </p>
        </div>
        <Link
          className="button ghost"
          href="/discover?sort=near_graduation&phase=bonding"
        >
          Watch the climb
        </Link>
      </section>
    );
  }
  const metrics = current.metrics;
  const award = current.kingOfForest;
  const basket = current.assets.map((asset, index) => ({
    symbol: rewardAssetMetadata(
      asset,
      deployment.contracts.rewardAssets,
      publicEnvironment.isTestnet,
      deployment.assetCatalog?.assets,
    ).symbol,
    weight: (current.weights_bps[index] ?? 0) / 100,
  }));
  return (
    <section className="king-spotlight" aria-labelledby="king-heading">
      <div className="king-art-wrap">
        <TokenArt
          symbol={current.symbol}
          className="king-token-art"
          {...(current.metadata?.media_status === "active"
            ? {
                artworkSrc: `/api/media/${current.metadata.media_id}?cid=${current.metadata.optimized_webp_cid ?? "active"}`,
              }
            : {})}
        />
        <span className="king-crown" aria-hidden="true">
          ♛
        </span>
      </div>
      <div className="king-copy">
        <p className="eyebrow">Reigning King of the Forest</p>
        <h2 id="king-heading">
          {current.name} <span>${current.symbol}</span>
        </h2>
        <p>
          Crowned{" "}
          {award?.awardedAt
            ? new Date(award.awardedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })
            : "onchain"}{" "}
          with {award?.uniqueTradersAtAward ?? award?.uniqueTraders ?? 0}
          distinct traders after reaching{" "}
          {(
            (award?.progressBpsAtAward ?? award?.progressBps ?? 0) / 100
          ).toFixed(1)}
          % progress.
        </p>
        <div className="king-basket" aria-label="Reward basket">
          {basket.map((asset) => (
            <span key={asset.symbol}>
              {asset.symbol} {asset.weight}%
            </span>
          ))}
        </div>
      </div>
      <dl className="king-stats">
        <div>
          <dt>Market cap</dt>
          <dd>
            {metrics
              ? marketCapAmount(
                  metrics.marketCapBase,
                  metrics.baseSymbol,
                  ethUsdPrice,
                )
              : "Unavailable"}
          </dd>
        </div>
        <div>
          <dt>24h change</dt>
          <dd
            className={
              (metrics?.change24hBps ?? 0) >= 0
                ? "market-change up"
                : "market-change down"
            }
          >
            {metrics?.change24hBps === null ||
            metrics?.change24hBps === undefined
              ? "No history"
              : `${metrics.change24hBps > 0 ? "+" : ""}${(metrics.change24hBps / 100).toFixed(2)}%`}
          </dd>
        </div>
        <div>
          <dt>Phase</dt>
          <dd>
            {metrics?.marketPhase === "graduated" ? "Graduated" : "Bonding"}
          </dd>
        </div>
      </dl>
      <Link className="button primary" href={`/launches/${current.token}`}>
        Enter the market
      </Link>
    </section>
  );
}

import type { Deployment } from "@/lib/deployment";
import { NetworkConsole } from "@robyn/network-console";
import { SiteHeader } from "@/components/site-header";
import deployment from "@robyn/deployment";
import { TokenArt } from "@/components/launchpad-visuals";
import { MarketCard } from "@/components/market-card";
import { MarketingFilm } from "@/components/marketing-film";
import { LaunchTokenTrigger } from "@/components/launch-token-trigger";
import { getKingOfForest, getLaunches } from "@/lib/data-api";
import { deriveHomepageMetrics } from "@/lib/homepage-metrics";
import { rankActiveMarkets } from "@/lib/market-ranking";
import { rewardAssetMetadata } from "@/lib/reward-assets";
import Link from "next/link";
import { formatEther } from "viem";
import { publicEnvironment } from "@/lib/public-environment";
import { getEthUsdPrice } from "@/lib/eth-usd";

export const dynamic = "force-dynamic";

function compactBase(value: string) {
  const amount = Number(formatEther(BigInt(value)));
  return amount.toLocaleString(undefined, {
    notation: amount >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: amount > 0 && amount < 1 ? 6 : 2,
  });
}

export default async function Home() {
  const [launches, ethUsdPrice, forest] = await Promise.all([
    getLaunches(),
    getEthUsdPrice(),
    getKingOfForest().catch(() => null),
  ]);
  const isTestnet = publicEnvironment.isTestnet;
  const marketShowcase = rankActiveMarkets(launches.data).slice(0, 4);
  const featuredMarket = forest?.current ?? marketShowcase[0];
  const homepageMetrics = deriveHomepageMetrics(launches.data);
  const featuredBasket = featuredMarket
    ? featuredMarket.assets
        .map((asset, index) => {
          const metadata = rewardAssetMetadata(
            asset,
            deployment.contracts.rewardAssets,
            isTestnet,
            deployment.assetCatalog?.assets,
          );
          return `${metadata.symbol} ${(featuredMarket.weights_bps[index] ?? 0) / 100}%`;
        })
        .join(" · ")
    : "Choose up to three reward assets.";

  return (
    <main id="main" className="marketing-home">
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />
      <SiteHeader />

      <section className="market-hero" aria-labelledby="hero-heading">
        <div className="market-hero-copy">
          <p className="eyebrow">Markets with roots</p>
          <h1 id="hero-heading">
            Trade communities.
            <br />
            Harvest what they grow.
          </h1>
          <p className="lede">
            Each fixed-supply token grows one immutable basket from its market
            activity. Explore the story, inspect the accounting, and choose what
            deserves your attention.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/discover">
              Explore markets
            </Link>
            <Link className="button ghost" href="/demo">
              Watch the story
            </Link>
          </div>
          <LaunchTokenTrigger className="market-hero-creator">
            Launch your token →
          </LaunchTokenTrigger>
          {publicEnvironment.isDevnet ? (
            <p className="fixture-note">
              Devnet testing environment · assets and transactions have no
              real-world value.
            </p>
          ) : null}
        </div>
        {featuredMarket ? (
          <Link
            className="featured-market"
            href={`/launches/${featuredMarket.token}`}
            aria-label={`Open ${featuredMarket.name} market`}
          >
            <TokenArt
              symbol={featuredMarket.symbol}
              artworkSrc={
                featuredMarket.metadata?.media_status === "active"
                  ? `/api/media/${featuredMarket.metadata.media_id}?cid=${featuredMarket.metadata.optimized_webp_cid ?? "active"}`
                  : undefined
              }
              priority
            />
            <div className="featured-market-crown">
              <span>
                {featuredMarket.kingOfForest?.isCurrent
                  ? "♛ King of the Forest"
                  : "Market leader"}
              </span>
              <strong>{featuredMarket.symbol}</strong>
            </div>
            <div className="featured-market-copy">
              <div>
                <span>{featuredMarket.name}</span>
                <strong>
                  {featuredMarket.metrics
                    ? `${compactBase(featuredMarket.metrics.marketCapBase)} ETH`
                    : "New market"}
                </strong>
              </div>
              <p>{featuredBasket}</p>
            </div>
          </Link>
        ) : (
          <div className="featured-market empty">
            <p>The first grove is waiting.</p>
          </div>
        )}
      </section>

      <section className="launchpad-stats" aria-label="24-hour market activity">
        <article>
          <span>Active markets · 24h</span>
          <strong>{homepageMetrics.activeMarkets24h}</strong>
        </article>
        <article>
          <span>Trades · 24h</span>
          <strong>{homepageMetrics.trades24h.toLocaleString()}</strong>
        </article>
        <article>
          <span>Volume · 24h</span>
          <strong>{compactBase(homepageMetrics.volume24hBase)} ETH</strong>
        </article>
        <article>
          <span>Volume leader</span>
          <strong>
            {homepageMetrics.volumeLeader24h
              ? `$${homepageMetrics.volumeLeader24h.symbol}`
              : "No activity"}
          </strong>
        </article>
      </section>

      <MarketingFilm compact />

      <section
        className="compact-reward-path"
        aria-labelledby="reward-path-heading"
      >
        <div>
          <p className="eyebrow">The loop</p>
          <h2 id="reward-path-heading">One market. Three visible steps.</h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <strong>Choose the roots</strong>
              <p>See the immutable basket before you trade.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Trade the market</strong>
              <p>Activity assigns fees before maintenance begins.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Claim the harvest</strong>
              <p>Pull vested, already acquired basket assets.</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="market-radar" aria-labelledby="market-radar-heading">
        <div className="section-heading launchpad-heading">
          <div>
            <p className="eyebrow">Growing now</p>
            <h2 id="market-radar-heading">Top tokens</h2>
          </div>
          <Link className="text-link" href="/discover">
            View all markets →
          </Link>
        </div>
        <div className="market-card-grid">
          {marketShowcase.map((market) => (
            <MarketCard
              launch={market}
              isTestnet={isTestnet}
              priority={market.token === featuredMarket?.token}
              ethUsdPrice={ethUsdPrice}
              key={market.token}
            />
          ))}
        </div>
      </section>

      <section className="home-cta-grid">
        <Link href="/creators">
          <p className="eyebrow">For creators</p>
          <h2>Launch with a basket, not a hidden allocation.</h2>
          <span>See why creators plant here →</span>
        </Link>
        <Link href="/security">
          <p className="eyebrow">Accounting in plain English</p>
          <h2>Know what moves and what cannot.</h2>
          <span>Read security and risks →</span>
        </Link>
      </section>

      {publicEnvironment.isDevnet ? (
        <details className="devnet-tools">
          <summary>Open Devnet testing tools</summary>
          <p>
            Developer controls below use testing assets and have no real-world
            value.
          </p>
          <NetworkConsole deployment={deployment as Deployment} />
        </details>
      ) : null}
    </main>
  );
}

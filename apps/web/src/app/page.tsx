import type { Deployment } from "@/lib/deployment";
import { NetworkConsole } from "@robyn/network-console";
import { SiteHeader } from "@/components/site-header";
import deployment from "@robyn/deployment";
import { TokenArt } from "@/components/launchpad-visuals";
import { MarketCard } from "@/components/market-card";
import { LaunchTokenTrigger } from "@/components/launch-token-trigger";
import { getLaunches } from "@/lib/data-api";
import { rankActiveMarkets } from "@/lib/market-ranking";
import Link from "next/link";
import { formatEther } from "viem";

export const dynamic = "force-dynamic";

function compactBase(value: string) {
  const amount = Number(formatEther(BigInt(value)));
  return amount.toLocaleString(undefined, {
    notation: amount >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  });
}

export default async function Home() {
  const launches = await getLaunches();
  const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";
  const marketShowcase = rankActiveMarkets(launches.data).slice(0, 4);
  const featuredMarket = marketShowcase[0];
  const rewardAssetCount = new Set(
    launches.data.flatMap((launch) =>
      launch.assets.map((asset) => asset.toLowerCase()),
    ),
  ).size;
  const totalVolume = launches.data.reduce(
    (total, launch) => total + BigInt(launch.metrics?.totalVolumeBase ?? "0"),
    0n,
  );

  return (
    <main id="main">
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />
      <SiteHeader />

      <section className="product-hero" aria-labelledby="hero-heading">
        <div className="hero-copy">
          <p className="eyebrow">Fair launches · built-in reward baskets</p>
          <h1 id="hero-heading">Every token launches with rewards.</h1>
          <p className="lede">
            Every Sherwood Forest token has its own immutable mix of{" "}
            {isTestnet ? "testnet mock" : "mock"} stock and crypto rewards.
            Discover a community, trade its market, then claim the basket assets
            its activity creates.
          </p>
          <div className="hero-actions">
            <LaunchTokenTrigger className="button primary">
              Launch a token
            </LaunchTokenTrigger>
            <Link className="button ghost" href="/discover">
              Explore markets
            </Link>
            <span className="hero-network-copy">
              Permissionless launch architecture ·{" "}
              {isTestnet ? "Robinhood Chain Testnet" : "controlled local chain"}
            </span>
          </div>
        </div>
        <aside
          className="hero-token-card"
          aria-label="Sherwood Forest genesis market"
        >
          <TokenArt
            symbol={featuredMarket?.symbol ?? "TREE"}
            artworkSrc={
              featuredMarket?.metadata?.media_status === "active"
                ? `/api/media/${featuredMarket.metadata.media_id}?cid=${featuredMarket.metadata.optimized_webp_cid ?? "active"}`
                : undefined
            }
            priority
          />
          <div className="hero-token-overlay">
            <span className="hot-chip">Live reward basket</span>
            <div>
              <strong>{featuredMarket?.name ?? "Sherwood Genesis"}</strong>
              <span>{featuredMarket?.symbol ?? "TREE"}</span>
            </div>
            <p>Holders earn 40% TSLA / 40% AMD / 20% AMZN.</p>
          </div>
        </aside>
      </section>

      <section className="launchpad-stats" aria-label="Launchpad activity">
        <article>
          <span>Live markets</span>
          <strong>{launches.data.length}</strong>
        </article>
        <article>
          <span>Reward assets</span>
          <strong>{rewardAssetCount}</strong>
        </article>
        <article>
          <span>Indexed volume</span>
          <strong>{compactBase(totalVolume.toString())} ETH</strong>
        </article>
        <article>
          <span>Basket rules</span>
          <strong>Immutable</strong>
        </article>
      </section>

      <section className="market-radar" aria-labelledby="market-radar-heading">
        <div className="section-heading launchpad-heading">
          <div>
            <p className="eyebrow">Most active</p>
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
              key={market.token}
            />
          ))}
        </div>
      </section>

      <section className="reward-path" aria-labelledby="reward-path-heading">
        <div className="reward-path-copy">
          <p className="eyebrow">How rewards work</p>
          <h2 id="reward-path-heading">Follow a market. Earn its basket.</h2>
          <p>
            Each token publishes its exact reward assets and weights, so you
            know what its activity can earn before you participate.
          </p>
        </div>
        <ol className="reward-path-steps">
          <li>
            <span>01</span>
            <div>
              <strong>Choose a token</strong>
              <p>Review its immutable basket on the token page.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Trade the market</strong>
              <p>A share of protocol fees is converted into basket assets.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Claim rewards</strong>
              <p>Eligible rewards accrue onchain for holders to claim.</p>
            </div>
          </li>
        </ol>
      </section>

      {!isTestnet ? (
        <NetworkConsole deployment={deployment as Deployment} />
      ) : null}
    </main>
  );
}

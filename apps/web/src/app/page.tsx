import type { Deployment } from "@/lib/deployment";
import { NetworkConsole } from "@robyn/network-console";
import { SiteHeader } from "@/components/site-header";
import deployment from "@robyn/deployment";
import { TokenArt } from "@/components/launchpad-visuals";
import { MarketCard } from "@/components/market-card";
import { LaunchTokenTrigger } from "@/components/launch-token-trigger";
import { getLaunches } from "@/lib/data-api";
import { rankActiveMarkets } from "@/lib/market-ranking";
import { rewardAssetMetadata } from "@/lib/reward-assets";
import { ForestCanopy } from "@/components/forest-canopy";
import Link from "next/link";
import { formatEther } from "viem";
import { publicEnvironment } from "@/lib/public-environment";

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
  const isTestnet = publicEnvironment.isTestnet;
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
    : "Choose up to three basket assets.";

  return (
    <main id="main">
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />
      <SiteHeader />

      <section className="product-hero" aria-labelledby="hero-heading">
        <ForestCanopy />
        <div className="hero-copy">
          <p className="eyebrow">Plant tokens · grow reward baskets</p>
          <h1 id="hero-heading">Grow a token worth holding.</h1>
          <p className="lede">
            Every token planted in Sherwood Forest takes root with its own
            immutable mix of{" "}
            {publicEnvironment.isMainnet
              ? "tokenized stock and crypto"
              : isTestnet
                ? "test stock and crypto"
                : "mock stock and crypto"}{" "}
            rewards. Find a community, help its market grow, then harvest the
            basket assets its activity creates.
          </p>
          <div className="hero-actions">
            <LaunchTokenTrigger className="button primary">
              Plant a token
            </LaunchTokenTrigger>
            <Link className="button ghost" href="/discover">
              Roam the markets
            </Link>
            <span className="hero-network-copy">
              Permissionless roots · verifiable growth ·{" "}
              {publicEnvironment.networkLabel}
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
            <span className="hot-chip">Growing now</span>
            <div>
              <strong>{featuredMarket?.name ?? "Sherwood Genesis"}</strong>
              <span>{featuredMarket?.symbol ?? "TREE"}</span>
            </div>
            <p>Reward roots: {featuredBasket}</p>
          </div>
        </aside>
      </section>

      <section className="launchpad-stats" aria-label="Launchpad activity">
        <article>
          <span>Tokens growing</span>
          <strong>{launches.data.length}</strong>
        </article>
        <article>
          <span>Reward assets</span>
          <strong>{rewardAssetCount}</strong>
        </article>
        <article>
          <span>Forest volume</span>
          <strong>{compactBase(totalVolume.toString())} ETH</strong>
        </article>
        <article>
          <span>Reward roots</span>
          <strong>Immutable</strong>
        </article>
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
              key={market.token}
            />
          ))}
        </div>
      </section>

      <section className="reward-path" aria-labelledby="reward-path-heading">
        <div className="reward-path-copy">
          <p className="eyebrow">From seed to harvest</p>
          <h2 id="reward-path-heading">Plant. Trade. Harvest.</h2>
          <p>
            Every token shows its reward roots up front. You always know what
            the market can grow before you step into the grove.
          </p>
        </div>
        <ol className="reward-path-steps">
          <li>
            <span>01</span>
            <div>
              <strong>Pick your grove</strong>
              <p>Choose a token by its immutable reward basket.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Help it grow</strong>
              <p>Market activity turns protocol fees into basket assets.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Harvest rewards</strong>
              <p>Eligible rewards grow onchain until holders claim them.</p>
            </div>
          </li>
        </ol>
      </section>

      {publicEnvironment.isDevnet ? (
        <NetworkConsole deployment={deployment as Deployment} />
      ) : null}
    </main>
  );
}

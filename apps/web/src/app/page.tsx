import type { Deployment } from "@/lib/deployment";
import { NetworkConsole } from "@robyn/network-console";
import { NetworkLaunchpadConsole } from "@robyn/network-launchpad";
import { SiteHeader } from "@/components/site-header";
import {
  getDataPlaneHealth,
  getGatewayHealth,
  getHealthStatus,
} from "@/lib/health";
import deployment from "@robyn/deployment";
import {
  type BasketArtSymbol,
  BasketAssetArt,
  TokenArt,
} from "@/components/launchpad-visuals";
import { MarketCard } from "@/components/market-card";
import { getLaunches } from "@/lib/data-api";
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
  const [gateway, dataPlane, launches] = await Promise.all([
    getGatewayHealth(),
    getDataPlaneHealth(),
    getLaunches(),
  ]);
  const health = getHealthStatus();
  const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";
  const marketShowcase = launches.data.slice(0, 4);
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
            <Link className="button primary" href="/create">
              Launch a token
            </Link>
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
            <p className="eyebrow">Live &amp; rising</p>
            <h2 id="market-radar-heading">
              Choose the rewards you want to earn.
            </h2>
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

      <section
        className="basket-asset-rail"
        aria-label="Available reward basket assets"
      >
        <div className="asset-rail-copy">
          <p className="eyebrow">Inside the basket</p>
          <h2>Recognizable rewards, earned by holding.</h2>
        </div>
        {[
          { symbol: "TSLA", name: "Testnet Tesla", weight: "40%" },
          { symbol: "AMD", name: "Testnet AMD", weight: "40%" },
          { symbol: "AMZN", name: "Testnet Amazon", weight: "20%" },
        ].map((asset) => (
          <article className="basket-asset-tile" key={asset.symbol}>
            <BasketAssetArt symbol={asset.symbol as BasketArtSymbol} />
            <div>
              <strong>{asset.symbol}</strong>
              <span>{asset.name}</span>
            </div>
            <b>{asset.weight}</b>
          </article>
        ))}
      </section>

      <section className="system-strip" aria-label="System status">
        <div>
          <span className="status-dot" />
          Web <strong>{health.status}</strong>
        </div>
        <div data-testid="rpc-status">
          <span className="status-dot" />
          RPC <strong>{gateway.status}</strong>
        </div>
        <div>
          Chain <strong>{gateway.chainId}</strong>
        </div>
        <div data-testid="indexer-status">
          Indexer{" "}
          <strong>
            {dataPlane.status} · block {dataPlane.asOfBlock ?? "unavailable"}
          </strong>
        </div>
        <div data-testid="keeper-status">
          Keeper <strong>{dataPlane.keeperStatus}</strong>
        </div>
        <div data-testid="artifact-status">
          Artifacts <strong>{dataPlane.artifactStatus}</strong>
        </div>
      </section>

      {isTestnet ? (
        <>
          <NetworkConsole deployment={deployment as Deployment} />
          <NetworkLaunchpadConsole deployment={deployment as Deployment} />
        </>
      ) : (
        <>
          <NetworkLaunchpadConsole deployment={deployment as Deployment} />
          <NetworkConsole deployment={deployment as Deployment} />
        </>
      )}

      <section className="notice" aria-label="Development disclaimer">
        {isTestnet
          ? "Robinhood Chain Testnet only. Faucet-issued test stocks and Robyn testnet mocks have no real-world value, backing, or redemption rights."
          : "Development network only. Every asset is a mock with no real-world value. This environment proves the full protocol workflow before testnet deployment."}
      </section>
    </main>
  );
}

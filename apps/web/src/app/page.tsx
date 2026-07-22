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
import { getLaunches } from "@/lib/data-api";
import Link from "next/link";
import { formatEther } from "viem";
import { rewardAssetMetadata } from "@/lib/reward-assets";

export const dynamic = "force-dynamic";

function compactBase(value: string) {
  const amount = Number(formatEther(BigInt(value)));
  return amount.toLocaleString(undefined, {
    notation: amount >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  });
}

function marketAmount(value: string, symbol: string) {
  return `${compactBase(value)} ${symbol}`;
}

function phaseLabel(phase: "legacy_fixed" | "bonding" | "graduated") {
  if (phase === "bonding") return "Bonding";
  if (phase === "graduated") return "Graduated";
  return "Legacy market";
}

export default async function Home() {
  const [gateway, dataPlane, launches] = await Promise.all([
    getGatewayHealth(),
    getDataPlaneHealth(),
    getLaunches(),
  ]);
  const health = getHealthStatus();
  const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";
  const marketShowcase = ["ROBYN", "SOAK", "ONE", "EVID"].flatMap(
    (symbol) => launches.data.find((launch) => launch.symbol === symbol) ?? [],
  );
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
            Every Robyn token has its own immutable mix of{" "}
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
        <aside className="hero-token-card" aria-label="Robyn genesis market">
          <TokenArt symbol="ROBYN" priority />
          <div className="hero-token-overlay">
            <span className="hot-chip">Live reward basket</span>
            <div>
              <strong>Robyn Genesis</strong>
              <span>ROBYN</span>
            </div>
            <p>Holders earn 40% mNVDA / 40% mSPY / 20% mETH.</p>
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
          <strong>{compactBase(totalVolume.toString())} mUSD</strong>
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
            <Link
              className="market-card"
              href={`/launches/${market.token}`}
              key={market.token}
            >
              <div className="market-art-wrap">
                <TokenArt
                  symbol={market.symbol}
                  alt=""
                  priority={market.symbol === "ROBYN"}
                />
                <div className="market-art-badges">
                  <span className="demo-badge">
                    {market.metrics
                      ? phaseLabel(market.metrics.marketPhase)
                      : "Live market"}
                  </span>
                  <span className="market-launch-number">
                    #{market.launch_id}
                  </span>
                </div>
                <div className="market-art-identity">
                  <strong>{market.name}</strong>
                  <span>${market.symbol}</span>
                </div>
              </div>
              <div className="market-card-copy">
                <div
                  className="home-market-basket"
                  aria-label="Immutable basket weights"
                >
                  {market.assets.map((asset, index) => {
                    const metadata = rewardAssetMetadata(
                      asset,
                      deployment.contracts.rewardAssets,
                      isTestnet,
                    );
                    const weight = (market.weights_bps[index] ?? 0) / 100;
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
                  {market.weights_bps.map((weight, index) => (
                    <i
                      className={`weight-${(index % 3) + 1}`}
                      style={{ width: `${weight / 100}%` }}
                      key={`${market.token}-${index}`}
                    />
                  ))}
                </div>
                {market.metrics ? (
                  <>
                    <dl
                      className="home-market-stats"
                      aria-label={`${market.name} market metrics`}
                    >
                      <div>
                        <dt>Market cap</dt>
                        <dd>
                          {marketAmount(
                            market.metrics.marketCapBase,
                            market.metrics.baseSymbol,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Volume</dt>
                        <dd>
                          {marketAmount(
                            market.metrics.totalVolumeBase,
                            market.metrics.baseSymbol,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Holders</dt>
                        <dd>{market.metrics.holderCount.toLocaleString()}</dd>
                      </div>
                    </dl>
                    {market.metrics.marketPhase !== "legacy_fixed" ? (
                      <div className="graduation-rail home-graduation-rail">
                        <div>
                          <span>{phaseLabel(market.metrics.marketPhase)}</span>
                          <strong>
                            {(
                              market.metrics.graduationProgressBps / 100
                            ).toFixed(1)}
                            %
                          </strong>
                        </div>
                        <div className="graduation-track" aria-hidden="true">
                          <i
                            style={{
                              width: `${Math.min(100, market.metrics.graduationProgressBps / 100)}%`,
                            }}
                          />
                        </div>
                        <small>
                          {market.metrics.marketPhase === "graduated"
                            ? "Liquidity locked · pool trading live"
                            : `${marketAmount(market.metrics.baseRaised, market.metrics.baseSymbol)} raised`}
                        </small>
                      </div>
                    ) : (
                      <div className="home-market-phase-note">
                        Legacy fixed-price market
                      </div>
                    )}
                  </>
                ) : (
                  <p className="home-market-phase-note">
                    Market metrics unavailable
                  </p>
                )}
                <span className="home-market-action">View market →</span>
              </div>
            </Link>
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
          { symbol: "mNVDA", name: "Mock NVIDIA", weight: "40%" },
          { symbol: "mSPY", name: "Mock S&P 500", weight: "40%" },
          { symbol: "mETH", name: "Mock Ether", weight: "20%" },
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
          ? "Robinhood Chain Testnet only. Every displayed basket asset is a project-owned mock with no real-world value."
          : "Development network only. Every asset is a mock with no real-world value. This environment proves the full protocol workflow before testnet deployment."}
      </section>
    </main>
  );
}

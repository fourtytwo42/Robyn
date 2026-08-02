import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatEther, type Address } from "viem";
import { NetworkTokenTradePanel } from "@robyn/network-token-trade";
import { NetworkCreatorRewardsPanel } from "@robyn/network-creator-rewards";
import deployment from "@robyn/deployment";
import { TokenMarketChart } from "@/components/token-market-chart";
import { TokenMarketQuote } from "@/components/token-market-quote";
import {
  TokenBasketAssets,
  TokenBasketPreviewChips,
} from "@/components/token-basket-assets";
import { SiteHeader } from "@/components/site-header";
import { getLaunch, getLaunchAnalytics } from "@/lib/data-api";
import { TokenArt } from "@/components/launchpad-visuals";
import type { Deployment } from "@/lib/deployment";
import { rewardAssetMetadata } from "@/lib/reward-assets";
import { TokenActions } from "@/components/token-actions";
import { TokenMarketDataTabs } from "@/components/token-market-data-tabs";
import { publicEnvironment } from "@/lib/public-environment";
import { getEthUsdPrice } from "@/lib/eth-usd";

export const dynamic = "force-dynamic";

function short(address: string) {
  return address.slice(0, 7) + "…" + address.slice(-5);
}

function quantity(value: string, maximumFractionDigits = 2) {
  return Number(formatEther(BigInt(value))).toLocaleString(undefined, {
    notation:
      Number(formatEther(BigInt(value))) >= 100_000 ? "compact" : "standard",
    maximumFractionDigits,
  });
}

function metric(value: string, symbol = "mUSD") {
  return `${quantity(value, 4)} ${symbol}`;
}

function changeLabel(value: number | null) {
  if (value === null) return "Insufficient history";
  return `${value > 0 ? "+" : ""}${(value / 100).toFixed(2)}%`;
}

function marketPhaseLabel(phase: "legacy_fixed" | "bonding" | "graduated") {
  if (phase === "bonding") return "Bonding curve";
  if (phase === "graduated") return "Graduated";
  return "Legacy fixed market";
}

export default async function LaunchDetail({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const isTestnet = publicEnvironment.isTestnet;
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) notFound();
  let detail;
  let analytics;
  let ethUsdPrice;
  try {
    [detail, analytics, ethUsdPrice] = await Promise.all([
      getLaunch(token),
      getLaunchAnalytics(token),
      getEthUsdPrice(),
    ]);
  } catch {
    notFound();
  }
  const launch = detail.data;
  const market = analytics.data;
  const isMainnetCanary =
    publicEnvironment.isMainnet &&
    launch.target_graduation_native === "10000000000000000";
  const quoteSymbol =
    market.liquidityVenue === "uniswap-v4"
      ? "ETH"
      : isTestnet
        ? "tmUSD"
        : "mUSD";
  const basket = launch.assets.map((asset, index) => ({
    ...rewardAssetMetadata(
      asset,
      deployment.contracts.rewardAssets,
      isTestnet,
      deployment.assetCatalog?.assets,
    ),
    address: asset,
    weight: launch.weights_bps[index] ?? 0,
  }));
  const windowVolume = BigInt(market.volume24hBase);
  const buyShare =
    windowVolume === 0n
      ? null
      : Number((BigInt(market.buyVolume24hBase) * 10_000n) / windowVolume) /
        100;

  return (
    <main id="main">
      <div className="ambient ambient-right" aria-hidden="true" />
      <SiteHeader />
      <section className="page-shell token-page-shell">
        <nav className="token-breadcrumb" aria-label="Breadcrumb">
          <Link href="/discover">Discover</Link>
          <span>/</span>
          <span>${launch.symbol}</span>
        </nav>

        <header className="token-overview-card">
          <div className="token-overview-identity">
            <TokenArt
              symbol={launch.symbol}
              className="detail-token-art"
              priority
              {...(launch.metadata?.media_status === "active"
                ? {
                    artworkSrc: `/api/media/${launch.metadata.media_id}?cid=${launch.metadata.optimized_webp_cid ?? "active"}`,
                  }
                : {})}
            />
            <div className="token-identity-copy">
              <div className="token-title-line">
                <p className="eyebrow">Canonical launch #{launch.launch_id}</p>
                <span className="live-chip">
                  {marketPhaseLabel(market.marketPhase)}
                </span>
                {isMainnetCanary ? (
                  <span className="campaign-test-chip">Mainnet Canary</span>
                ) : null}
                {launch.kingOfForest?.awarded ? (
                  <span
                    className={`king-card-chip ${launch.kingOfForest.isCurrent ? "current" : "former"}`}
                  >
                    <span aria-hidden="true">♛</span>
                    {launch.kingOfForest.isCurrent
                      ? "King of the Forest"
                      : "Former King"}
                  </span>
                ) : null}
                {launch.automated_test_launch ? (
                  <span className="campaign-test-chip">
                    Automated test launch
                  </span>
                ) : null}
              </div>
              <h1>
                {launch.name} <span>${launch.symbol}</span>
              </h1>
              <div className="identity-links">
                <code>{short(launch.token)}</code>
                <Link
                  className="creator-identity-link"
                  href={`/users/${launch.creator}`}
                >
                  {launch.metadata?.avatar_media_id ? (
                    <Image
                      src={`/api/media/${launch.metadata.avatar_media_id}`}
                      width={24}
                      height={24}
                      alt=""
                      unoptimized
                    />
                  ) : null}
                  <span>
                    Created by{" "}
                    {launch.metadata?.display_name ?? short(launch.creator)}
                  </span>
                </Link>
                <span>Block {launch.created_block}</span>
              </div>
              <TokenBasketPreviewChips
                assets={basket}
                explorerUrl={publicEnvironment.explorerUrl}
              />
            </div>
            <TokenActions
              chainId={deployment.chainId}
              token={launch.token}
              symbol={launch.symbol}
              creator={launch.creator}
              createdBlock={launch.created_block}
              {...(launch.metadata?.media_status === "active" &&
              launch.metadata.media_id
                ? { mediaId: launch.metadata.media_id }
                : {})}
              {...(launch.metadata?.project_website ||
              launch.metadata?.project_x_url
                ? {
                    projectLinks: {
                      website: launch.metadata.project_website,
                      xUrl: launch.metadata.project_x_url,
                    },
                  }
                : {})}
              {...(launch.metadata?.display_name
                ? {
                    creatorProfile: {
                      displayName: launch.metadata.display_name,
                      bio: launch.metadata.bio ?? "",
                      website: launch.metadata.website,
                      xUrl: launch.metadata.x_url,
                      telegramUrl: launch.metadata.telegram_url,
                      discordUrl: launch.metadata.discord_url,
                      avatarMediaId: launch.metadata.avatar_media_id,
                    },
                  }
                : {})}
            />
          </div>
          <div className="token-overview-market">
            <div className="token-hero-quote">
              <TokenMarketQuote
                marketCapBase={market.marketCapBase}
                priceBasePerToken={market.priceBasePerToken}
                baseSymbol={quoteSymbol}
                tokenSymbol={launch.symbol}
                ethUsdPrice={ethUsdPrice}
              />
              <span className="risk-badge">
                {publicEnvironment.isMainnet
                  ? "Onchain assets"
                  : isTestnet
                    ? "Testnet assets"
                    : "Controlled devnet"}
              </span>
            </div>
            <div
              className="token-overview-stats"
              aria-label="Live market snapshot"
            >
              {[
                {
                  label: "24h change",
                  value: changeLabel(market.change24hBps),
                  tone:
                    market.change24hBps === null
                      ? "neutral"
                      : market.change24hBps >= 0
                        ? "positive"
                        : "negative",
                },
                {
                  label: "24h volume",
                  value: metric(market.volume24hBase, quoteSymbol),
                  tone: "neutral",
                },
                {
                  label: "Buy / sell",
                  value:
                    buyShare === null
                      ? "No window trades"
                      : `${buyShare.toFixed(0)}% / ${(100 - buyShare).toFixed(0)}%`,
                  tone: "flow",
                },
                {
                  label: "24h traders",
                  value: market.uniqueTraders24h.toLocaleString(),
                  tone: "traders",
                },
                {
                  label: "Lifecycle",
                  value: marketPhaseLabel(market.marketPhase),
                  tone: "lifecycle",
                },
              ].map(({ label, value, tone }) => (
                <div className={`token-overview-stat ${tone}`} key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </div>
        </header>

        <NetworkCreatorRewardsPanel
          token={launch.token as Address}
          creator={launch.creator as Address}
        />

        <div className="token-market-layout">
          <div className="token-market-primary">
            <TokenMarketChart
              analytics={market}
              symbol={launch.symbol}
              ethUsdPrice={ethUsdPrice}
            />

            <TokenMarketDataTabs
              holders={market.topHolders}
              holderCount={market.holderCount}
              trades={market.recentTrades}
              symbol={launch.symbol}
              quoteSymbol={quoteSymbol}
              rewardAssetCount={launch.assets.length}
              rewardEconomy={
                <div className="reward-economy-content">
                  <div className="reward-hub-heading">
                    <div>
                      <h3>Trading activity grows a holder-owned basket</h3>
                      <p>
                        Sherwood routes every reward fee through a fixed,
                        transparent split. Basket rewards unlock over one hour
                        while you hold ${launch.symbol}.
                      </p>
                    </div>
                    <span className="live-chip">
                      {launch.assets.length} basket assets
                    </span>
                  </div>

                  <div className="reward-split" aria-label="Fee allocation">
                    {[
                      ["50%", "Reward basket", "holder assets"],
                      ["25%", "Creator", "aligned builder"],
                      ["20%", "DAO members", "governance rewards"],
                      ["5%", "Treasury", "protocol operations"],
                    ].map(([share, label, detail]) => (
                      <div key={label}>
                        <strong>{share}</strong>
                        <span>{label}</span>
                        <small>{detail}</small>
                      </div>
                    ))}
                  </div>

                  <div className="reward-hub-body">
                    <div>
                      <div className="reward-subheading">
                        <span>Immutable basket</span>
                        <small>
                          Not redeemable · earned as streamed rewards
                        </small>
                      </div>
                      <TokenBasketAssets
                        assets={basket}
                        explorerUrl={publicEnvironment.explorerUrl}
                      />
                    </div>
                    <dl className="reward-pulse-metrics">
                      <div>
                        <dt>Fees generated</dt>
                        <dd>{metric(market.totalFeesBase, quoteSymbol)}</dd>
                      </div>
                      <div>
                        <dt>Total volume</dt>
                        <dd>
                          {metric(
                            (
                              BigInt(market.buyVolumeBase) +
                              BigInt(market.sellVolumeBase)
                            ).toString(),
                            quoteSymbol,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Lifetime traders</dt>
                        <dd>{market.uniqueTraderCount}</dd>
                      </div>
                      <div>
                        <dt>Circulating supply</dt>
                        <dd>
                          {quantity(market.circulatingSupply)} {launch.symbol}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <p className="metric-source">
                    Canonical events and current balances through block{" "}
                    {analytics.asOfBlock ?? "unavailable"}.
                  </p>
                </div>
              }
            />
          </div>
          <div className="token-trade-stack">
            <NetworkTokenTradePanel
              deployment={deployment as Deployment}
              token={launch.token as Address}
              market={launch.market as Address}
              symbol={launch.symbol}
              feeBps={market.feeBps}
              basePerToken={market.priceBasePerToken}
              marketPhase={market.marketPhase}
            />

            {market.marketPhase !== "legacy_fixed" ? (
              <section className="compact-market-status lifecycle-compact">
                <div className="compact-status-heading">
                  <span>Launch lifecycle</span>
                  <strong>
                    {(market.graduationProgressBps / 100).toFixed(1)}%
                  </strong>
                </div>
                <h3>
                  {market.marketPhase === "graduated"
                    ? "Locked liquidity live"
                    : "Climbing the bonding curve"}
                </h3>
                <div className="graduation-track" aria-hidden="true">
                  <i
                    style={{
                      width: `${Math.min(100, market.graduationProgressBps / 100)}%`,
                    }}
                  />
                </div>
                <p>
                  {metric(market.baseRaised, quoteSymbol)} raised · target{" "}
                  {metric(market.graduationThresholdBase, quoteSymbol)}
                  {launch.graduation_profile_version
                    ? ` · profile v${launch.graduation_profile_version}`
                    : ""}
                </p>
              </section>
            ) : null}

            {deployment.kingOfForestPolicy ? (
              <section
                className={`compact-market-status king-compact ${launch.kingOfForest?.awarded ? "awarded" : ""}`}
              >
                <div className="compact-status-heading">
                  <span>King of the Forest</span>
                  <strong aria-label="Crown progress">♛</strong>
                </div>
                <h3>
                  {launch.kingOfForest?.isCurrent
                    ? "Reigning over Sherwood"
                    : launch.kingOfForest?.awarded
                      ? "Crowned forever"
                      : "Climb toward the crown"}
                </h3>
                <div className="king-compact-metrics">
                  <span>
                    <b>
                      {(
                        (launch.kingOfForest?.progressBps ??
                          market.graduationProgressBps) / 100
                      ).toFixed(0)}
                      %
                    </b>
                    market growth
                  </span>
                  <span>
                    <b>
                      {launch.kingOfForest?.uniqueTraders ??
                        market.uniqueTraderCount}
                    </b>
                    of {deployment.kingOfForestPolicy.minimumUniqueTraders}{" "}
                    traders
                  </span>
                </div>
              </section>
            ) : null}
          </div>
        </div>

        <section className="notice" aria-label="Reward disclosure">
          {publicEnvironment.isMainnet
            ? "This launch token is not redeemable for the basket. Market values, tokenized assets, rewards, smart contracts and liquidity carry financial and technical risk."
            : `This launch token is not redeemable for the basket. Market values and rewards shown here come from test assets and canonical activity on ${publicEnvironment.networkLabel}; they have no real-world value or production backing.`}
        </section>
      </section>
    </main>
  );
}

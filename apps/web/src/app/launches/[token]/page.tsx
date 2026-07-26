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

function priceMetric(value: string, symbol = "mUSD") {
  return `${quantity(value, 8)} ${symbol}`;
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

        <header className="detail-hero token-detail-hero">
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
                <span
                  className="campaign-test-chip"
                  title={`Campaign ${launch.campaign_id ?? "unavailable"} · release ${launch.campaign_release_sha ?? "unavailable"}`}
                >
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
          <div className="token-hero-quote">
            <TokenMarketQuote
              marketCapBase={market.marketCapBase}
              priceBasePerToken={market.priceBasePerToken}
              baseSymbol={quoteSymbol}
              tokenSymbol={launch.symbol}
              ethUsdPrice={ethUsdPrice}
            />
            <span
              className={`market-change ${
                market.change24hBps === null || market.change24hBps === 0
                  ? "neutral"
                  : market.change24hBps > 0
                    ? "positive"
                    : "negative"
              }`}
            >
              {changeLabel(market.change24hBps)} 24h
            </span>
            <span className="risk-badge">
              {publicEnvironment.isMainnet
                ? "Onchain assets"
                : isTestnet
                  ? "Testnet assets"
                  : "Controlled devnet"}
            </span>
          </div>
        </header>

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
        <NetworkCreatorRewardsPanel
          token={launch.token as Address}
          creator={launch.creator as Address}
        />

        <section
          className="token-metric-grid"
          aria-label="Token market metrics"
        >
          {[
            ["Price", priceMetric(market.priceBasePerToken, quoteSymbol)],
            ["24h change", changeLabel(market.change24hBps)],
            ["24h volume", metric(market.volume24hBase, quoteSymbol)],
            [
              "24h buy / sell",
              buyShare === null
                ? "No window trades"
                : `${buyShare.toFixed(0)}% / ${(100 - buyShare).toFixed(0)}%`,
            ],
            ["Lifecycle", marketPhaseLabel(market.marketPhase)],
            ["24h traders", market.uniqueTraders24h.toLocaleString()],
          ].map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>

        {deployment.kingOfForestPolicy ? (
          <section
            className={`king-progress-card ${launch.kingOfForest?.awarded ? "awarded" : ""}`}
            aria-labelledby="king-progress-heading"
          >
            <div>
              <p className="card-label">King of the Forest</p>
              <h2 id="king-progress-heading">
                {launch.kingOfForest?.isCurrent
                  ? "Reigning over Sherwood"
                  : launch.kingOfForest?.awarded
                    ? "Crowned once, remembered forever"
                    : "Climb toward the crown"}
              </h2>
              <p>
                {launch.kingOfForest?.awarded
                  ? `This token earned its permanent crown with ${launch.kingOfForest.uniqueTradersAtAward ?? launch.kingOfForest.uniqueTraders} distinct traders.`
                  : `Reach ${(deployment.kingOfForestPolicy.progressThresholdBps / 100).toFixed(0)}% progress and ${deployment.kingOfForestPolicy.minimumUniqueTraders} distinct lifetime traders. Graduated tokens remain eligible.`}
              </p>
            </div>
            <div className="king-progress-meters">
              <div>
                <span>Market growth</span>
                <strong>
                  {Math.min(
                    100,
                    ((launch.kingOfForest?.progressBps ??
                      market.graduationProgressBps) /
                      deployment.kingOfForestPolicy.progressThresholdBps) *
                      100,
                  ).toFixed(0)}
                  %
                </strong>
                <div className="graduation-track" aria-hidden="true">
                  <i
                    style={{
                      width: `${Math.min(100, ((launch.kingOfForest?.progressBps ?? market.graduationProgressBps) / deployment.kingOfForestPolicy.progressThresholdBps) * 100)}%`,
                    }}
                  />
                </div>
                <small>
                  {(
                    (launch.kingOfForest?.progressBps ??
                      market.graduationProgressBps) / 100
                  ).toFixed(1)}
                  % of curve
                </small>
              </div>
              <div>
                <span>Distinct traders</span>
                <strong>
                  {Math.min(
                    100,
                    ((launch.kingOfForest?.uniqueTraders ??
                      market.uniqueTraderCount) /
                      deployment.kingOfForestPolicy.minimumUniqueTraders) *
                      100,
                  ).toFixed(0)}
                  %
                </strong>
                <div className="graduation-track" aria-hidden="true">
                  <i
                    style={{
                      width: `${Math.min(100, ((launch.kingOfForest?.uniqueTraders ?? market.uniqueTraderCount) / deployment.kingOfForestPolicy.minimumUniqueTraders) * 100)}%`,
                    }}
                  />
                </div>
                <small>
                  {launch.kingOfForest?.uniqueTraders ??
                    market.uniqueTraderCount}{" "}
                  of {deployment.kingOfForestPolicy.minimumUniqueTraders}{" "}
                  traders
                </small>
              </div>
            </div>
          </section>
        ) : null}

        {market.marketPhase !== "legacy_fixed" ? (
          <section
            className="graduation-card"
            aria-labelledby="graduation-heading"
          >
            <div className="graduation-copy">
              <p className="card-label">Launch lifecycle</p>
              <h2 id="graduation-heading">
                {market.marketPhase === "graduated"
                  ? "Graduated to locked Uniswap liquidity"
                  : "Climbing the bonding curve"}
              </h2>
              <p>
                {market.marketPhase === "graduated"
                  ? market.liquidityVenue === "uniswap-v4"
                    ? `The curve sold out atomically. Native ${publicEnvironment.isMainnet ? "ETH" : "test ETH"} and reserved tokens now trade in a full-range Uniswap position whose NFT and principal cannot be withdrawn. Fees continue funding the basket, creator, DAO members, and treasury.`
                    : market.liquidityVenue === "uniswap-v3"
                      ? "The curve sold out atomically. Its reserved tokens and quote liquidity now trade in a locked Uniswap position whose NFT cannot be withdrawn. Quote-side fees continue funding this token's reward basket."
                      : "The curve sold out atomically. Its remaining token allocation and raised mUSD now trade in a permanently locked local pool."
                  : `Every buy moves the price along the curve. When the curve allocation sells out, the market automatically moves its reserved tokens and raised ${market.baseSymbol} into locked liquidity.`}
              </p>
            </div>
            <div className="graduation-rail">
              <div>
                <span>{metric(market.baseRaised, quoteSymbol)} raised</span>
                <strong>
                  {(market.graduationProgressBps / 100).toFixed(1)}%
                </strong>
              </div>
              <div
                className="graduation-track"
                role="progressbar"
                aria-label="Graduation progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={market.graduationProgressBps / 100}
              >
                <i
                  style={{
                    width: `${Math.min(100, market.graduationProgressBps / 100)}%`,
                  }}
                />
              </div>
              <small>
                Target {metric(market.graduationThresholdBase, quoteSymbol)}
                {market.marketPhase === "bonding"
                  ? ` · ${quantity(market.remainingCurveTokens)} ${launch.symbol} remain on curve`
                  : " · migration complete and irreversible"}
              </small>
            </div>
          </section>
        ) : null}

        <div className="token-market-layout">
          <TokenMarketChart
            analytics={market}
            symbol={launch.symbol}
            ethUsdPrice={ethUsdPrice}
          />
          <NetworkTokenTradePanel
            deployment={deployment as Deployment}
            token={launch.token as Address}
            market={launch.market as Address}
            symbol={launch.symbol}
            feeBps={market.feeBps}
            basePerToken={market.priceBasePerToken}
            marketPhase={market.marketPhase}
          />
        </div>

        <div className="token-reward-layout">
          <section
            className="detail-card basket-detail"
            aria-labelledby="basket-heading"
          >
            <div className="section-heading compact-heading">
              <div>
                <p className="card-label">Immutable reward basket</p>
                <h2 id="basket-heading">What ${launch.symbol} holders earn</h2>
              </div>
              <span className="live-chip">{launch.assets.length} assets</span>
            </div>
            <TokenBasketAssets
              assets={basket}
              explorerUrl={publicEnvironment.explorerUrl}
            />
          </section>

          <section
            className="detail-card reward-economy-card"
            aria-labelledby="reward-economy-heading"
          >
            <p className="card-label">Reward economy</p>
            <h2 id="reward-economy-heading">Fees become holder assets</h2>
            <dl className="economy-metrics">
              <div>
                <dt>Total fees generated</dt>
                <dd>{metric(market.totalFeesBase, quoteSymbol)}</dd>
              </div>
              <div>
                <dt>Buy volume</dt>
                <dd>{metric(market.buyVolumeBase, quoteSymbol)}</dd>
              </div>
              <div>
                <dt>Sell volume</dt>
                <dd>{metric(market.sellVolumeBase, quoteSymbol)}</dd>
              </div>
              <div>
                <dt>Unique traders</dt>
                <dd>{market.uniqueTraderCount}</dd>
              </div>
              <div>
                <dt>Circulating supply</dt>
                <dd>
                  {quantity(market.circulatingSupply)} {launch.symbol}
                </dd>
              </div>
              <div>
                <dt>Market inventory</dt>
                <dd>
                  {quantity(market.tokenReserve)} {launch.symbol}
                </dd>
              </div>
            </dl>
            <p className="metric-source">
              Derived from canonical indexed events and current onchain balances
              through block {analytics.asOfBlock ?? "unavailable"}.
            </p>
          </section>
        </div>

        <div className="token-data-grid">
          <section
            className="market-table-card"
            aria-labelledby="holders-heading"
          >
            <div className="section-heading compact-heading">
              <div>
                <p className="card-label">Ownership</p>
                <h2 id="holders-heading">Top holders</h2>
              </div>
              <span className="live-chip">
                {market.holderCount} holder{" "}
                {market.holderCount === 1 ? "wallet" : "wallets"}
              </span>
            </div>
            <div className="token-table-wrap">
              <table className="token-data-table">
                <thead>
                  <tr>
                    <th>Holder</th>
                    <th>Balance</th>
                    <th>Supply</th>
                  </tr>
                </thead>
                <tbody>
                  {market.topHolders.map((holder, index) => (
                    <tr key={holder.address}>
                      <td>
                        <span className="holder-rank">{index + 1}</span>
                        <code>{short(holder.address)}</code>
                        <small>{holder.label}</small>
                      </td>
                      <td>
                        {quantity(holder.balance)} {launch.symbol}
                      </td>
                      <td>{(Number(holder.shareBps) / 100).toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section
            className="market-table-card"
            aria-labelledby="trades-heading"
            id="recent-trades"
          >
            <div className="section-heading compact-heading">
              <div>
                <p className="card-label">Market tape</p>
                <h2 id="trades-heading">Recent trades</h2>
              </div>
              <span className="live-chip">Canonical</span>
            </div>
            {market.recentTrades.length === 0 ? (
              <p className="empty-state">
                No indexed trades yet. Be the first participant.
              </p>
            ) : (
              <div className="token-table-wrap">
                <table className="token-data-table trade-table">
                  <thead>
                    <tr>
                      <th>Side</th>
                      <th>Trader</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {market.recentTrades.slice(0, 10).map((trade) => (
                      <tr key={trade.transactionHash + trade.blockNumber}>
                        <td>
                          <span className={`trade-side ${trade.side}`}>
                            {trade.side}
                          </span>
                        </td>
                        <td>
                          <code>{short(trade.trader)}</code>
                          <small>Block {trade.blockNumber}</small>
                        </td>
                        <td>
                          {metric(trade.baseAmount, quoteSymbol)}
                          <small>
                            {quantity(trade.tokenAmount)} {launch.symbol}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
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

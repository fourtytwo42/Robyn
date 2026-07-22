import Link from "next/link";
import { notFound } from "next/navigation";
import { formatEther, type Address } from "viem";
import { NetworkTokenTradePanel } from "@robyn/network-token-trade";
import deployment from "@robyn/deployment";
import { LaunchRewardState } from "@/components/launch-reward-state";
import { TokenMarketChart } from "@/components/token-market-chart";
import { SiteHeader } from "@/components/site-header";
import {
  getLaunch,
  getLaunchActivity,
  getLaunchAnalytics,
} from "@/lib/data-api";
import { TokenArt } from "@/components/launchpad-visuals";
import type { Deployment } from "@/lib/deployment";
import { rewardAssetMetadata } from "@/lib/reward-assets";
import { TokenActions } from "@/components/token-actions";

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

function AddressRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <code>{value}</code>
      </dd>
    </div>
  );
}

export default async function LaunchDetail({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) notFound();
  let detail;
  let activity;
  let analytics;
  try {
    [detail, activity, analytics] = await Promise.all([
      getLaunch(token),
      getLaunchActivity(token),
      getLaunchAnalytics(token),
    ]);
  } catch {
    notFound();
  }
  const launch = detail.data;
  const market = analytics.data;
  const basket = launch.assets.map((asset, index) => ({
    ...rewardAssetMetadata(asset, deployment.contracts.rewardAssets, isTestnet),
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
              ? { artworkSrc: `/api/media/${launch.metadata.media_id}` }
              : {})}
          />
          <div className="token-identity-copy">
            <div className="token-title-line">
              <p className="eyebrow">Canonical launch #{launch.launch_id}</p>
              <span className="live-chip">
                {marketPhaseLabel(market.marketPhase)}
              </span>
            </div>
            <h1>
              {launch.name} <span>${launch.symbol}</span>
            </h1>
            <div className="identity-links">
              <code>{short(launch.token)}</code>
              <span>
                Created by{" "}
                {launch.metadata?.display_name ?? short(launch.creator)}
              </span>
              <span>Block {launch.created_block}</span>
            </div>
            <div
              className="decision-basket"
              aria-label="Reward basket composition"
            >
              {basket.map((asset) => (
                <span key={asset.address}>
                  <b>{asset.symbol}</b> {(asset.weight / 100).toFixed(0)}%
                </span>
              ))}
            </div>
          </div>
          <div className="token-hero-quote">
            <span>Market cap</span>
            <strong>{metric(market.marketCapBase)}</strong>
            <small>
              Price {priceMetric(market.priceBasePerToken)} / {launch.symbol}
            </small>
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
              {isTestnet ? "Testnet mocks" : "Controlled devnet"}
            </span>
          </div>
        </header>

        <TokenActions
          chainId={deployment.chainId}
          token={launch.token}
          symbol={launch.symbol}
          creator={launch.creator}
          createdBlock={launch.created_block}
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

        <section
          className="token-metric-grid"
          aria-label="Token market metrics"
        >
          {[
            ["Price", priceMetric(market.priceBasePerToken)],
            ["24h change", changeLabel(market.change24hBps)],
            ["24h volume", metric(market.volume24hBase)],
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

        {market.marketPhase !== "legacy_fixed" ? (
          <section
            className="graduation-card"
            aria-labelledby="graduation-heading"
          >
            <div className="graduation-copy">
              <p className="card-label">Launch lifecycle</p>
              <h2 id="graduation-heading">
                {market.marketPhase === "graduated"
                  ? "Graduated to locked liquidity"
                  : "Climbing the bonding curve"}
              </h2>
              <p>
                {market.marketPhase === "graduated"
                  ? "The curve sold out atomically. Its remaining token allocation and raised mUSD now trade in a permanently locked local pool."
                  : "Every buy moves the price along the curve. When the curve allocation sells out, the market automatically moves its reserved tokens and raised mUSD into locked liquidity."}
              </p>
            </div>
            <div className="graduation-rail">
              <div>
                <span>{metric(market.baseRaised)} raised</span>
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
                Target {metric(market.graduationThresholdBase)}
                {market.marketPhase === "bonding"
                  ? ` · ${quantity(market.remainingCurveTokens)} ${launch.symbol} remain on curve`
                  : " · migration complete and irreversible"}
              </small>
            </div>
          </section>
        ) : null}

        <div className="token-market-layout">
          <TokenMarketChart analytics={market} symbol={launch.symbol} />
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
            <LaunchRewardState
              vault={launch.vault}
              indexedBlock={detail.asOfBlock}
              detailed
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
                <dd>{metric(market.totalFeesBase)}</dd>
              </div>
              <div>
                <dt>Buy volume</dt>
                <dd>{metric(market.buyVolumeBase)}</dd>
              </div>
              <div>
                <dt>Sell volume</dt>
                <dd>{metric(market.sellVolumeBase)}</dd>
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
                          {metric(trade.baseAmount)}
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

        <details className="advanced-token-details">
          <summary>
            <span>
              <b>Contracts, provenance and raw activity</b>
              <small>Advanced verification for this launch</small>
            </span>
            <span>Open details</span>
          </summary>
          <section
            className="verification-card"
            aria-labelledby="verification-heading"
          >
            <div>
              <p className="card-label">Verify independently</p>
              <h2 id="verification-heading">Canonical contracts</h2>
            </div>
            <dl className="address-list verification-list">
              <AddressRow label="Launch token" value={launch.token} />
              <AddressRow label="Reward vault" value={launch.vault} />
              <AddressRow label="Market" value={launch.market} />
              {market.graduatedPool ? (
                <AddressRow
                  label="Graduated liquidity pool"
                  value={market.graduatedPool}
                />
              ) : null}
              <AddressRow label="Creator wallet" value={launch.creator} />
              <AddressRow
                label="Formula version"
                value={launch.formula_version}
              />
              <AddressRow label="Analytics formula" value={market.formula} />
              <AddressRow label="Created block" value={launch.created_block} />
              <AddressRow
                label="Indexed through"
                value={detail.asOfBlock ?? "unavailable"}
              />
            </dl>
          </section>
          <section className="activity-card" aria-labelledby="activity-heading">
            <div className="section-heading">
              <div>
                <p className="card-label">Protocol activity</p>
                <h2 id="activity-heading">Canonical logs</h2>
              </div>
              <span className="live-chip">
                {Math.min(activity.data.length, 20)} shown
              </span>
            </div>
            <ol className="activity-list">
              {activity.data.slice(0, 20).map((event) => (
                <li key={event.transaction_hash + ":" + event.log_index}>
                  <span>Block {event.block_number}</span>
                  <code>{event.transaction_hash}</code>
                  <small>
                    Contract {event.address} · topic{" "}
                    {event.topics[0] ?? "unavailable"}
                  </small>
                </li>
              ))}
            </ol>
          </section>
        </details>

        <section className="notice" aria-label="Reward disclosure">
          This launch token is not redeemable for the basket. Market values and
          rewards shown here come from mock assets and canonical activity on a
          development network; they have no real-world value.
        </section>
      </section>
    </main>
  );
}

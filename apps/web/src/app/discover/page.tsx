import Link from "next/link";
import { formatEther } from "viem";
import { SiteHeader } from "@/components/site-header";
import { getLaunches } from "@/lib/data-api";
import { TokenArt } from "@/components/launchpad-visuals";
import { rewardAssetMetadata } from "@/lib/reward-assets";
import deployment from "@robyn/deployment";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function shortAddress(address: string) {
  return address.slice(0, 8) + "…" + address.slice(-6);
}

function marketAmount(value: string, symbol: string) {
  const amount = Number(formatEther(BigInt(value)));
  return (
    amount.toLocaleString(undefined, {
      notation: amount >= 1_000 ? "compact" : "standard",
      maximumFractionDigits: amount >= 1_000 ? 2 : 1,
    }) +
    " " +
    symbol
  );
}

function phaseLabel(phase: "legacy_fixed" | "bonding" | "graduated") {
  if (phase === "bonding") return "Bonding";
  if (phase === "graduated") return "Graduated";
  return "Legacy market";
}

export default async function Discover({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";
  const filters = {
    q: first(query.q).trim(),
    asset: first(query.asset),
    basketSize: first(query.basketSize),
  };
  const [launches, allLaunches] = await Promise.all([
    getLaunches(filters),
    getLaunches(),
  ]);
  const assets = Array.from(
    new Set(allLaunches.data.flatMap((launch) => launch.assets)),
  ).sort();
  const assetMetadata = new Map(
    assets.map((asset) => [
      asset.toLowerCase(),
      rewardAssetMetadata(asset, deployment.contracts.rewardAssets, isTestnet),
    ]),
  );

  return (
    <main id="main">
      <div className="ambient ambient-left" aria-hidden="true" />
      <SiteHeader />
      <section className="page-shell discovery-page">
        <header className="page-hero discovery-hero">
          <p className="eyebrow">Reward market board</p>
          <h1>Find the token basket you want to hold.</h1>
          <p className="lede">
            Browse every live market without a wallet. Compare market cap,
            activity, holder count, and the immutable assets each community can
            earn.
          </p>
        </header>

        <form className="filter-bar" role="search">
          <label>
            Search name, symbol or canonical address
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="MYCO or 0x…"
            />
          </label>
          <label>
            Basket size
            <select name="basketSize" defaultValue={filters.basketSize}>
              <option value="">Any size</option>
              <option value="1">One asset</option>
              <option value="2">Two assets</option>
              <option value="3">Three assets</option>
            </select>
          </label>
          <label>
            Basket asset
            <select name="asset" defaultValue={filters.asset}>
              <option value="">Any asset</option>
              {assets.map((asset) => (
                <option value={asset} key={asset}>
                  {assetMetadata.get(asset.toLowerCase())?.symbol} —{" "}
                  {assetMetadata.get(asset.toLowerCase())?.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button primary" type="submit">
            Apply filters
          </button>
          <Link className="button ghost" href="/discover">
            Clear
          </Link>
        </form>

        <div className="market-board-toolbar" aria-label="Market board status">
          <div>
            <span className="board-tab active">All markets</span>
            <span className="board-tab">Reward baskets</span>
          </div>
          <p>
            <strong>{launches.data.length} listed</strong>
            <span>Newest indexed first · native-v1</span>
          </p>
        </div>

        {launches.queryStatus === "invalid_address" ? (
          <p className="empty-state" role="status">
            That value starts like an address but is not a valid 20-byte token
            address. No approximate match was shown.
          </p>
        ) : launches.data.length === 0 ? (
          <p className="empty-state" role="status">
            No launches match these filters. The public registry remains
            available without connecting a wallet.
          </p>
        ) : (
          <section className="discovery-grid" aria-label="Launch discovery">
            {launches.data.map((launch, index) => (
              <article className="launch-card" key={launch.token}>
                <div className="launch-card-top">
                  <div className="launch-art-stage">
                    <TokenArt
                      symbol={launch.symbol}
                      alt=""
                      className="launch-card-art"
                      priority={index < 4}
                    />
                    <span>
                      {launch.metrics
                        ? phaseLabel(launch.metrics.marketPhase)
                        : `${launch.assets.length} asset basket`}
                    </span>
                  </div>
                  <div className="launch-card-copy">
                    <div className="launch-card-heading">
                      <div>
                        <span className="asset-symbol">{launch.symbol}</span>
                        <h2>{launch.name}</h2>
                      </div>
                      <span className="live-chip">#{launch.launch_id}</span>
                    </div>
                    <Link
                      className="canonical-address"
                      href={"/launches/" + launch.token}
                      aria-label={launch.name + " token " + launch.token}
                    >
                      {shortAddress(launch.token)}
                    </Link>
                    <div
                      className="basket-chips"
                      aria-label="Immutable basket weights"
                    >
                      {launch.assets.map((asset, assetIndex) => {
                        const metadata = assetMetadata.get(asset.toLowerCase());
                        const weight =
                          (launch.weights_bps[assetIndex] ?? 0) / 100;
                        return (
                          <span
                            key={asset}
                            title={metadata?.name}
                            aria-label={
                              (metadata?.name ?? "Unverified asset") +
                              " " +
                              weight +
                              "%"
                            }
                          >
                            {metadata?.symbol} · {weight}%
                          </span>
                        );
                      })}
                    </div>
                    <div className="basket-weight-bar" aria-hidden="true">
                      {launch.weights_bps.map((weight, weightIndex) => (
                        <i
                          className={`weight-${(weightIndex % 3) + 1}`}
                          style={{ width: `${weight / 100}%` }}
                          key={`${launch.token}-${weightIndex}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                {launch.metrics ? (
                  <>
                    <dl
                      className="launch-market-stats"
                      aria-label={launch.name + " market metrics"}
                    >
                      <div>
                        <dt>Market cap</dt>
                        <dd>
                          {marketAmount(
                            launch.metrics.marketCapBase,
                            launch.metrics.baseSymbol,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Total volume</dt>
                        <dd>
                          {marketAmount(
                            launch.metrics.totalVolumeBase,
                            launch.metrics.baseSymbol,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Holders</dt>
                        <dd>{launch.metrics.holderCount.toLocaleString()}</dd>
                      </div>
                    </dl>
                    {launch.metrics.marketPhase !== "legacy_fixed" ? (
                      <div className="graduation-rail compact-graduation">
                        <div>
                          <span>{phaseLabel(launch.metrics.marketPhase)}</span>
                          <strong>
                            {(
                              launch.metrics.graduationProgressBps / 100
                            ).toFixed(1)}
                            %
                          </strong>
                        </div>
                        <div className="graduation-track" aria-hidden="true">
                          <i
                            style={{
                              width: `${Math.min(100, launch.metrics.graduationProgressBps / 100)}%`,
                            }}
                          />
                        </div>
                        <small>
                          {launch.metrics.marketPhase === "graduated"
                            ? "Liquidity locked. Trading continues in the graduated pool."
                            : `${marketAmount(launch.metrics.baseRaised, launch.metrics.baseSymbol)} raised toward graduation`}
                        </small>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="launch-metrics-unavailable">
                    Market metrics unavailable
                  </p>
                )}
                <Link className="button" href={"/launches/" + launch.token}>
                  View market
                </Link>
              </article>
            ))}
          </section>
        )}

        <p className="freshness page-freshness">
          Registry indexed at block {launches.asOfBlock ?? "unavailable"} ·{" "}
          {launches.indexedAt ?? "timestamp unavailable"}
        </p>
      </section>
      <section className="notice" aria-label="Network disclaimer">
        {isTestnet
          ? "Robinhood Chain Testnet only. Project-owned mock assets have no real-world value, and the community token is not redeemable for its reward basket."
          : "Development network only. Mock assets have no financial value, and the community token is not redeemable for its reward basket."}
      </section>
    </main>
  );
}

import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { getLaunches } from "@/lib/data-api";
import { MarketCard } from "@/components/market-card";
import { rewardAssetMetadata } from "@/lib/reward-assets";
import deployment from "@robyn/deployment";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
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
              <MarketCard
                launch={launch}
                isTestnet={isTestnet}
                priority={index < 4}
                key={launch.token}
              />
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

import Link from "next/link";
import { LaunchRewardState } from "@/components/launch-reward-state";
import { SiteHeader } from "@/components/site-header";
import { getLaunches } from "@/lib/data-api";
import { TokenArt } from "@/components/launchpad-visuals";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function short(address: string) {
  return address.slice(0, 8) + "…" + address.slice(-6);
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

  return (
    <main id="main">
      <div className="ambient ambient-left" aria-hidden="true" />
      <SiteHeader />
      <section className="page-shell">
        <header className="page-hero">
          <p className="eyebrow">Every token, its own basket</p>
          <h1>Discover tokens by the rewards they earn.</h1>
          <p className="lede">
            Browse communities without a wallet and compare their immutable
            reward baskets. Pending and purchased rewards are read live from the{" "}
            {isTestnet
              ? "Robinhood testnet rehearsal"
              : "controlled development"}{" "}
            chain.
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
                  {short(asset)}
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

        <div className="ranking-note">
          <strong>Ranking: newest indexed launch first.</strong> Formula{" "}
          <code>native-v1</code>. Raw volume and projected rewards are excluded
          so self-trading cannot dominate this view.
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
            {launches.data.map((launch) => (
              <article className="launch-card" key={launch.token}>
                <TokenArt
                  symbol={launch.symbol}
                  alt=""
                  className="launch-card-art"
                />
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
                >
                  {launch.token}
                </Link>
                <div
                  className="basket-chips"
                  aria-label="Immutable basket weights"
                >
                  {launch.assets.map((asset, index) => (
                    <span key={asset}>
                      {short(asset)} · {(launch.weights_bps[index] ?? 0) / 100}%
                    </span>
                  ))}
                </div>
                <LaunchRewardState
                  vault={launch.vault}
                  indexedBlock={launches.asOfBlock}
                />
                <Link className="button" href={"/launches/" + launch.token}>
                  Inspect launch
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

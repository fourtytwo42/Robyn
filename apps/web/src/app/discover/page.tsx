import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { getLaunches } from "@/lib/data-api";
import { MarketCard } from "@/components/market-card";
import { DiscoveryControls } from "@/components/discovery-controls";
import { rewardAssetMetadata } from "@/lib/reward-assets";
import deployment from "@robyn/deployment";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function marketViewHref(
  filters: Record<string, string>,
  view: { sort: string; phase?: string },
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && key !== "sort" && key !== "phase") params.set(key, value);
  }
  params.set("sort", view.sort);
  params.set("phase", view.phase ?? "all");
  return `/discover?${params.toString()}`;
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
    sort: first(query.sort) || "trending",
    window: first(query.window) || "24h",
    phase: first(query.phase) || "all",
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
  const assetOptions = assets.map((asset) => ({
    value: asset,
    symbol: assetMetadata.get(asset.toLowerCase())?.symbol ?? "Asset",
    name: assetMetadata.get(asset.toLowerCase())?.name ?? "Unverified asset",
  }));
  const views = [
    { label: "Trending", sort: "trending" },
    { label: "New", sort: "new" },
    { label: "Near graduation", sort: "near_graduation", phase: "bonding" },
    { label: "Graduated", sort: "graduated", phase: "graduated" },
  ];

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

        <DiscoveryControls filters={filters} assets={assetOptions} />

        <div className="market-board-toolbar" aria-label="Market board status">
          <div>
            {views.map((view) => {
              const active =
                filters.sort === view.sort &&
                filters.phase === (view.phase ?? "all");
              return (
                <Link
                  className={`board-tab ${active ? "active" : ""}`}
                  href={marketViewHref(filters, view)}
                  key={view.sort}
                >
                  {view.label}
                </Link>
              );
            })}
          </div>
          <p>
            <strong>{launches.data.length} listed</strong>
            <span>{filters.window} indexed window · native-v1</span>
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

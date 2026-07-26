"use client";

import Link from "next/link";
import { useState } from "react";

type Filters = {
  q: string;
  asset: string;
  sort: string;
  window: string;
  phase: string;
};

export function DiscoveryControls({
  filters,
  assets,
}: {
  filters: Filters;
  assets: Array<{ value: string; symbol: string; name: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = [
    filters.q ? `Search: ${filters.q}` : null,
    filters.asset ? "Basket asset" : null,
    filters.sort !== "trending"
      ? `Sort: ${filters.sort.replaceAll("_", " ")}`
      : null,
    filters.phase !== "all" ? filters.phase : null,
    filters.window !== "24h" ? filters.window : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <form
        className={`filter-bar ${expanded ? "filters-open" : ""}`}
        role="search"
      >
        <label className="filter-search">
          Search name, symbol or canonical address
          <input name="q" defaultValue={filters.q} placeholder="MYCO or 0x…" />
        </label>
        <button
          className="button ghost mobile-filter-toggle"
          type="button"
          aria-expanded={expanded}
          aria-controls="market-filter-options"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? "Hide filters"
            : `Filters${active.length ? ` (${active.length})` : ""}`}
        </button>
        <div className="filter-advanced" id="market-filter-options">
          <label>
            Basket asset
            <select name="asset" defaultValue={filters.asset}>
              <option value="">Any asset</option>
              {assets.map((asset) => (
                <option value={asset.value} key={asset.value}>
                  {asset.symbol} · {asset.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort by
            <select name="sort" defaultValue={filters.sort}>
              <option value="trending">Trending</option>
              <option value="new">Newest</option>
              <option value="near_graduation">Near graduation</option>
              <option value="graduated">Graduated</option>
              <option value="volume">Volume</option>
              <option value="market_cap">Market cap</option>
            </select>
          </label>
          <label>
            Window
            <select name="window" defaultValue={filters.window}>
              <option value="1h">1 hour</option>
              <option value="6h">6 hours</option>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="all">All time</option>
            </select>
          </label>
          <input type="hidden" name="phase" value={filters.phase} />
          <button className="button primary" type="submit">
            Apply filters
          </button>
          <Link className="button ghost" href="/discover">
            Clear
          </Link>
        </div>
      </form>
      {active.length ? (
        <div className="applied-filter-chips" aria-label="Applied filters">
          {active.map((label) => (
            <span key={label}>{label}</span>
          ))}
          <Link href="/discover">Clear all</Link>
        </div>
      ) : null}
    </>
  );
}

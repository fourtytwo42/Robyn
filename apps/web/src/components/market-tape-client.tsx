"use client";

import Link from "next/link";
import { useState } from "react";
import { marketAmount } from "@/lib/display-format";

type TapeMarket = {
  token: string;
  symbol: string;
  marketCapBase: string;
  baseSymbol: string;
  change24hBps: number | null;
};

function MarketLink({
  market,
  duplicate = false,
}: {
  market: TapeMarket;
  duplicate?: boolean;
}) {
  const change = market.change24hBps;
  return (
    <Link
      href={`/launches/${market.token}`}
      tabIndex={duplicate ? -1 : undefined}
      aria-hidden={duplicate || undefined}
    >
      <strong>${market.symbol}</strong>
      <span>{marketAmount(market.marketCapBase, market.baseSymbol)}</span>
      <small
        aria-label={
          change === null
            ? "24 hour change unavailable"
            : `Indexed 24 hour change ${(change / 100).toFixed(2)} percent`
        }
        className={
          change === null || change === 0
            ? "market-change neutral"
            : change > 0
              ? "market-change positive"
              : "market-change negative"
        }
      >
        {change === null
          ? "— 24h"
          : `${change > 0 ? "+" : ""}${(change / 100).toFixed(2)}%`}
      </small>
    </Link>
  );
}

export function MarketTapeClient({ markets }: { markets: TapeMarket[] }) {
  const [paused, setPaused] = useState(false);
  return (
    <aside
      className={`market-tape ${paused ? "tape-paused" : ""}`}
      aria-label="Indexed 24 hour reward market tape"
    >
      <span className="market-tape-label">
        <i aria-hidden="true" />
        24h reward markets
      </span>
      <div className="market-tape-track">
        {markets.length === 0 ? (
          <span className="market-tape-empty">Market data is loading.</span>
        ) : (
          <div className="market-tape-runner">
            {markets.map((market) => (
              <MarketLink market={market} key={market.token} />
            ))}
            {markets.map((market) => (
              <MarketLink
                market={market}
                duplicate
                key={`duplicate-${market.token}`}
              />
            ))}
          </div>
        )}
      </div>
      <button
        className="market-tape-pause"
        type="button"
        onClick={() => setPaused((value) => !value)}
        aria-pressed={paused}
      >
        {paused ? "Play" : "Pause"}
      </button>
    </aside>
  );
}

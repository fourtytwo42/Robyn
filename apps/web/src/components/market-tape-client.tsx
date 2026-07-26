"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { marketAmount } from "@/lib/display-format";
import {
  marketTapeDurationSeconds,
  marketTapeRepeatCount,
} from "@/lib/market-tape";

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
  const trackRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [repeatCount, setRepeatCount] = useState(1);
  const [durationSeconds, setDurationSeconds] = useState(24);

  useEffect(() => {
    const track = trackRef.current;
    const probe = probeRef.current;
    if (!track || !probe || markets.length === 0) return;

    const measure = () => {
      const nextRepeatCount = marketTapeRepeatCount(
        track.clientWidth,
        probe.scrollWidth,
      );
      setRepeatCount(nextRepeatCount);
      setDurationSeconds(
        marketTapeDurationSeconds(probe.scrollWidth * nextRepeatCount),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [markets]);

  const animationStyle = {
    "--market-tape-duration": `${durationSeconds}s`,
  } as CSSProperties;

  return (
    <aside className="market-tape" aria-label="Indexed 24 hour market tape">
      <div className="market-tape-track" ref={trackRef}>
        {markets.length === 0 ? (
          <span className="market-tape-empty">Market data is loading.</span>
        ) : (
          <>
            <div
              className="market-tape-probe"
              ref={probeRef}
              aria-hidden="true"
            >
              {markets.map((market) => (
                <MarketLink
                  market={market}
                  duplicate
                  key={`probe-${market.token}`}
                />
              ))}
            </div>
            <div className="market-tape-runner" style={animationStyle}>
              {[0, 1].map((groupIndex) => (
                <div className="market-tape-group" key={`group-${groupIndex}`}>
                  {Array.from({ length: repeatCount }, (_, repeatIndex) =>
                    markets.map((market) => (
                      <MarketLink
                        market={market}
                        duplicate={groupIndex > 0 || repeatIndex > 0}
                        key={`${groupIndex}-${repeatIndex}-${market.token}`}
                      />
                    )),
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

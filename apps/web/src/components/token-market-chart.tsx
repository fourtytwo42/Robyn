"use client";

import { useMemo, useState } from "react";
import type { LaunchAnalytics } from "@/lib/data-api";

function units(value: string) {
  return Number(BigInt(value)) / 1e18;
}

function compact(value: number) {
  return value.toLocaleString(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value < 1 ? 4 : 2,
  });
}

export function TokenMarketChart({
  analytics,
  symbol,
}: {
  analytics: LaunchAnalytics["data"];
  symbol: string;
}) {
  const [mode, setMode] = useState<"price" | "volume">("price");
  const points = useMemo(() => {
    const source =
      analytics.chart.length > 1
        ? analytics.chart
        : [...analytics.chart, ...analytics.chart];
    const values = source.map((point) =>
      mode === "price" ? units(point.price) : units(point.cumulativeVolume),
    );
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range =
      max === min ? Math.max(Math.abs(max) * 0.12, 0.0001) : max - min;
    return source.map((point, index) => ({
      ...point,
      value: values[index] ?? 0,
      x: 32 + (index / Math.max(source.length - 1, 1)) * 696,
      y:
        252 -
        (((values[index] ?? 0) - min + (max === min ? range / 2 : 0)) / range) *
          200,
    }));
  }, [analytics.chart, mode]);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const last = points.at(-1)?.value ?? 0;

  return (
    <section
      className="market-chart-card"
      aria-labelledby="market-chart-heading"
    >
      <div className="chart-heading-row">
        <div>
          <p className="card-label">Canonical market activity</p>
          <h2 id="market-chart-heading">
            {mode === "price" ? `${symbol} price` : "Cumulative volume"}
          </h2>
          <strong className="chart-current">
            {compact(last)} {analytics.baseSymbol}
          </strong>
        </div>
        <div className="chart-tabs" role="tablist" aria-label="Chart metric">
          <button
            role="tab"
            aria-selected={mode === "price"}
            className={mode === "price" ? "active" : ""}
            onClick={() => setMode("price")}
          >
            Price
          </button>
          <button
            role="tab"
            aria-selected={mode === "volume"}
            className={mode === "volume" ? "active" : ""}
            onClick={() => setMode("volume")}
          >
            Volume
          </button>
        </div>
      </div>
      <div className="chart-canvas">
        <svg
          viewBox="0 0 760 280"
          role="img"
          aria-label={`${mode} chart with ${points.length} canonical points`}
        >
          <defs>
            <linearGradient id="robyn-chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#35d0ba" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#35d0ba" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[52, 102, 152, 202, 252].map((y) => (
            <line
              key={y}
              x1="32"
              x2="728"
              y1={y}
              y2={y}
              className="chart-grid-line"
            />
          ))}
          <path
            d={`${path} L728,252 L32,252 Z`}
            fill="url(#robyn-chart-fill)"
          />
          <path d={path} className="chart-line" />
          {points.length <= 16
            ? points.map((point) => (
                <circle
                  key={`${point.blockNumber}-${point.x}`}
                  cx={point.x}
                  cy={point.y}
                  r="4"
                  className="chart-point"
                />
              ))
            : null}
        </svg>
      </div>
      <div className="chart-foot">
        <span>Launch</span>
        <span>{analytics.tradeCount} canonical trades</span>
        <span>Indexed now</span>
      </div>
      {analytics.marketType === "fixed-price-development-market" ? (
        <p className="chart-disclosure">
          This controlled market uses a fixed mock price, so the price line is
          intentionally flat. Volume still reflects every indexed buy and sell.
        </p>
      ) : null}
    </section>
  );
}

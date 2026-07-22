"use client";

import { useId, useMemo, useState } from "react";
import type { LaunchAnalytics } from "@/lib/data-api";

type Range = "1h" | "24h" | "7d" | "all";

function units(value: string) {
  return Number(BigInt(value)) / 1e18;
}

function compact(value: number) {
  return value.toLocaleString("en-US", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits:
      Math.abs(value) < 0.01 ? 8 : Math.abs(value) < 1 ? 4 : 2,
  });
}

function timeLabel(timestamp: string | null, blockNumber: string) {
  if (!timestamp) return `Block ${blockNumber}`;
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function TokenMarketChart({
  analytics,
  symbol,
}: {
  analytics: LaunchAnalytics["data"];
  symbol: string;
}) {
  const gradientId = useId();
  const [mode, setMode] = useState<"price" | "volume">("price");
  const [range, setRange] = useState<Range>("24h");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    const cutoff =
      range === "all"
        ? 0
        : Date.now() -
          {
            "1h": 60 * 60 * 1000,
            "24h": 24 * 60 * 60 * 1000,
            "7d": 7 * 24 * 60 * 60 * 1000,
          }[range];
    const inRange = analytics.chart.filter(
      (point) => point.timestamp && Date.parse(point.timestamp) >= cutoff,
    );
    const firstIndex = inRange.length
      ? analytics.chart.indexOf(inRange[0]!)
      : analytics.chart.length - 1;
    const baseline = firstIndex > 0 ? analytics.chart[firstIndex - 1] : null;
    const selected =
      range === "all"
        ? analytics.chart
        : [...(baseline ? [baseline] : []), ...inRange];
    const source = selected.length ? selected : analytics.chart.slice(-1);
    let windowVolume = 0;
    const raw = source.map((point) => {
      if (point.eventType === "trade") windowVolume += units(point.baseAmount);
      return {
        ...point,
        value: mode === "price" ? units(point.price) : windowVolume,
      };
    });
    const values = raw.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = max === min ? Math.max(Math.abs(max) * 0.12, 0.0001) : 0;
    const low = min - padding;
    const high = max + padding;
    const spread = Math.max(high - low, 0.0001);
    const points = raw.map((point, index) => ({
      ...point,
      x: 60 + (index / Math.max(raw.length - 1, 1)) * 650,
      y: 238 - ((point.value - low) / spread) * 184,
    }));
    return { points, low, high };
  }, [analytics.chart, mode, range]);

  const path = chart.points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const active =
    activeIndex === null ? null : (chart.points[activeIndex] ?? null);
  const current = chart.points.at(-1)?.value ?? 0;
  const insufficient =
    range !== "all" &&
    chart.points.filter((point) => point.eventType === "trade").length === 0;

  function moveTooltip(index: number, direction: number) {
    setActiveIndex(
      Math.max(0, Math.min(chart.points.length - 1, index + direction)),
    );
  }

  return (
    <section
      className="market-chart-card"
      aria-labelledby="market-chart-heading"
    >
      <div className="chart-heading-row">
        <div>
          <p className="card-label">Canonical market activity</p>
          <h2 id="market-chart-heading">
            {mode === "price" ? `${symbol} price` : "Window volume"}
          </h2>
          <strong className="chart-current">
            {compact(current)} {analytics.baseSymbol}
          </strong>
        </div>
        <div className="chart-tabs" role="tablist" aria-label="Chart metric">
          {(["price", "volume"] as const).map((metric) => (
            <button
              key={metric}
              type="button"
              role="tab"
              aria-selected={mode === metric}
              className={mode === metric ? "active" : ""}
              onClick={() => {
                setMode(metric);
                setActiveIndex(null);
              }}
            >
              {metric === "price" ? "Price" : "Volume"}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-range-tabs" aria-label="Chart time range">
        {(["1h", "24h", "7d", "all"] as const).map((period) => (
          <button
            type="button"
            className={range === period ? "active" : ""}
            aria-pressed={range === period}
            onClick={() => {
              setRange(period);
              setActiveIndex(null);
            }}
            key={period}
          >
            {period === "all" ? "All" : period.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="chart-canvas">
        <svg
          viewBox="0 0 760 280"
          role="img"
          aria-label={`${mode} chart with ${chart.points.length} canonical points`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#35d0ba" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#35d0ba" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[54, 100, 146, 192, 238].map((y, index) => (
            <g key={y}>
              <line
                x1="60"
                x2="710"
                y1={y}
                y2={y}
                className="chart-grid-line"
              />
              {index % 2 === 0 ? (
                <text
                  x="54"
                  y={y + 4}
                  textAnchor="end"
                  className="chart-axis-label"
                >
                  {compact(chart.high - ((chart.high - chart.low) * index) / 4)}
                </text>
              ) : null}
            </g>
          ))}
          {path ? (
            <path
              d={`${path} L710,238 L60,238 Z`}
              fill={`url(#${gradientId})`}
            />
          ) : null}
          {path ? <path d={path} className="chart-line" /> : null}
          {chart.points.map((point, index) => (
            <g key={`${point.blockNumber}-${point.logIndex}-${index}`}>
              {point.eventType === "graduation" ? (
                <line
                  x1={point.x}
                  x2={point.x}
                  y1="44"
                  y2="246"
                  className="graduation-marker"
                />
              ) : null}
              <circle
                cx={point.x}
                cy={point.y}
                r={
                  activeIndex === index
                    ? 7
                    : point.eventType === "trade"
                      ? 5
                      : 4
                }
                tabIndex={0}
                role="button"
                aria-label={`${point.eventType}${point.side ? ` ${point.side}` : ""}, ${compact(point.value)} ${analytics.baseSymbol}, ${timeLabel(point.timestamp, point.blockNumber)}`}
                className={`chart-point ${point.eventType} ${point.side ?? ""}`}
                onPointerEnter={() => setActiveIndex(index)}
                onPointerLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") moveTooltip(index, -1);
                  if (event.key === "ArrowRight") moveTooltip(index, 1);
                }}
              />
            </g>
          ))}
        </svg>
        {active ? (
          <output className="chart-tooltip" aria-live="polite">
            <strong>
              {active.eventType === "trade"
                ? `${active.side} trade`
                : active.eventType}
            </strong>
            <span>
              {compact(active.value)} {analytics.baseSymbol}
            </span>
            {active.eventType === "trade" ? (
              <span>
                {compact(units(active.baseAmount))} {analytics.baseSymbol}{" "}
                traded
              </span>
            ) : null}
            <small>{timeLabel(active.timestamp, active.blockNumber)}</small>
            {active.transactionHash ? (
              <code>{active.transactionHash.slice(0, 10)}...</code>
            ) : null}
          </output>
        ) : null}
      </div>
      <div className="chart-foot">
        <span>
          {timeLabel(
            chart.points[0]?.timestamp ?? null,
            chart.points[0]?.blockNumber ?? "0",
          )}
        </span>
        <span>{analytics.tradeCount} canonical trades</span>
        <span>
          {timeLabel(
            chart.points.at(-1)?.timestamp ?? null,
            chart.points.at(-1)?.blockNumber ?? "0",
          )}
        </span>
      </div>
      {insufficient ? (
        <p className="chart-disclosure">
          Insufficient timestamped history for this window.
        </p>
      ) : null}
    </section>
  );
}

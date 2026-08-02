"use client";

import { useId, useMemo, useState } from "react";
import type { LaunchAnalytics } from "@/lib/data-api";
import { baseUnits, usdAmount } from "@/lib/display-format";

type Range = "1h" | "24h" | "7d" | "all";
type Currency = "usd" | "eth";

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

function changeLabel(value: number | null) {
  if (value === null) return "N/A";
  return `${value > 0 ? "+" : ""}${(value / 100).toFixed(2)}%`;
}

function changeTone(value: number | null) {
  if (value === null || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

export function TokenMarketChart({
  analytics,
  symbol,
  ethUsdPrice,
}: {
  analytics: LaunchAnalytics["data"];
  symbol: string;
  ethUsdPrice: number | null;
}) {
  const gradientId = useId();
  const [mode, setMode] = useState<"price" | "volume">("price");
  const [range, setRange] = useState<Range>("24h");
  const [currency, setCurrency] = useState<Currency>("usd");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const canUseUsd = analytics.baseSymbol === "ETH" && ethUsdPrice !== null;
  const activeCurrency: Currency =
    currency === "usd" && canUseUsd ? "usd" : "eth";
  const currencyMultiplier = activeCurrency === "usd" ? (ethUsdPrice ?? 1) : 1;

  function displayValue(value: number, maximumFractionDigits = 8) {
    return activeCurrency === "usd"
      ? usdAmount(value, maximumFractionDigits, value >= 10_000)
      : `${compact(value)} ${analytics.baseSymbol}`;
  }

  function axisValue(value: number) {
    return activeCurrency === "usd"
      ? usdAmount(value, value < 1 ? 6 : 2)
      : compact(value);
  }

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
      if (point.eventType === "trade")
        windowVolume += baseUnits(point.baseAmount);
      return {
        ...point,
        value:
          (mode === "price" ? baseUnits(point.price) : windowVolume) *
          currencyMultiplier,
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
  }, [analytics.chart, currencyMultiplier, mode, range]);

  const path = chart.points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const active =
    activeIndex === null ? null : (chart.points[activeIndex] ?? null);
  const current = chart.points.at(-1)?.value ?? 0;
  const marketCap = baseUnits(analytics.marketCapBase) * currencyMultiplier;
  const allTimeHighMarketCap =
    baseUnits(analytics.allTimeHighMarketCapBase) * currencyMultiplier;
  const currentPrice =
    baseUnits(analytics.priceBasePerToken) * currencyMultiplier;
  const volume24h = baseUnits(analytics.volume24hBase) * currencyMultiplier;
  const athProgress =
    allTimeHighMarketCap <= 0
      ? 0
      : Math.min(100, Math.max(0, (marketCap / allTimeHighMarketCap) * 100));
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
        <div className="market-cap-heading">
          <p className="card-label">Canonical market activity</p>
          <span className="market-cap-kicker">Market cap</span>
          <div className="market-cap-value-row">
            <h2 id="market-chart-heading">
              {displayValue(marketCap, marketCap < 1 ? 6 : 2)}
            </h2>
            <span
              className={`market-change ${changeTone(analytics.change24hBps)}`}
            >
              {changeLabel(analytics.change24hBps)} 24h
            </span>
          </div>
          <div className="market-ath-row">
            <span>
              ATH{" "}
              <strong>
                {displayValue(
                  allTimeHighMarketCap,
                  allTimeHighMarketCap < 1 ? 6 : 2,
                )}
              </strong>
            </span>
            <span>{athProgress.toFixed(1)}% of ATH</span>
          </div>
          <div
            className="market-ath-progress"
            role="progressbar"
            aria-label={`${symbol} market cap progress toward all-time high`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Number(athProgress.toFixed(1))}
          >
            <span style={{ width: `${athProgress}%` }} />
          </div>
        </div>
        <div className="chart-controls">
          <div
            className="chart-tabs chart-currency-tabs"
            role="tablist"
            aria-label="Chart currency"
          >
            {(["usd", "eth"] as const).map((unit) => (
              <button
                key={unit}
                type="button"
                role="tab"
                disabled={unit === "usd" && !canUseUsd}
                aria-selected={activeCurrency === unit}
                className={activeCurrency === unit ? "active" : ""}
                onClick={() => {
                  setCurrency(unit);
                  setActiveIndex(null);
                }}
              >
                {unit.toUpperCase()}
              </button>
            ))}
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
      </div>
      <div className="chart-mode-context" aria-live="polite">
        <span>{mode === "price" ? `${symbol} price` : "Window volume"}</span>
        <strong>{displayValue(current)}</strong>
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
                  {axisValue(
                    chart.high - ((chart.high - chart.low) * index) / 4,
                  )}
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
                aria-label={`${point.eventType}${point.side ? ` ${point.side}` : ""}, ${displayValue(point.value)}, ${timeLabel(point.timestamp, point.blockNumber)}`}
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
            <span>{displayValue(active.value)}</span>
            {active.eventType === "trade" ? (
              <span>
                {displayValue(
                  baseUnits(active.baseAmount) * currencyMultiplier,
                )}{" "}
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
      <dl className="chart-window-stats" aria-label="Market window statistics">
        <div>
          <dt>Price</dt>
          <dd>{displayValue(currentPrice)}</dd>
        </div>
        <div>
          <dt>24h volume</dt>
          <dd>{displayValue(volume24h, volume24h < 1 ? 6 : 2)}</dd>
        </div>
        {[
          ["5m", analytics.change5mBps],
          ["1h", analytics.change1hBps],
          ["6h", analytics.change6hBps],
        ].map(([label, value]) => (
          <div key={label as string}>
            <dt>{label}</dt>
            <dd className={changeTone(value as number | null)}>
              {changeLabel(value as number | null)}
            </dd>
          </div>
        ))}
      </dl>
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

"use client";

import { useEffect, useState } from "react";
import { formatEther } from "viem";

type Holder = {
  address: string;
  balance: string;
  shareBps: string;
  label: string;
};

type Trade = {
  transactionHash: string;
  blockNumber: string;
  side: "buy" | "sell";
  trader: string;
  baseAmount: string;
  tokenAmount: string;
};

function short(address: string) {
  return `${address.slice(0, 7)}…${address.slice(-5)}`;
}

function quantity(value: string, maximumFractionDigits = 2) {
  const amount = Number(formatEther(BigInt(value)));
  return amount.toLocaleString(undefined, {
    notation: amount >= 100_000 ? "compact" : "standard",
    maximumFractionDigits,
  });
}

export function TokenMarketDataTabs({
  holders,
  holderCount,
  trades,
  symbol,
  quoteSymbol,
}: {
  holders: Holder[];
  holderCount: number;
  trades: Trade[];
  symbol: string;
  quoteSymbol: string;
}) {
  const [active, setActive] = useState<"holders" | "trades">("holders");

  useEffect(() => {
    const syncHash = () => {
      if (window.location.hash === "#recent-trades") setActive("trades");
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  return (
    <section className="market-table-card token-data-tabs" id="recent-trades">
      <div className="token-data-tab-heading">
        <div>
          <p className="card-label">Canonical market data</p>
          <h2>{active === "holders" ? "Ownership" : "Market tape"}</h2>
        </div>
        <div
          className="token-data-tablist"
          role="tablist"
          aria-label="Token market data"
        >
          <button
            type="button"
            role="tab"
            aria-selected={active === "holders"}
            aria-controls="token-holders-panel"
            onClick={() => setActive("holders")}
          >
            Ownership
            <span>{holderCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={active === "trades"}
            aria-controls="token-trades-panel"
            onClick={() => setActive("trades")}
          >
            Market tape
            <span>{trades.length}</span>
          </button>
        </div>
      </div>

      {active === "holders" ? (
        <div
          id="token-holders-panel"
          role="tabpanel"
          className="token-table-wrap"
        >
          <table className="token-data-table">
            <thead>
              <tr>
                <th>Holder</th>
                <th>Balance</th>
                <th>Supply</th>
              </tr>
            </thead>
            <tbody>
              {holders.map((holder, index) => (
                <tr key={holder.address}>
                  <td>
                    <span className="holder-rank">{index + 1}</span>
                    <code>{short(holder.address)}</code>
                    <small>{holder.label}</small>
                  </td>
                  <td>
                    {quantity(holder.balance)} {symbol}
                  </td>
                  <td>{(Number(holder.shareBps) / 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : trades.length === 0 ? (
        <p id="token-trades-panel" role="tabpanel" className="empty-state">
          No indexed trades yet. Be the first participant.
        </p>
      ) : (
        <div
          id="token-trades-panel"
          role="tabpanel"
          className="token-table-wrap"
        >
          <table className="token-data-table trade-table">
            <thead>
              <tr>
                <th>Side</th>
                <th>Trader</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(0, 10).map((trade) => (
                <tr key={`${trade.transactionHash}-${trade.blockNumber}`}>
                  <td>
                    <span className={`trade-side ${trade.side}`}>
                      {trade.side}
                    </span>
                  </td>
                  <td>
                    <code>{short(trade.trader)}</code>
                    <small>Block {trade.blockNumber}</small>
                  </td>
                  <td>
                    {quantity(trade.baseAmount, 4)} {quoteSymbol}
                    <small>
                      {quantity(trade.tokenAmount)} {symbol}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

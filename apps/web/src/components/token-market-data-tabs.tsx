"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatEther } from "viem";
import { pageWindow } from "@/lib/token-market-pagination";

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
  rewardEconomy,
  rewardAssetCount,
}: {
  holders: Holder[];
  holderCount: number;
  trades: Trade[];
  symbol: string;
  quoteSymbol: string;
  rewardEconomy: ReactNode;
  rewardAssetCount: number;
}) {
  const [active, setActive] = useState<"holders" | "trades" | "rewards">(
    "holders",
  );
  const [holderPage, setHolderPage] = useState(1);
  const [tradePage, setTradePage] = useState(1);
  const holderWindow = pageWindow(holders, holderPage);
  const tradeWindow = pageWindow(trades, tradePage);

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
          <h2>
            {active === "holders"
              ? "Ownership"
              : active === "trades"
                ? "Trades"
                : "Reward economy"}
          </h2>
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
            Trades
            <span>{trades.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={active === "rewards"}
            aria-controls="token-rewards-panel"
            onClick={() => setActive("rewards")}
          >
            Reward economy
            <span>{rewardAssetCount}</span>
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
              {holderWindow.items.map((holder, index) => (
                <tr key={holder.address}>
                  <td>
                    <span className="holder-rank">
                      {holderWindow.startIndex + index + 1}
                    </span>
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
          <DataPagination
            label="Ownership"
            page={holderWindow.page}
            totalPages={holderWindow.totalPages}
            start={holderWindow.startIndex + 1}
            end={holderWindow.endIndex}
            total={holders.length}
            onPrevious={() => setHolderPage((page) => Math.max(1, page - 1))}
            onNext={() =>
              setHolderPage((page) =>
                Math.min(holderWindow.totalPages, page + 1),
              )
            }
          />
        </div>
      ) : active === "rewards" ? (
        <div
          id="token-rewards-panel"
          role="tabpanel"
          className="reward-economy-panel"
        >
          {rewardEconomy}
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
              {tradeWindow.items.map((trade) => (
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
          <DataPagination
            label="Trades"
            page={tradeWindow.page}
            totalPages={tradeWindow.totalPages}
            start={tradeWindow.startIndex + 1}
            end={tradeWindow.endIndex}
            total={trades.length}
            onPrevious={() => setTradePage((page) => Math.max(1, page - 1))}
            onNext={() =>
              setTradePage((page) => Math.min(tradeWindow.totalPages, page + 1))
            }
          />
        </div>
      )}
    </section>
  );
}

function DataPagination({
  label,
  page,
  totalPages,
  start,
  end,
  total,
  onPrevious,
  onNext,
}: {
  label: string;
  page: number;
  totalPages: number;
  start: number;
  end: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav className="token-data-pagination" aria-label={`${label} pagination`}>
      <span aria-live="polite">
        {total === 0 ? "No entries" : `${start}–${end} of ${total}`}
      </span>
      <div>
        <button type="button" onClick={onPrevious} disabled={page <= 1}>
          Previous
        </button>
        <small>
          Page {page} of {totalPages}
        </small>
        <button type="button" onClick={onNext} disabled={page >= totalPages}>
          Next
        </button>
      </div>
    </nav>
  );
}

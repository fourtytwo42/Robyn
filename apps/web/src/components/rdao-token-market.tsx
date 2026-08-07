"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  encodeFunctionData,
  formatEther,
  parseAbi,
  parseEther,
  type Abi,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import type { Deployment } from "@/lib/deployment";
import { TokenMarketDataTabs } from "@/components/token-market-data-tabs";

const saleAbi = parseAbi([
  "function quoteBuy(uint256) view returns (uint256 tokensOut,uint256 principal,uint256 fee,uint256 refund)",
  "function quoteSell(uint256) view returns (uint256 principalOut,uint256 fee,uint256 nativeOut)",
  "function buy(uint256 minimumTokensOut,uint256 deadline,address recipient) payable returns (uint256)",
  "function sell(uint256 tokensIn,uint256 minimumNativeOut,uint256 deadline,address recipient) returns (uint256)",
]);
const tokenAbi = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

type RdaoMarketState = {
  contracts: {
    token: Address;
    sale: Address;
  };
  policy: Deployment["rdao"] | null;
  totalSupply: string;
  sale: {
    saleInventory: string;
    liquidityInventory: string;
    sold: string;
    curvePrincipal: string;
    curvePrincipalTarget: string;
    deployerPayout: string;
    liquidityNative: string;
    totalBondingFees: string;
    pendingStakingFees: string;
    buysPaused: boolean;
    finalized: boolean;
    graduationReady: boolean;
    currentPriceE18: string;
    terminalPriceE18: string;
  };
  market?: {
    holderCount: number;
    tradeCount: number;
    uniqueTraderCount: number;
    totalVolumeBase: string;
    topHolders: Array<{
      address: string;
      balance: string;
      shareBps: string;
      label: string;
    }>;
    recentTrades: Array<{
      transactionHash: string;
      blockNumber: string;
      side: "buy" | "sell";
      trader: string;
      baseAmount: string;
      tokenAmount: string;
    }>;
  };
  account: null | {
    liquidBalance: string;
  };
};

function tokens(value: string, digits = 2) {
  return Number(formatEther(BigInt(value))).toLocaleString("en-US", {
    notation:
      Number(formatEther(BigInt(value))) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: digits,
  });
}

function eth(value: string, digits = 6) {
  return Number(formatEther(BigInt(value))).toLocaleString("en-US", {
    maximumFractionDigits: digits,
  });
}

function percent(numerator: string, denominator: string) {
  if (BigInt(denominator) === 0n) return 0;
  return (
    Number((BigInt(numerator) * 1_000_000n) / BigInt(denominator)) / 10_000
  );
}

function compact(value: number, digits = 2) {
  return value.toLocaleString("en-US", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: digits,
  });
}

function BondingCurveChart({ state }: { state: RdaoMarketState }) {
  const gradientId = useId();
  const saleSupply = Number(formatEther(BigInt(state.sale.saleInventory)));
  const sold = Number(formatEther(BigInt(state.sale.sold)));
  const principal = Number(formatEther(BigInt(state.sale.curvePrincipal)));
  const principalTarget = Number(
    formatEther(BigInt(state.sale.curvePrincipalTarget)),
  );
  const currentPrice = Number(formatEther(BigInt(state.sale.currentPriceE18)));
  const terminalPrice = Number(
    formatEther(BigInt(state.sale.terminalPriceE18)),
  );
  const totalSupply = Number(formatEther(BigInt(state.totalSupply)));
  const market = state.market;
  const ethUsd = Number(state.policy?.pricing.ethUsdFixture ?? 0);
  const impliedValueEth = currentPrice * totalSupply;
  const progress = percent(state.sale.sold, state.sale.saleInventory);

  const curve = useMemo(() => {
    const denominator = currentPrice - terminalPrice;
    const solvedVirtualToken =
      Math.abs(denominator) < Number.EPSILON
        ? saleSupply * 4
        : (currentPrice * sold -
            terminalPrice * saleSupply +
            principal -
            principalTarget) /
          denominator;
    const virtualToken = Math.max(solvedVirtualToken, saleSupply + 1);
    const virtualNative = Math.max(
      currentPrice * (virtualToken - sold) - principal,
      Number.EPSILON,
    );
    const invariant = virtualNative * virtualToken;
    const samples = Array.from({ length: 81 }, (_, index) => {
      const xSold = (saleSupply * index) / 80;
      const remaining = Math.max(virtualToken - xSold, 1);
      return {
        sold: xSold,
        price: invariant / (remaining * remaining),
      };
    });
    const prices = samples.map((point) => point.price);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const spread = Math.max(high - low, Number.EPSILON);
    const points = samples.map((point) => ({
      ...point,
      x: 58 + (point.sold / saleSupply) * 652,
      y: 240 - ((point.price - low) / spread) * 184,
    }));
    const currentX = 58 + Math.min(1, sold / saleSupply) * 652;
    const currentY = 240 - ((currentPrice - low) / spread) * 184;
    return { points, low, high, currentX, currentY };
  }, [
    currentPrice,
    principal,
    principalTarget,
    saleSupply,
    sold,
    terminalPrice,
  ]);

  const path = curve.points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");

  return (
    <section
      className="market-chart-card rdao-curve-card"
      aria-labelledby="rdao-chart-heading"
    >
      <div className="chart-heading-row">
        <div className="market-cap-heading">
          <p className="card-label">Public bonding market</p>
          <span className="market-cap-kicker">Fully diluted value</span>
          <div className="market-cap-value-row">
            <h2 id="rdao-chart-heading">
              {ethUsd > 0
                ? `$${compact(impliedValueEth * ethUsd)}`
                : `${compact(impliedValueEth, 3)} ETH`}
            </h2>
            <span className="market-change positive">Live curve</span>
          </div>
          <div className="market-ath-row">
            <span>
              Graduation price <strong>{compact(terminalPrice, 9)} ETH</strong>
            </span>
            <span>{progress.toFixed(2)}% sold</span>
          </div>
          <div
            className="market-ath-progress"
            role="progressbar"
            aria-label="RDAO public sale progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Number(progress.toFixed(2))}
          >
            <span style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        </div>
        <div className="rdao-curve-legend" aria-label="Bonding curve legend">
          <span>
            <i className="current" /> Current
          </span>
          <span>
            <i className="graduation" /> Graduation
          </span>
        </div>
      </div>

      <div className="chart-mode-context">
        <span>RDAO price</span>
        <strong>{compact(currentPrice, 9)} ETH</strong>
      </div>
      <div className="market-chart-frame rdao-curve-frame">
        <svg
          viewBox="0 0 768 286"
          role="img"
          aria-label="RDAO constant-product bonding price curve"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#96f2b4" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#96f2b4" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2].map((line) => {
            const y = 56 + line * 92;
            const value = curve.high - ((curve.high - curve.low) * line) / 2;
            return (
              <g key={line}>
                <line
                  x1="58"
                  x2="710"
                  y1={y}
                  y2={y}
                  className="chart-grid-line"
                />
                <text x="8" y={y + 4} className="chart-axis-label">
                  {compact(value, 8)}
                </text>
              </g>
            );
          })}
          <path d={`${path} L710,240 L58,240 Z`} fill={`url(#${gradientId})`} />
          <path d={path} className="chart-line" />
          <line
            x1={curve.currentX}
            x2={curve.currentX}
            y1="50"
            y2="240"
            className="rdao-current-marker"
          />
          <circle
            cx={curve.currentX}
            cy={curve.currentY}
            r="7"
            className="rdao-current-point"
          />
          <line
            x1="710"
            x2="710"
            y1="44"
            y2="240"
            className="graduation-marker"
          />
          <text x="58" y="270" className="chart-axis-label">
            0 sold
          </text>
          <text x="710" y="270" textAnchor="end" className="chart-axis-label">
            150m sold
          </text>
        </svg>
      </div>
      <dl
        className="market-window-stats rdao-market-stats"
        aria-label="RDAO sale statistics"
      >
        <div>
          <dt>Current price</dt>
          <dd>{compact(currentPrice, 9)} ETH</dd>
        </div>
        <div>
          <dt>Publicly sold</dt>
          <dd>{tokens(state.sale.sold)} RDAO</dd>
        </div>
        <div>
          <dt>All-time volume</dt>
          <dd>{eth(market?.totalVolumeBase ?? "0", 4)} ETH</dd>
        </div>
        <div>
          <dt>Trades</dt>
          <dd>{market?.tradeCount ?? 0}</dd>
        </div>
        <div>
          <dt>Holders</dt>
          <dd>{market?.holderCount ?? 0}</dd>
        </div>
      </dl>
      <p className="rdao-chart-note">
        This chart shows the contract&apos;s deterministic bonding curve, not a
        prediction. Price rises as public inventory is purchased and may move
        down when holders sell during bonding.
      </p>
    </section>
  );
}

export function RdaoTokenMarket({
  account,
  rpcClient,
  walletClient,
  connect,
  dataApiUrl,
}: {
  account?: Address;
  rpcClient: PublicClient;
  walletClient?: WalletClient;
  connect: () => Promise<void>;
  dataApiUrl: string;
}) {
  const [state, setState] = useState<RdaoMarketState>();
  const [status, setStatus] = useState("Loading live RDAO market…");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [buyEth, setBuyEth] = useState("0.1");
  const [sellRdao, setSellRdao] = useState("1000");

  const refresh = useCallback(async () => {
    const suffix = account ? `?account=${account}` : "";
    const response = await fetch(`${dataApiUrl}/rdao${suffix}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("RDAO market is temporarily unavailable");
    setState(((await response.json()) as { data: RdaoMarketState }).data);
    setStatus("Live contract state reconciled.");
  }, [account, dataApiUrl]);

  useEffect(() => {
    void refresh().catch((error: unknown) =>
      setStatus(error instanceof Error ? error.message : "RDAO unavailable"),
    );
  }, [refresh]);

  const transact = useCallback(
    async (
      to: Address,
      abi: Abi,
      functionName: string,
      args: readonly unknown[] = [],
      value?: bigint,
    ) => {
      if (!account || !walletClient) return void (await connect());
      try {
        const data = encodeFunctionData({ abi, functionName, args });
        setStatus("Simulating transaction…");
        await rpcClient.call({ account, to, data, value });
        setStatus("Waiting for wallet confirmation…");
        const hash = await walletClient.sendTransaction({
          account: walletClient.account ?? account,
          chain: walletClient.chain,
          to,
          data,
          value,
        });
        setStatus("Submitted. Waiting for confirmation…");
        await rpcClient.waitForTransactionReceipt({ hash });
        await refresh();
        setStatus("Confirmed and reconciled.");
      } catch (error) {
        const detail =
          error && typeof error === "object" && "shortMessage" in error
            ? String(error.shortMessage)
            : error instanceof Error
              ? error.message.split("\n")[0]
              : "Unknown transaction error";
        setStatus(`Transaction failed: ${detail}`);
      }
    },
    [account, connect, refresh, rpcClient, walletClient],
  );

  const buy = useCallback(async () => {
    if (!state || !account) return void (await connect());
    try {
      const value = parseEther(buyEth);
      const quote = await rpcClient.readContract({
        address: state.contracts.sale,
        abi: saleAbi,
        functionName: "quoteBuy",
        args: [value],
      });
      await transact(
        state.contracts.sale,
        saleAbi,
        "buy",
        [
          (quote[0] * 99n) / 100n,
          BigInt(Math.floor(Date.now() / 1000) + 120),
          account,
        ],
        value,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Quote failed: ${error.message.split("\n")[0]}`
          : "Quote failed",
      );
    }
  }, [account, buyEth, connect, rpcClient, state, transact]);

  const sell = useCallback(async () => {
    if (!state || !account || !walletClient) return void (await connect());
    try {
      const amount = parseEther(sellRdao);
      const allowance = await rpcClient.readContract({
        address: state.contracts.token,
        abi: tokenAbi,
        functionName: "allowance",
        args: [account, state.contracts.sale],
      });
      if (allowance < amount) {
        await transact(state.contracts.token, tokenAbi, "approve", [
          state.contracts.sale,
          amount,
        ]);
        setStatus("Approval confirmed. Review and submit the sale again.");
        return;
      }
      const quote = await rpcClient.readContract({
        address: state.contracts.sale,
        abi: saleAbi,
        functionName: "quoteSell",
        args: [amount],
      });
      await transact(state.contracts.sale, saleAbi, "sell", [
        amount,
        (quote[2] * 99n) / 100n,
        BigInt(Math.floor(Date.now() / 1000) + 120),
        account,
      ]);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Quote failed: ${error.message.split("\n")[0]}`
          : "Quote failed",
      );
    }
  }, [account, connect, rpcClient, sellRdao, state, transact, walletClient]);

  if (!state)
    return (
      <section className="dao-loading panel">
        <p>{status}</p>
      </section>
    );

  const progress = percent(state.sale.sold, state.sale.saleInventory);
  const price = eth(state.sale.currentPriceE18, 9);
  const finalized = state.sale.finalized;
  const saleStatus = finalized
    ? "Graduated"
    : state.sale.buysPaused
      ? "Paused"
      : "Bonding live";

  return (
    <div className="token-market-layout rdao-market-layout">
      <div className="token-market-primary">
        <BondingCurveChart state={state} />
        <TokenMarketDataTabs
          holders={state.market?.topHolders ?? []}
          holderCount={state.market?.holderCount ?? 0}
          trades={state.market?.recentTrades ?? []}
          symbol="RDAO"
          quoteSymbol="ETH"
        />
        <section
          className="token-data-panel rdao-market-details"
          aria-labelledby="rdao-details-heading"
        >
          <header className="rdao-details-heading">
            <div>
              <p className="card-label">Sale mechanics</p>
              <h2 id="rdao-details-heading">What happens at graduation</h2>
            </div>
            <span className="live-chip">{saleStatus}</span>
          </header>
          <div className="rdao-detail-grid">
            <article>
              <span>Public sale</span>
              <strong>150m RDAO</strong>
              <p>Open to every wallet with no wallet or transaction cap.</p>
            </article>
            <article>
              <span>Permanent liquidity</span>
              <strong>50m RDAO</strong>
              <p>
                Paired with {eth(state.sale.liquidityNative, 3)} ETH in a locked
                1% v4 position.
              </p>
            </article>
            <article>
              <span>Bonding fee</span>
              <strong>1%</strong>
              <p>
                Assigned to eligible RDAO stakers through pull-based WETH
                rewards.
              </p>
            </article>
            <article>
              <span>Graduation</span>
              <strong>{progress.toFixed(2)}%</strong>
              <p>
                Finalization is atomic and preserves the terminal curve price.
              </p>
            </article>
          </div>
        </section>
      </div>

      <aside className="token-trade-column">
        <section
          className="trade-card rdao-trade-card"
          aria-labelledby="rdao-trade-heading"
        >
          <div
            className="trade-side-tabs"
            role="tablist"
            aria-label="RDAO trade side"
          >
            {(["buy", "sell"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={side === item}
                className={side === item ? "active" : ""}
                onClick={() => setSide(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="rdao-trade-heading-row">
            <div>
              <p className="eyebrow">Public bonding sale</p>
              <h2 id="rdao-trade-heading">Trade RDAO</h2>
            </div>
            <span className="status-chip success">{saleStatus}</span>
          </div>
          {side === "buy" ? (
            <>
              <label className="field">
                <span>You pay in ETH</span>
                <input
                  value={buyEth}
                  onChange={(event) => setBuyEth(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <div className="rdao-quick-amounts">
                {["0.01", "0.1", "1"].map((value) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setBuyEth(value)}
                  >
                    {value} ETH
                  </button>
                ))}
              </div>
              <div className="rdao-quote-summary">
                <span>Current curve price</span>
                <strong>{price} ETH / RDAO</strong>
              </div>
              <button
                className="button primary rdao-submit"
                disabled={state.sale.buysPaused || finalized}
                onClick={() => void buy()}
              >
                {finalized
                  ? "Bonding complete"
                  : account
                    ? "Buy RDAO"
                    : "Connect wallet to buy"}
              </button>
            </>
          ) : (
            <>
              <label className="field">
                <span>You sell in RDAO</span>
                <input
                  value={sellRdao}
                  onChange={(event) => setSellRdao(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <div className="rdao-quote-summary">
                <span>Wallet balance</span>
                <strong>
                  {tokens(state.account?.liquidBalance ?? "0", 4)} RDAO
                </strong>
              </div>
              <button
                className="button primary rdao-submit"
                disabled={finalized}
                onClick={() => void sell()}
              >
                {finalized
                  ? "Bonding complete"
                  : account
                    ? "Sell RDAO"
                    : "Connect wallet to sell"}
              </button>
            </>
          )}
          <p className="trade-helper">
            {finalized
              ? "Bonding is complete · permanent v4 liquidity is live"
              : "1% bonding fee · 1% quote protection · two-minute deadline"}
          </p>
          <p className="trade-status" role="status">
            {status}
          </p>
        </section>

        <section
          className="panel rdao-lifecycle-card"
          aria-labelledby="rdao-lifecycle-heading"
        >
          <p className="card-label">RDAO lifecycle</p>
          <h3 id="rdao-lifecycle-heading">From curve to locked liquidity</h3>
          <ol>
            <li className="active">
              <span>1</span>
              <div>
                <strong>Public bonding</strong>
                <small>{tokens(state.sale.sold)} of 150m RDAO sold</small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Atomic graduation</strong>
                <small>Frozen owner payout and terminal price continuity</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Permanent v4 market</strong>
                <small>50m RDAO liquidity principal cannot be removed</small>
              </div>
            </li>
          </ol>
        </section>

        <section className="panel rdao-utility-card">
          <p className="card-label">Already hold RDAO?</p>
          <h3>Stake, claim, and govern in the DAO workspace.</h3>
          <p>
            The market page stays focused on trading. Member tools live together
            on the DAO page.
          </p>
          <Link className="button" href="/dao">
            Open DAO workspace
          </Link>
        </section>
      </aside>
    </div>
  );
}

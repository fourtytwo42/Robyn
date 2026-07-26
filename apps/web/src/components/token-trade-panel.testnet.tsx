"use client";

import { formatEther, parseEther, type Address } from "viem";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Deployment } from "@/lib/deployment";
import { ResponsiveTradePanel } from "@/components/responsive-trade-panel";
import { useRobynTestnetWallet } from "./robyn-testnet-wallet";
import { normalizeWalletError } from "@/lib/wallet-policy";

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;
const legacyMarketAbi = [
  {
    type: "function",
    name: "buy",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
const nativeMarketAbi = [
  {
    type: "function",
    name: "quoteBuy",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }],
    outputs: [
      { type: "uint256", name: "feeAmount" },
      { type: "uint256", name: "tokenOutput" },
    ],
  },
  {
    type: "function",
    name: "quoteSell",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }],
    outputs: [
      { type: "uint256", name: "feeAmount" },
      { type: "uint256", name: "nativeOutput" },
    ],
  },
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

function compact(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

type AuthoritativeQuote =
  | { state: "idle" | "loading" | "unavailable"; amount: null }
  | { state: "ready"; amount: bigint };

export function NetworkTokenTradePanel({
  deployment,
  token,
  market,
  symbol,
  feeBps,
  basePerToken,
  marketPhase,
}: {
  deployment: Deployment;
  token: Address;
  market: Address;
  symbol: string;
  feeBps: number;
  basePerToken: string;
  marketPhase: "legacy_fixed" | "bonding" | "graduated";
}) {
  const router = useRouter();
  const isNativeV4 = deployment.liquidityVenue === "uniswap-v4";
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [input, setInput] = useState(isNativeV4 ? "0.001" : "100");
  const {
    account,
    publicClient,
    walletClient,
    connect,
    isWrongChain,
    switchToRobinhoodTestnet,
  } = useRobynTestnetWallet();
  const [baseBalance, setBaseBalance] = useState(0n);
  const [tokenBalance, setTokenBalance] = useState(0n);
  const [busy, setBusy] = useState(false);
  const [authoritativeQuote, setAuthoritativeQuote] =
    useState<AuthoritativeQuote>({
      state: isNativeV4 ? "loading" : "idle",
      amount: null,
    });
  const [status, setStatus] = useState(
    "Connect an injected testnet wallet to trade.",
  );
  const parsed = Number(input);
  const price = Number(formatEther(BigInt(basePerToken)));
  const afterFee = 1 - feeBps / 10_000;
  const indicativeOutput =
    Number.isFinite(parsed) && parsed > 0
      ? side === "buy"
        ? (parsed * afterFee) / price
        : parsed * price * afterFee
      : 0;

  useEffect(() => {
    if (!isNativeV4) return;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setAuthoritativeQuote({ state: "idle", amount: null });
      return;
    }

    let cancelled = false;
    setAuthoritativeQuote({ state: "loading", amount: null });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const amount = parseEther(input);
          const simulation =
            side === "buy"
              ? await publicClient.simulateContract({
                  address: market,
                  abi: nativeMarketAbi,
                  functionName: "quoteBuy",
                  args: [amount],
                })
              : await publicClient.simulateContract({
                  address: market,
                  abi: nativeMarketAbi,
                  functionName: "quoteSell",
                  args: [amount],
                });
          if (!cancelled) {
            setAuthoritativeQuote({
              state: "ready",
              amount: simulation.result[1],
            });
          }
        } catch {
          if (!cancelled) {
            setAuthoritativeQuote({ state: "unavailable", amount: null });
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [input, isNativeV4, market, parsed, publicClient, side]);

  async function refresh(address: Address) {
    if (!publicClient) return;
    const [base, held] = await Promise.all([
      isNativeV4
        ? publicClient.getBalance({ address })
        : publicClient.readContract({
            address: deployment.contracts.baseAsset,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          }),
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);
    setBaseBalance(base);
    setTokenBalance(held);
  }

  useEffect(() => {
    if (!account || isWrongChain) {
      setBaseBalance(0n);
      setTokenBalance(0n);
      return;
    }
    void refresh(account).then(() =>
      setStatus("Wallet connected. Enter an amount to trade."),
    );
    // publicClient is stable for the configured chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, isWrongChain, token]);

  async function requestWallet() {
    try {
      if (!account) return await connect();
      if (isWrongChain) return await switchToRobinhoodTestnet();
    } catch (error) {
      setStatus(normalizeWalletError(error));
    }
  }

  async function submit() {
    if (!account || isWrongChain || !walletClient || !publicClient) {
      return requestWallet();
    }
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setStatus("Enter an amount greater than zero.");
      return;
    }
    setBusy(true);
    try {
      const amount = parseEther(input);
      if (!isNativeV4 || side === "sell") {
        const asset = side === "buy" ? deployment.contracts.baseAsset : token;
        setStatus(`Approving ${side === "buy" ? "mUSD" : symbol}…`);
        const approval = await walletClient.writeContract({
          address: asset,
          abi: erc20Abi,
          functionName: "approve",
          args: [market, amount],
        });
        const approvalReceipt = await publicClient.waitForTransactionReceipt({
          hash: approval,
        });
        if (approvalReceipt.status !== "success") {
          throw new Error("Token approval reverted.");
        }
      }
      setStatus(`${side === "buy" ? "Buying" : "Selling"} ${symbol}…`);
      let hash;
      if (isNativeV4 && side === "buy") {
        const simulation = await publicClient.simulateContract({
          account,
          address: market,
          abi: nativeMarketAbi,
          functionName: "buy",
          args: [1n],
          value: amount,
        });
        hash = await walletClient.writeContract(simulation.request);
      } else if (isNativeV4) {
        const simulation = await publicClient.simulateContract({
          account,
          address: market,
          abi: nativeMarketAbi,
          functionName: "sell",
          args: [amount, 1n],
        });
        hash = await walletClient.writeContract(simulation.request);
      } else {
        const simulation = await publicClient.simulateContract({
          account,
          address: market,
          abi: legacyMarketAbi,
          functionName: side,
          args: [amount, 1n],
        });
        hash = await walletClient.writeContract(simulation.request);
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("Transaction reverted.");
      await refresh(account);
      setStatus(`${side === "buy" ? "Buy" : "Sell"} confirmed.`);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Trade failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveTradePanel
      symbol={symbol}
      side={side}
      onSideChange={(value) => {
        setSide(value);
        setInput(
          value === "buy" && isNativeV4
            ? "0.001"
            : value === "buy"
              ? "100"
              : "10000",
        );
      }}
      dirty={
        input !==
        (side === "buy" && isNativeV4
          ? "0.001"
          : side === "buy"
            ? "100"
            : "10000")
      }
    >
      <div className="trade-tabs" role="tablist" aria-label="Trade side">
        {(["buy", "sell"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={side === value}
            className={side === value ? "active" : ""}
            onClick={() => {
              setSide(value);
              setInput(
                value === "buy" && isNativeV4
                  ? "0.001"
                  : value === "buy"
                    ? "100"
                    : "10000",
              );
            }}
          >
            {value}
          </button>
        ))}
      </div>
      <h2 id="trade-panel-heading" className="sr-only">
        Trade {symbol}
      </h2>
      <label className="trade-amount">
        <span>
          You {side === "buy" ? "pay" : "sell"}
          <b>Balance {compact(side === "buy" ? baseBalance : tokenBalance)}</b>
        </span>
        <div>
          <input
            value={input}
            inputMode="decimal"
            onChange={(event) => setInput(event.target.value)}
            aria-label={
              side === "buy"
                ? `Amount in ${isNativeV4 ? "ETH" : "mUSD"}`
                : `Amount in ${symbol}`
            }
          />
          <strong>
            {side === "buy" ? (isNativeV4 ? "ETH" : "mUSD") : symbol}
          </strong>
        </div>
      </label>
      <div className="quick-amounts">
        {(side === "buy"
          ? isNativeV4
            ? [0.0005, 0.001, 0.0025]
            : [25, 100, 250]
          : [10000, 100000, 500000]
        ).map((value) => (
          <button
            type="button"
            key={value}
            onClick={() => setInput(String(value))}
          >
            {side === "buy" && isNativeV4
              ? String(value)
              : value.toLocaleString()}
          </button>
        ))}
      </div>
      <div className="trade-receive">
        <span>You receive approximately</span>
        <strong aria-live="polite">
          {isNativeV4
            ? authoritativeQuote.state === "ready"
              ? `${Number(
                  formatEther(authoritativeQuote.amount),
                ).toLocaleString(undefined, {
                  maximumFractionDigits: side === "buy" ? 2 : 8,
                })} ${side === "buy" ? symbol : "ETH"}`
              : authoritativeQuote.state === "loading"
                ? "Quoting onchain…"
                : authoritativeQuote.state === "unavailable"
                  ? "Quote unavailable"
                  : "—"
            : `${indicativeOutput.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })} ${side === "buy" ? symbol : "mUSD"}`}
        </strong>
        <small>
          {isNativeV4
            ? "Native ETH bonding and locked Uniswap v4 market"
            : "Testnet mock market"}{" "}
          ·{" "}
          {marketPhase === "graduated" && isNativeV4
            ? "1.00% LP fee + 1.00% Sherwood reward fee"
            : `${(feeBps / 100).toFixed(2)}% Sherwood reward fee`}
        </small>
      </div>
      <button
        className="button primary trade-submit"
        disabled={busy}
        onClick={
          account && !isWrongChain && walletClient ? submit : requestWallet
        }
      >
        {busy
          ? "Submitting…"
          : isWrongChain
            ? "Switch to Robinhood Testnet"
            : account
              ? `${side === "buy" ? "Buy" : "Sell"} ${symbol}`
              : "Connect wallet"}
      </button>
      <p className="transaction-status" role="status">
        {status}
      </p>
    </ResponsiveTradePanel>
  );
}

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
const marketAbi = [
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

function compact(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

export function NetworkTokenTradePanel({
  deployment,
  token,
  market,
  symbol,
  feeBps,
  basePerToken,
}: {
  deployment: Deployment;
  token: Address;
  market: Address;
  symbol: string;
  feeBps: number;
  basePerToken: string;
}) {
  const router = useRouter();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [input, setInput] = useState("100");
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
  const [status, setStatus] = useState(
    "Connect an injected testnet wallet to trade.",
  );
  const parsed = Number(input);
  const price = Number(formatEther(BigInt(basePerToken)));
  const afterFee = 1 - feeBps / 10_000;
  const output =
    Number.isFinite(parsed) && parsed > 0
      ? side === "buy"
        ? (parsed * afterFee) / price
        : parsed * price * afterFee
      : 0;

  async function refresh(address: Address) {
    if (!publicClient) return;
    const [base, held] = await Promise.all([
      publicClient.readContract({
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
      const asset = side === "buy" ? deployment.contracts.baseAsset : token;
      setStatus(`Approving ${side === "buy" ? "mUSD" : symbol}…`);
      const approval = await walletClient.writeContract({
        address: asset,
        abi: erc20Abi,
        functionName: "approve",
        args: [market, amount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approval });
      setStatus(`${side === "buy" ? "Buying" : "Selling"} ${symbol}…`);
      const hash = await walletClient.writeContract({
        address: market,
        abi: marketAbi,
        functionName: side,
        args: [amount, 1n],
      });
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
        setInput(value === "buy" ? "100" : "10000");
      }}
      dirty={input !== (side === "buy" ? "100" : "10000")}
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
              setInput(value === "buy" ? "100" : "10000");
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
              side === "buy" ? "Amount in mUSD" : `Amount in ${symbol}`
            }
          />
          <strong>{side === "buy" ? "mUSD" : symbol}</strong>
        </div>
      </label>
      <div className="quick-amounts">
        {(side === "buy" ? [25, 100, 250] : [10000, 100000, 500000]).map(
          (value) => (
            <button
              type="button"
              key={value}
              onClick={() => setInput(String(value))}
            >
              {value.toLocaleString()}
            </button>
          ),
        )}
      </div>
      <div className="trade-receive">
        <span>You receive approximately</span>
        <strong>
          {output.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
          {side === "buy" ? symbol : "mUSD"}
        </strong>
        <small>Testnet mock market · {(feeBps / 100).toFixed(2)}% fee</small>
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

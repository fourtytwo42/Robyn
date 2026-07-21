"use client";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Deployment } from "@/lib/deployment";

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
  const [privateKey, setPrivateKey] = useState<Hex>();
  const [baseBalance, setBaseBalance] = useState(0n);
  const [tokenBalance, setTokenBalance] = useState(0n);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Enter an amount to preview the trade.");
  const rpcUrl =
    typeof window === "undefined"
      ? "http://127.0.0.1:8546"
      : "http://" + window.location.hostname + ":8546";
  const chain = useMemo(
    () =>
      defineChain({
        id: deployment.chainId,
        name: "Robyn Controlled Devnet",
        nativeCurrency: { name: "Dev Ether", symbol: "DEV", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      }),
    [deployment.chainId, rpcUrl],
  );
  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http(rpcUrl) }),
    [chain, rpcUrl],
  );
  const account = useMemo(
    () => (privateKey ? privateKeyToAccount(privateKey) : undefined),
    [privateKey],
  );
  const walletClient = useMemo(
    () =>
      account
        ? createWalletClient({ account, chain, transport: http(rpcUrl) })
        : undefined,
    [account, chain, rpcUrl],
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

  useEffect(() => {
    const stored = window.sessionStorage.getItem("robyn-devnet-session-key");
    setPrivateKey(stored?.startsWith("0x") ? (stored as Hex) : undefined);
  }, []);

  useEffect(() => {
    if (!account) return;
    void Promise.all([
      publicClient.readContract({
        address: deployment.contracts.baseAsset,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      }),
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      }),
    ]).then(([base, held]) => {
      setBaseBalance(base);
      setTokenBalance(held);
    });
  }, [account, deployment.contracts.baseAsset, publicClient, token]);

  async function submit() {
    if (!account || !walletClient) {
      setStatus(
        "Create and fund the session wallet from the home console first.",
      );
      return;
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
        account,
        address: asset,
        abi: erc20Abi,
        functionName: "approve",
        args: [market, amount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approval });
      setStatus(`${side === "buy" ? "Buying" : "Selling"} ${symbol}…`);
      const hash = await walletClient.writeContract({
        account,
        address: market,
        abi: marketAbi,
        functionName: side,
        args: [amount, 1n],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("Transaction reverted.");
      setStatus(`${side === "buy" ? "Buy" : "Sell"} confirmed.`);
      const [base, held] = await Promise.all([
        publicClient.readContract({
          address: deployment.contracts.baseAsset,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account.address],
        }),
        publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account.address],
        }),
      ]);
      setBaseBalance(base);
      setTokenBalance(held);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Trade failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="token-trade-panel" aria-labelledby="trade-panel-heading">
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
        <small>Fixed devnet price · {(feeBps / 100).toFixed(2)}% fee</small>
      </div>
      {account ? (
        <button
          className="button primary trade-submit"
          disabled={busy}
          onClick={submit}
        >
          {busy
            ? "Submitting…"
            : `${side === "buy" ? "Buy" : "Sell"} ${symbol}`}
        </button>
      ) : (
        <Link className="button primary trade-submit" href="/#devnet-console">
          Create or fund wallet
        </Link>
      )}
      <p className="transaction-status" role="status">
        {status}
      </p>
    </aside>
  );
}

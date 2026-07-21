"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatEther,
  http,
  parseEther,
  type Address,
  type EIP1193Provider,
} from "viem";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Deployment } from "@/lib/deployment";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

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
  const [account, setAccount] = useState<Address>();
  const [baseBalance, setBaseBalance] = useState(0n);
  const [tokenBalance, setTokenBalance] = useState(0n);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "Connect an injected testnet wallet to trade.",
  );
  const rpcUrl =
    process.env.NEXT_PUBLIC_ROBYN_RPC_URL ??
    "https://rpc.testnet.chain.robinhood.com";
  const chain = useMemo(
    () =>
      defineChain({
        id: deployment.chainId,
        name: "Robinhood Chain Testnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
        testnet: true,
      }),
    [deployment.chainId, rpcUrl],
  );
  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http(rpcUrl) }),
    [chain, rpcUrl],
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

  async function connect() {
    if (!window.ethereum) {
      setStatus("No injected EVM wallet is available in this browser.");
      return;
    }
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${deployment.chainId.toString(16)}` }],
      });
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as Address[];
      if (!accounts[0]) throw new Error("Wallet did not return an account.");
      setAccount(accounts[0]);
      await refresh(accounts[0]);
      setStatus("Wallet connected. Enter an amount to trade.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Wallet connection failed.",
      );
    }
  }

  async function submit() {
    if (!account || !window.ethereum) return connect();
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setStatus("Enter an amount greater than zero.");
      return;
    }
    const walletClient = createWalletClient({
      account,
      chain,
      transport: custom(window.ethereum),
    });
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
        <small>Testnet mock market · {(feeBps / 100).toFixed(2)}% fee</small>
      </div>
      <button
        className="button primary trade-submit"
        disabled={busy}
        onClick={account ? submit : connect}
      >
        {busy
          ? "Submitting…"
          : account
            ? `${side === "buy" ? "Buy" : "Sell"} ${symbol}`
            : "Connect wallet"}
      </button>
      <p className="transaction-status" role="status">
        {status}
      </p>
    </aside>
  );
}

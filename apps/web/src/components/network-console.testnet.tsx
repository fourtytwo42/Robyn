"use client";

import { formatEther, parseEther, type Hex } from "viem";
import { useCallback, useEffect, useState } from "react";
import type { Deployment } from "@/lib/deployment";
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
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
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
const baseAbi = [
  ...erc20Abi,
  {
    type: "function",
    name: "faucetClaimed",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "claimFaucet",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }],
    outputs: [],
  },
] as const;
const tokenAbi = [
  ...erc20Abi,
  {
    type: "function",
    name: "withdrawableRewardOf",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimAll",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;
const vaultAbi = [
  {
    type: "function",
    name: "leg",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "asset", type: "address" },
          { name: "weightBps", type: "uint16" },
          { name: "pendingBase", type: "uint256" },
          { name: "consumedBase", type: "uint256" },
          { name: "rewardsDeposited", type: "uint256" },
          { name: "pendingSince", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "convertLeg",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
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

type AssetState = {
  symbol: string;
  pending: bigint;
  claimable: bigint;
  balance: bigint;
};
type WalletState = {
  eth: bigint;
  base: bigint;
  token: bigint;
  assets: AssetState[];
};
const emptyState: WalletState = {
  eth: 0n,
  base: 0n,
  token: 0n,
  assets: ["tmNVDA", "tmSPY", "tmETH"].map((symbol) => ({
    symbol,
    pending: 0n,
    claimable: 0n,
    balance: 0n,
  })),
};

function compact(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 5,
  });
}

export function NetworkConsole({ deployment }: { deployment: Deployment }) {
  const {
    account,
    publicClient,
    walletClient,
    connect: openWalletModal,
    isWrongChain,
    switchToRobinhoodTestnet,
  } = useRobynTestnetWallet();
  const [state, setState] = useState<WalletState>(emptyState);
  const [status, setStatus] = useState(
    "Connect a supported self-custody wallet on Robinhood Chain Testnet.",
  );
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (selected = account) => {
      if (!selected || !publicClient) return;
      const [eth, base, token, ...values] = await Promise.all([
        publicClient.getBalance({ address: selected }),
        publicClient.readContract({
          address: deployment.contracts.baseAsset,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [selected],
        }),
        publicClient.readContract({
          address: deployment.contracts.genesisToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [selected],
        }),
        ...deployment.contracts.rewardAssets.flatMap((reward, index) => [
          publicClient.readContract({
            address: deployment.contracts.genesisVault,
            abi: vaultAbi,
            functionName: "leg",
            args: [BigInt(index)],
          }),
          publicClient.readContract({
            address: deployment.contracts.genesisToken,
            abi: tokenAbi,
            functionName: "withdrawableRewardOf",
            args: [selected, BigInt(index)],
          }),
          publicClient.readContract({
            address: reward,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [selected],
          }),
        ]),
      ]);
      setState({
        eth,
        base,
        token,
        assets: emptyState.assets.map((asset, index) => ({
          ...asset,
          pending: (values[index * 3] as { pendingBase: bigint }).pendingBase,
          claimable: values[index * 3 + 1] as bigint,
          balance: values[index * 3 + 2] as bigint,
        })),
      });
    },
    [account, deployment.contracts, publicClient],
  );

  useEffect(() => {
    if (!account || isWrongChain) {
      setState(emptyState);
      return;
    }
    void refresh(account);
  }, [account, isWrongChain, refresh]);

  async function connect() {
    setBusy(true);
    try {
      if (!account) await openWalletModal();
      else if (isWrongChain) await switchToRobinhoodTestnet();
      else await refresh(account);
    } catch (error) {
      setStatus(normalizeWalletError(error));
    } finally {
      setBusy(false);
    }
  }

  async function submit(hashPromise: Promise<Hex>) {
    if (!publicClient) throw new Error("Public RPC client is unavailable.");
    const hash = await hashPromise;
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });
    if (receipt.status !== "success") throw new Error("Transaction reverted.");
  }

  async function execute(label: string, action: () => Promise<void>) {
    if (!account || !walletClient || isWrongChain) {
      return setStatus(
        isWrongChain
          ? "Switch to Robinhood Testnet before sending a transaction."
          : "Connect a wallet first.",
      );
    }
    setBusy(true);
    setStatus(label);
    try {
      await action();
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Transaction failed.");
    } finally {
      setBusy(false);
    }
  }

  const fund = () =>
    execute("Claiming 10,000 testnet mock USD...", async () => {
      if (!account || !walletClient) return;
      const claimed = await publicClient.readContract({
        address: deployment.contracts.baseAsset,
        abi: baseAbi,
        functionName: "faucetClaimed",
        args: [account],
      });
      if (claimed)
        throw new Error(
          "This wallet already claimed its testnet mock USD allocation.",
        );
      await submit(
        walletClient.writeContract({
          address: deployment.contracts.baseAsset,
          abi: baseAbi,
          functionName: "claimFaucet",
          args: [account],
          account,
        }),
      );
      setStatus(
        "Testnet mock USD claimed. Testnet ETH must come from the network funding process.",
      );
    });

  const buy = () =>
    execute(
      "Buying the genesis token and generating basket fees...",
      async () => {
        if (!account || !walletClient) return;
        const input = parseEther("1000");
        await submit(
          walletClient.writeContract({
            address: deployment.contracts.baseAsset,
            abi: erc20Abi,
            functionName: "approve",
            args: [deployment.contracts.genesisMarket, input],
            account,
          }),
        );
        await submit(
          walletClient.writeContract({
            address: deployment.contracts.genesisMarket,
            abi: marketAbi,
            functionName: "buy",
            args: [input, parseEther("990000")],
            account,
          }),
        );
        setStatus(
          "Genesis buy completed; one percent of base input was allocated to the basket.",
        );
      },
    );

  const convert = () =>
    execute("Converting every eligible basket leg...", async () => {
      if (!account || !walletClient) return;
      const threshold = parseEther("1");
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      for (let index = 0; index < state.assets.length; index += 1) {
        const current = await publicClient.readContract({
          address: deployment.contracts.genesisVault,
          abi: vaultAbi,
          functionName: "leg",
          args: [BigInt(index)],
        });
        const pending = current.pendingBase;
        if (pending < threshold) continue;
        try {
          await submit(
            walletClient.writeContract({
              address: deployment.contracts.genesisVault,
              abi: vaultAbi,
              functionName: "convertLeg",
              args: [BigInt(index), pending, 1n, deadline],
              account,
            }),
          );
        } catch (error) {
          const latest = await publicClient.readContract({
            address: deployment.contracts.genesisVault,
            abi: vaultAbi,
            functionName: "leg",
            args: [BigInt(index)],
          });
          if (latest.pendingBase >= threshold) throw error;
        }
      }
      setStatus(
        "Basket conversion complete. Any raced leg was already converted by the keeper.",
      );
    });

  const claim = () =>
    execute("Claiming all available rewards...", async () => {
      if (!account || !walletClient) return;
      await submit(
        walletClient.writeContract({
          address: deployment.contracts.genesisToken,
          abi: tokenAbi,
          functionName: "claimAll",
          account,
        }),
      );
      setStatus("All available rewards claimed.");
    });

  const sell = () =>
    execute("Selling 10,000 genesis tokens...", async () => {
      if (!account || !walletClient) return;
      const amount = parseEther("10000");
      await submit(
        walletClient.writeContract({
          address: deployment.contracts.genesisToken,
          abi: erc20Abi,
          functionName: "approve",
          args: [deployment.contracts.genesisMarket, amount],
          account,
        }),
      );
      await submit(
        walletClient.writeContract({
          address: deployment.contracts.genesisMarket,
          abi: marketAbi,
          functionName: "sell",
          args: [amount, parseEther("9.9")],
          account,
        }),
      );
      setStatus("Sell completed and generated another basket fee.");
    });

  return (
    <section
      className="console"
      id="testnet-console"
      aria-labelledby="testnet-title"
    >
      <div className="console-heading">
        <div>
          <p className="eyebrow">Robinhood Chain Testnet</p>
          <h2 id="testnet-title">
            Use your wallet. Keep every action verifiable.
          </h2>
          <p>
            These are project-owned testnet mocks with no real-world value.
            Every write requires wallet confirmation.
          </p>
        </div>
        <span className="live-chip">Chain {deployment.chainId}</span>
      </div>
      <div className="wallet-panel">
        <div>
          <span>Wallet</span>
          <strong>
            {account
              ? `${account.slice(0, 8)}...${account.slice(-6)}`
              : "Not connected"}
          </strong>
        </div>
        <div>
          <span>Testnet ETH</span>
          <strong>{compact(state.eth)}</strong>
        </div>
        <div>
          <span>tmUSD</span>
          <strong>{compact(state.base)}</strong>
        </div>
        <div>
          <span>tROBYN</span>
          <strong>{compact(state.token)}</strong>
        </div>
      </div>
      <div className="action-row">
        <button
          className="button primary"
          onClick={() => void connect()}
          disabled={busy}
        >
          {account ? "Reconnect wallet" : "Connect wallet"}
        </button>
        <button
          className="button"
          onClick={() => void fund()}
          disabled={busy || !account}
        >
          Claim mock USD
        </button>
        <button
          className="button"
          onClick={() => void buy()}
          disabled={busy || state.base < parseEther("1000")}
        >
          Buy 990k
        </button>
        <button
          className="button ghost"
          onClick={() => void convert()}
          disabled={busy || !account}
        >
          Convert
        </button>
        <button
          className="button ghost"
          onClick={() => void claim()}
          disabled={busy || !account}
        >
          Claim
        </button>
        <button
          className="button ghost"
          onClick={() => void sell()}
          disabled={busy || state.token < parseEther("10000")}
        >
          Sell 10k
        </button>
      </div>
      <div className="asset-grid">
        {state.assets.map((asset) => (
          <article key={asset.symbol}>
            <span className="asset-symbol">{asset.symbol}</span>
            <p>Pending {compact(asset.pending)}</p>
            <p>Claimable {compact(asset.claimable)}</p>
            <p>Held {compact(asset.balance)}</p>
          </article>
        ))}
      </div>
      <p
        className="transaction-status"
        role="status"
        aria-live="polite"
        data-testid="testnet-status"
      >
        {status}
      </p>
    </section>
  );
}

"use client";

import { formatEther, parseEther, type Hex } from "viem";
import { useCallback, useEffect, useMemo, useState } from "react";
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
const nativeVaultAbi = [
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
          { name: "pendingNative", type: "uint256" },
          { name: "consumedNative", type: "uint256" },
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
const nativeMarketAbi = [
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
const v4AssetRouterAbi = [
  {
    type: "function",
    name: "route",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
          { name: "minimumLiquidity", type: "uint128" },
          { name: "maximumNativeInput", type: "uint128" },
          { name: "verificationClass", type: "bytes32" },
          { name: "enabled", type: "bool" },
        ],
      },
    ],
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
  const isNativeV4 = deployment.liquidityVenue === "uniswap-v4";
  const genesisAssets = useMemo(
    () =>
      deployment.genesis?.assets ??
      deployment.contracts.rewardAssets.slice(0, 3),
    [deployment.contracts.rewardAssets, deployment.genesis?.assets],
  );
  const configuredAssets = useMemo(
    () =>
      genesisAssets.map((address, index) => ({
        symbol:
          deployment.assetCatalog?.assets.find(
            (asset) => asset.address.toLowerCase() === address.toLowerCase(),
          )?.symbol ?? `Asset ${index + 1}`,
        pending: 0n,
        claimable: 0n,
        balance: 0n,
      })),
    [deployment.assetCatalog?.assets, genesisAssets],
  );
  const {
    account,
    publicClient,
    walletClient,
    connect: openWalletModal,
    isWrongChain,
    switchToRobinhoodTestnet,
  } = useRobynTestnetWallet();
  const [state, setState] = useState<WalletState>({
    ...emptyState,
    assets: configuredAssets,
  });
  const [status, setStatus] = useState(
    "Connect a supported self-custody wallet on Robinhood Chain Testnet.",
  );
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (selected = account) => {
      if (!selected || !publicClient) return;
      const [eth, base, token, ...values] = await Promise.all([
        publicClient.getBalance({ address: selected }),
        isNativeV4
          ? publicClient.getBalance({ address: selected })
          : publicClient.readContract({
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
        ...genesisAssets.flatMap((reward, index) => [
          publicClient.readContract({
            address: deployment.contracts.genesisVault,
            abi: isNativeV4 ? nativeVaultAbi : vaultAbi,
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
        assets: configuredAssets.map((asset, index) => ({
          ...asset,
          pending:
            "pendingNative" in
            (values[index * 3] as
              { pendingBase: bigint } | { pendingNative: bigint })
              ? (
                  values[index * 3] as {
                    pendingNative: bigint;
                  }
                ).pendingNative
              : (values[index * 3] as { pendingBase: bigint }).pendingBase,
          claimable: values[index * 3 + 1] as bigint,
          balance: values[index * 3 + 2] as bigint,
        })),
      });
    },
    [
      account,
      configuredAssets,
      deployment.contracts,
      genesisAssets,
      isNativeV4,
      publicClient,
    ],
  );

  useEffect(() => {
    if (!account || isWrongChain) {
      setState({ ...emptyState, assets: configuredAssets });
      return;
    }
    void refresh(account);
  }, [account, configuredAssets, isWrongChain, refresh]);

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

  const fund = () => {
    if (isNativeV4) {
      window.open(
        "https://robinhood.com/us/en/support/articles/robinhood-chain-testnet/",
        "_blank",
        "noopener,noreferrer",
      );
      setStatus(
        "The official Robinhood Chain Testnet faucet opened in a new tab.",
      );
      return;
    }
    return execute("Claiming 10,000 testnet mock USD...", async () => {
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
  };

  const buy = () =>
    execute(
      "Buying the genesis token and generating basket fees...",
      async () => {
        if (!account || !walletClient) return;
        const input = parseEther(isNativeV4 ? "0.0005" : "1000");
        if (isNativeV4) {
          await submit(
            walletClient.writeContract({
              address: deployment.contracts.genesisMarket,
              abi: nativeMarketAbi,
              functionName: "buy",
              args: [1n],
              value: input,
              account,
            }),
          );
        } else {
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
        }
        setStatus(
          `Genesis buy completed; one percent of ${isNativeV4 ? "native ETH" : "base input"} was allocated to the basket.`,
        );
      },
    );

  const convert = () =>
    execute("Converting every eligible basket leg...", async () => {
      if (!account || !walletClient) return;
      const threshold = isNativeV4 ? 1n : parseEther("1");
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      for (let index = 0; index < state.assets.length; index += 1) {
        const current = await publicClient.readContract({
          address: deployment.contracts.genesisVault,
          abi: isNativeV4 ? nativeVaultAbi : vaultAbi,
          functionName: "leg",
          args: [BigInt(index)],
        });
        const pending =
          "pendingNative" in current
            ? current.pendingNative
            : current.pendingBase;
        if (pending < threshold) continue;
        let conversionAmount = pending;
        if (isNativeV4) {
          const assetRouter = deployment.contracts.assetRouter;
          if (!assetRouter)
            throw new Error("V4 asset router is not configured.");
          const route = await publicClient.readContract({
            address: assetRouter,
            abi: v4AssetRouterAbi,
            functionName: "route",
            args: [current.asset],
          });
          conversionAmount =
            pending > route.maximumNativeInput
              ? route.maximumNativeInput
              : pending;
        }
        try {
          await submit(
            walletClient.writeContract({
              address: deployment.contracts.genesisVault,
              abi: isNativeV4 ? nativeVaultAbi : vaultAbi,
              functionName: "convertLeg",
              args: [BigInt(index), conversionAmount, 1n, deadline],
              account,
            }),
          );
        } catch (error) {
          const latest = await publicClient.readContract({
            address: deployment.contracts.genesisVault,
            abi: isNativeV4 ? nativeVaultAbi : vaultAbi,
            functionName: "leg",
            args: [BigInt(index)],
          });
          const latestPending =
            "pendingNative" in latest
              ? latest.pendingNative
              : latest.pendingBase;
          if (latestPending >= threshold) throw error;
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
      if (isNativeV4) {
        await submit(
          walletClient.writeContract({
            address: deployment.contracts.genesisMarket,
            abi: nativeMarketAbi,
            functionName: "sell",
            args: [amount, 1n],
            account,
          }),
        );
      } else {
        await submit(
          walletClient.writeContract({
            address: deployment.contracts.genesisMarket,
            abi: marketAbi,
            functionName: "sell",
            args: [amount, parseEther("9.9")],
            account,
          }),
        );
      }
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
            Faucet stocks and disclosed Robyn testnet mocks have no real-world
            value. Every write requires wallet confirmation.
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
          <span>{isNativeV4 ? "Native quote" : "tmUSD"}</span>
          <strong>{compact(state.base)}</strong>
        </div>
        <div>
          <span>{isNativeV4 ? "tRV4" : "tROBYN"}</span>
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
          {isNativeV4 ? "Get testnet ETH" : "Claim mock USD"}
        </button>
        <button
          className="button"
          onClick={() => void buy()}
          disabled={
            busy || state.base < parseEther(isNativeV4 ? "0.0005" : "1000")
          }
        >
          {isNativeV4 ? "Buy with 0.0005 ETH" : "Buy 990k"}
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

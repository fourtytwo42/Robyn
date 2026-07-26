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
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Deployment } from "@/lib/deployment";

type AssetState = {
  symbol: string;
  weight: string;
  pending: bigint;
  claimable: bigint;
  rewardBalance: bigint;
};

type WalletState = {
  eth: bigint;
  base: bigint;
  token: bigint;
  assets: AssetState[];
};

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const baseAbi = [
  ...erc20Abi,
  {
    type: "function",
    name: "faucetClaimed",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "claimFaucet",
    stateMutability: "nonpayable",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [],
  },
] as const;

const tokenAbi = [
  ...erc20Abi,
  {
    type: "function",
    name: "withdrawableRewardOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimAll",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "claimed", type: "uint256" }],
  },
] as const;

const vaultAbi = [
  {
    type: "function",
    name: "leg",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [
      {
        name: "",
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
      { name: "index", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "minimumOutput", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "actualOutput", type: "uint256" }],
  },
] as const;

const marketAbi = [
  {
    type: "function",
    name: "buy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "baseInput", type: "uint256" },
      { name: "minimumTokenOutput", type: "uint256" },
    ],
    outputs: [{ name: "tokenOutput", type: "uint256" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenInput", type: "uint256" },
      { name: "minimumBaseOutput", type: "uint256" },
    ],
    outputs: [{ name: "baseOutput", type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteSell",
    stateMutability: "view",
    inputs: [{ name: "tokenInput", type: "uint256" }],
    outputs: [
      { name: "feeAmount", type: "uint256" },
      { name: "baseOutput", type: "uint256" },
    ],
  },
] as const;

const emptyState: WalletState = {
  eth: 0n,
  base: 0n,
  token: 0n,
  assets: [
    {
      symbol: "mNVDA",
      weight: "40%",
      pending: 0n,
      claimable: 0n,
      rewardBalance: 0n,
    },
    {
      symbol: "mSPY",
      weight: "40%",
      pending: 0n,
      claimable: 0n,
      rewardBalance: 0n,
    },
    {
      symbol: "mETH",
      weight: "20%",
      pending: 0n,
      claimable: 0n,
      rewardBalance: 0n,
    },
  ],
};

function compact(value: bigint, digits = 4) {
  const formatted = Number(formatEther(value));
  return formatted.toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function requestFaucet(url: string, address: Address) {
  return new Promise<number>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("content-type", "application/json");
    request.onload = () => resolve(request.status);
    request.onerror = () => reject(new Error("Dev ETH faucet unavailable."));
    request.send(JSON.stringify({ address }));
  });
}

export function DevnetConsole({ deployment }: { deployment: Deployment }) {
  const [privateKey, setPrivateKey] = useState<Hex>();
  const [state, setState] = useState<WalletState>(emptyState);
  const [status, setStatus] = useState("Create a session wallet to begin.");
  const [busy, setBusy] = useState(false);

  const rpcUrl = "/rpc";
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

  const refresh = useCallback(async () => {
    if (!account) return;
    const [eth, base, token, ...assetValues] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.readContract({
        address: deployment.contracts.baseAsset,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      }),
      publicClient.readContract({
        address: deployment.contracts.genesisToken,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
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
          args: [account.address, BigInt(index)],
        }),
        publicClient.readContract({
          address: reward,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account.address],
        }),
      ]),
    ]);
    const assets = emptyState.assets.map((asset, index) => {
      const leg = assetValues[index * 3] as {
        pendingBase: bigint;
      };
      return {
        ...asset,
        pending: leg.pendingBase,
        claimable: assetValues[index * 3 + 1] as bigint,
        rewardBalance: assetValues[index * 3 + 2] as bigint,
      };
    });
    setState({ eth, base, token, assets });
  }, [account, deployment.contracts, publicClient]);

  useEffect(() => {
    const stored = window.sessionStorage.getItem("robyn-devnet-session-key");
    if (stored?.startsWith("0x")) {
      setPrivateKey(stored as Hex);
      setStatus("Session wallet restored. Live balances refreshed.");
    }
  }, []);

  useEffect(() => {
    if (!account) return;
    void refresh().catch(() => setStatus("Unable to refresh chain state."));
  }, [account, refresh]);

  function createWallet() {
    const key = generatePrivateKey();
    window.sessionStorage.setItem("robyn-devnet-session-key", key);
    setPrivateKey(key);
    window.dispatchEvent(new Event("robyn-wallet-change"));
    setStatus("Session wallet created. Fund it with dev-only assets.");
  }

  function resetWallet() {
    window.sessionStorage.removeItem("robyn-devnet-session-key");
    setPrivateKey(undefined);
    window.dispatchEvent(new Event("robyn-wallet-change"));
    setState(emptyState);
    setStatus("Session wallet cleared from this browser session.");
  }

  useEffect(() => {
    const requested = () => createWallet();
    window.addEventListener("robyn-request-wallet-create", requested);
    return () =>
      window.removeEventListener("robyn-request-wallet-create", requested);
  }, []);

  const execute = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setBusy(true);
      setStatus(label);
      try {
        await action();
        await refresh();
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "Transaction failed.",
        );
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  async function submit(hash: Hex) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Transaction reverted.");
  }

  async function fundWallet() {
    if (!account || !walletClient) return;
    await execute("Funding dev ETH and 10,000 mUSD&", async () => {
      const faucetStatus = await requestFaucet(
        rpcUrl.replace(/\/$/, "") + "/faucet",
        account.address,
      );
      if ((faucetStatus < 200 || faucetStatus >= 300) && faucetStatus !== 429)
        throw new Error("Dev ETH faucet unavailable.");
      const alreadyClaimed = await publicClient.readContract({
        address: deployment.contracts.baseAsset,
        abi: baseAbi,
        functionName: "faucetClaimed",
        args: [account.address],
      });
      if (!alreadyClaimed) {
        await submit(
          await walletClient.writeContract({
            address: deployment.contracts.baseAsset,
            abi: baseAbi,
            functionName: "claimFaucet",
            args: [account.address],
          }),
        );
      }
      setStatus("Wallet funded with 10 DEV and 10,000 mUSD.");
    });
  }

  useEffect(() => {
    const requested = () => void fundWallet();
    window.addEventListener("robyn-request-wallet-fund", requested);
    return () =>
      window.removeEventListener("robyn-request-wallet-fund", requested);
  });

  async function buy() {
    if (!account || !walletClient) return;
    const input = parseEther("1000");
    await execute("Buying ROBYN and generating basket fees&", async () => {
      const tokenBefore = await publicClient.readContract({
        address: deployment.contracts.genesisToken,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      });
      const allowance = await publicClient.readContract({
        address: deployment.contracts.baseAsset,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, deployment.contracts.genesisMarket],
      });
      if (allowance < input) {
        await submit(
          await walletClient.writeContract({
            address: deployment.contracts.baseAsset,
            abi: erc20Abi,
            functionName: "approve",
            args: [deployment.contracts.genesisMarket, input],
          }),
        );
      }
      await submit(
        await walletClient.writeContract({
          address: deployment.contracts.genesisMarket,
          abi: marketAbi,
          functionName: "buy",
          args: [input, parseEther("990000")],
        }),
      );
      const tokenAfter = await publicClient.readContract({
        address: deployment.contracts.genesisToken,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      });
      setStatus(
        `Bought ${compact(tokenAfter - tokenBefore, 0)} ROBYN. Trading fees were routed across the holder basket, creator, DAO members, and treasury.`,
      );
    });
  }

  async function convert() {
    if (!walletClient) return;
    await execute("Converting every funded basket leg&", async () => {
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
        const minimum = pending * BigInt(index + 1);
        try {
          await submit(
            await walletClient.writeContract({
              address: deployment.contracts.genesisVault,
              abi: vaultAbi,
              functionName: "convertLeg",
              args: [BigInt(index), pending, minimum, deadline],
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
  }

  async function claim() {
    if (!walletClient) return;
    await execute("Claiming all available basket rewards&", async () => {
      await submit(
        await walletClient.writeContract({
          address: deployment.contracts.genesisToken,
          abi: tokenAbi,
          functionName: "claimAll",
        }),
      );
      setStatus("All available rewards claimed to the session wallet.");
    });
  }

  async function sell() {
    if (!account || !walletClient) return;
    const input = parseEther("100000");
    await execute(
      "Selling 100,000 ROBYN and generating another fee&",
      async () => {
        const allowance = await publicClient.readContract({
          address: deployment.contracts.genesisToken,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account.address, deployment.contracts.genesisMarket],
        });
        if (allowance < input) {
          await submit(
            await walletClient.writeContract({
              address: deployment.contracts.genesisToken,
              abi: erc20Abi,
              functionName: "approve",
              args: [deployment.contracts.genesisMarket, input],
            }),
          );
        }
        const [, quotedBaseOutput] = await publicClient.readContract({
          address: deployment.contracts.genesisMarket,
          abi: marketAbi,
          functionName: "quoteSell",
          args: [input],
        });
        const minimumBaseOutput = (quotedBaseOutput * 99n) / 100n;
        await submit(
          await walletClient.writeContract({
            address: deployment.contracts.genesisMarket,
            abi: marketAbi,
            functionName: "sell",
            args: [input, minimumBaseOutput],
          }),
        );
        setStatus(
          `Sold 100,000 ROBYN against the live ${compact(quotedBaseOutput)} mUSD quote.`,
        );
      },
    );
  }

  const hasClaimable = state.assets.some((asset) => asset.claimable > 0n);
  const hasPending = state.assets.some(
    (asset) => asset.pending >= parseEther("1"),
  );

  return (
    <section className="console" aria-labelledby="console-title">
      <div className="console-heading">
        <div>
          <p className="eyebrow">Live genesis market</p>
          <h2 id="console-title">Trade ROBYN. Earn its 40 / 40 / 20 basket.</h2>
        </div>
        <span className="live-chip">Live - block state</span>
      </div>

      {!account ? (
        <div className="wallet-empty">
          <p>Create an ephemeral wallet held only in this browser session.</p>
          <button
            className="button primary"
            onClick={createWallet}
            data-testid="create-wallet"
          >
            Create session wallet
          </button>
        </div>
      ) : (
        <>
          <div className="wallet-bar">
            <div>
              <span>Session wallet</span>
              <code data-testid="wallet-address">{account.address}</code>
            </div>
            <button
              className="button ghost"
              onClick={resetWallet}
              disabled={busy}
            >
              Clear wallet
            </button>
          </div>

          <div className="balance-grid" aria-label="Wallet balances">
            <article>
              <span>Dev gas</span>
              <strong>{compact(state.eth)} DEV</strong>
            </article>
            <article>
              <span>Trading cash</span>
              <strong>{compact(state.base, 2)} mUSD</strong>
            </article>
            <article>
              <span>Community token</span>
              <strong>{compact(state.token, 0)} ROBYN</strong>
            </article>
          </div>

          <div className="action-row" aria-label="Genesis market actions">
            <button
              className="button primary"
              onClick={fundWallet}
              disabled={busy}
            >
              1. Fund wallet
            </button>
            <button
              className="button"
              onClick={buy}
              disabled={busy || state.base < parseEther("1000")}
            >
              2. Buy ROBYN
            </button>
            <button
              className="button"
              onClick={convert}
              disabled={busy || !hasPending}
            >
              3. Convert fees
            </button>
            <button
              className="button"
              onClick={claim}
              disabled={busy || !hasClaimable}
            >
              4. Claim rewards
            </button>
            <button
              className="button ghost"
              onClick={sell}
              disabled={busy || state.token < parseEther("100000")}
            >
              Sell 100k
            </button>
            <button
              className="button ghost"
              onClick={() => void refresh()}
              disabled={busy}
            >
              Refresh
            </button>
          </div>
        </>
      )}

      <div className="basket-grid" aria-label="Immutable reward basket">
        {state.assets.map((asset) => (
          <article key={asset.symbol}>
            <div>
              <span className="asset-symbol">{asset.symbol}</span>
              <span className="weight">{asset.weight}</span>
            </div>
            <dl>
              <div>
                <dt>Pending fees</dt>
                <dd>{compact(asset.pending)} mUSD</dd>
              </div>
              <div>
                <dt>Claimable</dt>
                <dd>
                  {compact(asset.claimable)} {asset.symbol}
                </dd>
              </div>
              <div>
                <dt>Wallet rewards</dt>
                <dd>
                  {compact(asset.rewardBalance)} {asset.symbol}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <p
        className="transaction-status"
        role="status"
        aria-live="polite"
        data-testid="transaction-status"
      >
        {busy ? <span className="status-dot" aria-hidden="true" /> : null}
        {status}
      </p>
      <p className="disclosure">
        ROBYN is not redeemable for this basket. Rewards shown here are funded
        only by mock trading fees on a development network and have no financial
        value.
      </p>
    </section>
  );
}

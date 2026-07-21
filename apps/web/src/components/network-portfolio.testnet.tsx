"use client";

import Link from "next/link";
import { TokenArt } from "@/components/launchpad-visuals";
import {
  createPublicClient,
  defineChain,
  formatEther,
  http,
  type Address,
  type EIP1193Provider,
} from "viem";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LaunchList, LaunchRecord } from "@/lib/data-api";

const tokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "rewardAssetCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "rewardAsset",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "withdrawableRewardOf",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawnRewardOf",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const vaultAbi = [
  {
    type: "function",
    name: "legCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
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
] as const;

const symbolAbi = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

type Reward = {
  asset: Address;
  symbol: string;
  claimable: bigint;
  claimed: bigint;
};

type Position = {
  launch: LaunchRecord;
  balance: bigint;
  pendingBase: bigint;
  rewards: Reward[];
};

function amount(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 5,
  });
}

export function NetworkPortfolioView() {
  const [wallet, setWallet] = useState<Address>();
  const [positions, setPositions] = useState<Position[]>();
  const [indexedBlock, setIndexedBlock] = useState<string | null>(null);
  const [status, setStatus] = useState("Reading the connected testnet wallet.");
  const rpcUrl =
    process.env.NEXT_PUBLIC_ROBYN_RPC_URL ??
    "https://rpc.testnet.chain.robinhood.com";
  const client = useMemo(
    () =>
      createPublicClient({
        chain: defineChain({
          id: 46630,
          name: "Robinhood Chain Testnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [rpcUrl] } },
          testnet: true,
        }),
        transport: http(rpcUrl),
      }),
    [rpcUrl],
  );

  const refresh = useCallback(async () => {
    const provider = (window as Window & { ethereum?: EIP1193Provider })
      .ethereum;
    if (!provider) {
      setWallet(undefined);
      setPositions([]);
      setStatus("No injected EVM wallet was detected.");
      return;
    }
    const accounts = await provider.request({ method: "eth_accounts" });
    const account =
      Array.isArray(accounts) && typeof accounts[0] === "string"
        ? (accounts[0] as Address)
        : undefined;
    if (!account) {
      setWallet(undefined);
      setPositions([]);
      setStatus("Connect a testnet wallet from the home page first.");
      return;
    }
    setWallet(account);
    setStatus("Loading held tokens and reward state…");
    const dataApiUrl =
      process.env.NEXT_PUBLIC_DATA_API_URL ??
      "http://" + window.location.hostname + ":3111";
    const response = await fetch(dataApiUrl + "/launches?limit=100", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Launch registry unavailable");
    const launches = (await response.json()) as LaunchList;
    setIndexedBlock(launches.asOfBlock);
    const next = await Promise.all(
      launches.data.map(async (launch): Promise<Position> => {
        const [balance, count, legCount] = await Promise.all([
          client.readContract({
            address: launch.token as Address,
            abi: tokenAbi,
            functionName: "balanceOf",
            args: [account],
          }),
          client.readContract({
            address: launch.token as Address,
            abi: tokenAbi,
            functionName: "rewardAssetCount",
          }),
          client.readContract({
            address: launch.vault as Address,
            abi: vaultAbi,
            functionName: "legCount",
          }),
        ]);
        const rewards = await Promise.all(
          Array.from({ length: Number(count) }, async (_, index) => {
            const assetIndex = BigInt(index);
            const asset = await client.readContract({
              address: launch.token as Address,
              abi: tokenAbi,
              functionName: "rewardAsset",
              args: [assetIndex],
            });
            const [symbol, claimable, claimed] = await Promise.all([
              client.readContract({
                address: asset,
                abi: symbolAbi,
                functionName: "symbol",
              }),
              client.readContract({
                address: launch.token as Address,
                abi: tokenAbi,
                functionName: "withdrawableRewardOf",
                args: [account, assetIndex],
              }),
              client.readContract({
                address: launch.token as Address,
                abi: tokenAbi,
                functionName: "withdrawnRewardOf",
                args: [account, assetIndex],
              }),
            ]);
            return { asset, symbol, claimable, claimed };
          }),
        );
        const legs = await Promise.all(
          Array.from({ length: Number(legCount) }, (_, index) =>
            client.readContract({
              address: launch.vault as Address,
              abi: vaultAbi,
              functionName: "leg",
              args: [BigInt(index)],
            }),
          ),
        );
        return {
          launch,
          balance,
          rewards,
          pendingBase: legs.reduce((sum, leg) => sum + leg.pendingBase, 0n),
        };
      }),
    );
    setPositions(
      next.filter(
        (position) =>
          position.balance > 0n ||
          position.pendingBase > 0n ||
          position.rewards.some(
            (reward) => reward.claimable > 0n || reward.claimed > 0n,
          ),
      ),
    );
    setStatus("Portfolio reconciled from live contract state.");
  }, [client]);

  useEffect(() => {
    void refresh().catch(() => {
      setStatus("Portfolio state is temporarily unavailable.");
      setPositions(undefined);
    });
    window.addEventListener("robyn-testnet-wallet-change", refresh);
    return () =>
      window.removeEventListener("robyn-testnet-wallet-change", refresh);
  }, [refresh]);

  if (!wallet) {
    return (
      <section className="empty-state portfolio-empty" aria-live="polite">
        <h2>No connected testnet wallet</h2>
        <p>
          Public discovery remains available. Connect an injected wallet from
          the testnet console to see its cross-launch positions.
        </p>
        <div className="action-row">
          <Link className="button primary" href="/#testnet-console">
            Connect wallet
          </Link>
          <Link className="button" href="/discover">
            Browse anonymously
          </Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="wallet-bar">
        <div>
          <p>Connected testnet wallet</p>
          <code>{wallet}</code>
        </div>
        <button className="button" onClick={() => void refresh()}>
          Refresh onchain state
        </button>
      </section>
      <p className="transaction-status" role="status">
        {status}
      </p>
      {positions === undefined ? (
        <p className="empty-state">Loading portfolio…</p>
      ) : positions.length === 0 ? (
        <p className="empty-state">
          This wallet has no held launch tokens, claimable rewards, pending
          launch fees or claimed history.
        </p>
      ) : (
        <section className="portfolio-grid" aria-label="Cross-launch portfolio">
          {positions.map((position) => (
            <article className="portfolio-card" key={position.launch.token}>
              <TokenArt
                symbol={position.launch.symbol}
                alt=""
                className="portfolio-token-art"
              />
              <div className="launch-card-heading">
                <div>
                  <span className="asset-symbol">{position.launch.symbol}</span>
                  <h2>{position.launch.name}</h2>
                </div>
                <span className="live-chip">#{position.launch.launch_id}</span>
              </div>
              <dl className="portfolio-summary">
                <div>
                  <dt>Held launch tokens</dt>
                  <dd>
                    {amount(position.balance)} {position.launch.symbol}
                  </dd>
                </div>
                <div>
                  <dt>Launch-level pending cash</dt>
                  <dd>{amount(position.pendingBase)} tmUSD</dd>
                </div>
              </dl>
              <div className="reward-columns">
                <section>
                  <h3>Claimable now</h3>
                  {position.rewards.map((reward) => (
                    <p key={reward.asset}>
                      {amount(reward.claimable)} {reward.symbol}
                    </p>
                  ))}
                </section>
                <section>
                  <h3>Claimed history</h3>
                  {position.rewards.map((reward) => (
                    <p key={reward.asset}>
                      {amount(reward.claimed)} {reward.symbol}
                    </p>
                  ))}
                </section>
              </div>
              <Link
                className="button"
                href={"/launches/" + position.launch.token}
              >
                Inspect allocation evidence
              </Link>
            </article>
          ))}
        </section>
      )}
      <p className="freshness page-freshness">
        Token amounts are primary · indexed registry block{" "}
        {indexedBlock ?? "unavailable"} · live values read through the user RPC
      </p>
    </>
  );
}

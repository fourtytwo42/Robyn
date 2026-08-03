"use client";

import Link from "next/link";
import { TokenCardArt } from "@/components/launchpad-visuals";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LaunchList, LaunchRecord } from "@/lib/data-api";
import { isActivePortfolioPosition } from "@/lib/portfolio-position-policy";
import deployment from "@robyn/deployment";

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
  {
    type: "function",
    name: "claimAll",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;
const claimsRouterAbi = [
  {
    type: "function",
    name: "claimAll",
    stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "token" }],
    outputs: [
      { type: "uint256", name: "claimed" },
      { type: "bool", name: "maintenanceCallSucceeded" },
    ],
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

const devnetChain = defineChain({
  id: 31337,
  name: "Robyn Controlled Devnet",
  nativeCurrency: { name: "Dev Ether", symbol: "DEV", decimals: 18 },
  rpcUrls: { default: { http: ["/rpc"] } },
});

export function PortfolioView({
  account: requestedAccount,
  readOnly = false,
}: {
  account?: Address;
  readOnly?: boolean;
} = {}) {
  const [wallet, setWallet] = useState<Address>();
  const [positions, setPositions] = useState<Position[]>();
  const [indexedBlock, setIndexedBlock] = useState<string | null>(null);
  const [claimingToken, setClaimingToken] = useState<Address>();
  const [status, setStatus] = useState("Reading this browser session wallet.");
  const rpcUrl = "/rpc";
  const client = useMemo(
    () =>
      createPublicClient({
        chain: devnetChain,
        transport: http(rpcUrl),
      }),
    [rpcUrl],
  );

  const refresh = useCallback(async () => {
    const stored = requestedAccount
      ? undefined
      : window.sessionStorage.getItem("robyn-devnet-session-key");
    const account = requestedAccount
      ? { address: requestedAccount }
      : stored?.startsWith("0x")
        ? privateKeyToAccount(stored as Hex)
        : undefined;
    if (!account) {
      setWallet(undefined);
      setPositions([]);
      setStatus("No session wallet exists in this browser tab.");
      return;
    }
    setWallet(account.address);
    setStatus(
      readOnly
        ? "Loading this wallet's public onchain portfolio…"
        : "Loading held tokens and reward state…",
    );
    const response = await fetch("/api/launches?limit=100", {
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
            args: [account.address],
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
                args: [account.address, assetIndex],
              }),
              client.readContract({
                address: launch.token as Address,
                abi: tokenAbi,
                functionName: "withdrawnRewardOf",
                args: [account.address, assetIndex],
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
      next.filter((position) => isActivePortfolioPosition(position)),
    );
    setStatus(
      readOnly
        ? "Public portfolio reconciled from live contract state."
        : "Portfolio reconciled from live contract state.",
    );
  }, [client, readOnly, requestedAccount]);

  const claimRewards = useCallback(
    async (position: Position) => {
      if (readOnly || requestedAccount) {
        setStatus("Connect this wallet to claim its rewards.");
        return;
      }
      const stored = window.sessionStorage.getItem("robyn-devnet-session-key");
      if (!stored?.startsWith("0x")) {
        setStatus("The session wallet is no longer available.");
        return;
      }
      const account = privateKeyToAccount(stored as Hex);
      const token = position.launch.token as Address;
      setClaimingToken(token);
      setStatus(`Simulating ${position.launch.symbol} reward claim…`);
      try {
        const { request } = await client.simulateContract({
          account,
          address: deployment.contracts.claimsRouter ?? token,
          abi: deployment.contracts.claimsRouter
            ? claimsRouterAbi
            : tokenAbi,
          functionName: "claimAll",
          ...(deployment.contracts.claimsRouter ? { args: [token] } : {}),
        });
        const walletClient = createWalletClient({
          account,
          chain: devnetChain,
          transport: http(rpcUrl),
        });
        const hash = await walletClient.writeContract(request);
        setStatus(`Claim submitted: ${hash.slice(0, 12)}…`);
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Claim reverted.");
        await refresh();
        setStatus(
          `${position.launch.symbol} basket rewards claimed to the session wallet.`,
        );
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "Reward claim failed.",
        );
      } finally {
        setClaimingToken(undefined);
      }
    },
    [client, readOnly, refresh, requestedAccount, rpcUrl],
  );

  useEffect(() => {
    void refresh().catch(() => {
      setStatus("Portfolio state is temporarily unavailable.");
      setPositions(undefined);
    });
    window.addEventListener("robyn-wallet-change", refresh);
    return () => window.removeEventListener("robyn-wallet-change", refresh);
  }, [refresh]);

  if (!wallet) {
    return (
      <section className="empty-state portfolio-empty" aria-live="polite">
        <h2>No session wallet in this tab</h2>
        <p>
          Public discovery remains available. Create or restore a development
          wallet from the live console to see its cross-launch positions.
        </p>
        <div className="action-row">
          <Link className="button primary" href="/#devnet-console">
            Open wallet console
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
          <p>{readOnly ? "Public wallet" : "Session wallet"}</p>
          <code>{wallet}</code>
        </div>
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
              <TokenCardArt
                symbol={position.launch.symbol}
                name={position.launch.name}
                badge="Your position"
                launchNumber={position.launch.launch_id}
              />
              <dl className="portfolio-summary">
                <div>
                  <dt>Held launch tokens</dt>
                  <dd>
                    {amount(position.balance)} {position.launch.symbol}
                  </dd>
                </div>
                <div>
                  <dt>Launch-level pending cash</dt>
                  <dd>{amount(position.pendingBase)} mUSD</dd>
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
              {!readOnly ? (
                <button
                  className="button primary"
                  disabled={
                    claimingToken !== undefined ||
                    !position.rewards.some((reward) => reward.claimable > 0n)
                  }
                  onClick={() => void claimRewards(position)}
                >
                  {claimingToken === position.launch.token
                    ? "Claiming…"
                    : `Claim ${position.launch.symbol} rewards`}
                </button>
              ) : null}
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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BaseError,
  formatEther,
  parseAbi,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  holderRewardAction,
  holderRewardActionLabel,
} from "@/lib/holder-reward-policy";

const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function rewardAssetCount() view returns (uint256)",
  "function rewardAsset(uint256) view returns (address)",
  "function withdrawableRewardOf(address,uint256) view returns (uint256)",
  "function withdrawnRewardOf(address,uint256) view returns (uint256)",
  "function claimAll()",
]);
const claimsRouterAbi = parseAbi([
  "function claimAll(address token) returns (uint256 claimed,bool maintenanceCallSucceeded)",
]);
const symbolAbi = parseAbi(["function symbol() view returns (string)"]);

type HolderReward = {
  asset: Address;
  symbol: string;
  claimable: bigint;
  claimed: bigint;
};

function amount(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

function short(address: Address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function HolderRewardsPanel({
  claimsRouter,
  account,
  token,
  symbol,
  publicClient,
  walletClient,
  correctChain = true,
  connect,
  switchNetwork,
}: {
  claimsRouter?: Address;
  account?: Address;
  token: Address;
  symbol: string;
  publicClient: PublicClient;
  walletClient?: WalletClient;
  correctChain?: boolean;
  connect?: () => Promise<void> | void;
  switchNetwork?: () => Promise<void> | void;
}) {
  const [balance, setBalance] = useState(0n);
  const [rewards, setRewards] = useState<HolderReward[]>();
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    if (!account) {
      setBalance(0n);
      setRewards([]);
      return;
    }
    const [nextBalance, count] = await Promise.all([
      publicClient.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [account],
      }),
      publicClient.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "rewardAssetCount",
      }),
    ]);
    const nextRewards = await Promise.all(
      Array.from({ length: Number(count) }, async (_, index) => {
        const assetIndex = BigInt(index);
        const asset = await publicClient.readContract({
          address: token,
          abi: tokenAbi,
          functionName: "rewardAsset",
          args: [assetIndex],
        });
        const [assetSymbol, claimable, claimed] = await Promise.all([
          publicClient
            .readContract({
              address: asset,
              abi: symbolAbi,
              functionName: "symbol",
            })
            .catch(() => short(asset)),
          publicClient.readContract({
            address: token,
            abi: tokenAbi,
            functionName: "withdrawableRewardOf",
            args: [account, assetIndex],
          }),
          publicClient.readContract({
            address: token,
            abi: tokenAbi,
            functionName: "withdrawnRewardOf",
            args: [account, assetIndex],
          }),
        ]);
        return { asset, symbol: assetSymbol, claimable, claimed };
      }),
    );
    setBalance(nextBalance);
    setRewards(nextRewards);
  }, [account, publicClient, token]);

  useEffect(() => {
    void refresh().catch(() =>
      setStatus("Holder reward state is temporarily unavailable."),
    );
    const interval = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 8_000);
    const onFocus = () => void refresh().catch(() => undefined);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const claimableAssetCount = useMemo(
    () => rewards?.filter((reward) => reward.claimable > 0n).length ?? 0,
    [rewards],
  );
  const action = holderRewardAction({
    connected: Boolean(account),
    correctChain,
    walletReady: Boolean(walletClient),
    working,
    claimableAssetCount,
  });

  async function act() {
    if (action === "connect") {
      await connect?.();
      return;
    }
    if (action === "switch-network") {
      await switchNetwork?.();
      return;
    }
    if (action !== "claim" || !account || !walletClient) return;
    setWorking(true);
    setStatus(`Simulating ${symbol} holder reward claim...`);
    try {
      const { request } = await publicClient.simulateContract({
        account: walletClient.account ?? account,
        address: claimsRouter ?? token,
        abi: claimsRouter ? claimsRouterAbi : tokenAbi,
        functionName: "claimAll",
        ...(claimsRouter ? { args: [token] as const } : {}),
      });
      const hash = await walletClient.writeContract(request);
      setStatus(`Claim submitted: ${hash.slice(0, 12)}...`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("Reward claim reverted.");
      await refresh();
      setStatus(`All claimable ${symbol} basket rewards were claimed.`);
    } catch (error) {
      setStatus(
        error instanceof BaseError
          ? error.shortMessage
          : error instanceof Error
            ? error.message
            : "Holder reward claim failed.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      className="holder-earnings-panel"
      aria-labelledby="holder-earnings-heading"
    >
      <div className="holder-earnings-heading">
        <div>
          <p className="card-label">Your holder rewards</p>
          <h2 id="holder-earnings-heading">
            {account
              ? `${claimableAssetCount} basket asset${claimableAssetCount === 1 ? "" : "s"} claimable`
              : "Connect to check rewards"}
          </h2>
        </div>
        {account ? (
          <span>
            {amount(balance)} {symbol} held
          </span>
        ) : null}
      </div>
      {!account ? (
        <p>
          Connect the wallet that holds this token to see and claim its streamed
          basket rewards.
        </p>
      ) : rewards === undefined ? (
        <p className="muted">Loading live holder rewards...</p>
      ) : rewards.length === 0 ? (
        <p className="muted">This launch has no reward assets yet.</p>
      ) : (
        <div className="holder-reward-assets" aria-label="Holder reward assets">
          {rewards.map((reward) => (
            <div key={reward.asset}>
              <span>{reward.symbol}</span>
              <strong>{amount(reward.claimable)}</strong>
              <small>{amount(reward.claimed)} claimed</small>
            </div>
          ))}
        </div>
      )}
      <button
        className="button primary"
        type="button"
        disabled={
          action === "claiming" ||
          action === "nothing-to-claim" ||
          action === "wallet-unavailable"
        }
        onClick={() => void act()}
      >
        {holderRewardActionLabel(action)}
      </button>
      <p className="holder-reward-note">
        Claims every currently available basket asset for this token. On
        Schema-20, the claim then attempts one bounded maintenance task; a
        maintenance failure cannot undo the claim.
      </p>
      {status ? (
        <p className="transaction-status" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}

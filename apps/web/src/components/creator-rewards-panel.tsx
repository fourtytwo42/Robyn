"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BaseError,
  formatEther,
  parseAbi,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";

const feeRouterAbi = parseAbi([
  "function claimCreatorFees(address token) returns (uint256)",
]);

export type CreatorRewardState = {
  token: Address;
  creator: Address;
  viewerIsCreator: boolean;
  pendingCreatorBase: string;
  claimableNative: string;
  lifetimeAccruedNative: string;
  lifetimeClaimedNative: string;
};

function amount(value: string, digits = 6) {
  return Number(formatEther(BigInt(value))).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

export function CreatorRewardsPanel({
  account,
  creator,
  token,
  publicClient,
  walletClient,
}: {
  account?: Address;
  creator: Address;
  token: Address;
  publicClient: PublicClient;
  walletClient?: WalletClient;
}) {
  const [data, setData] = useState<CreatorRewardState>();
  const [router, setRouter] = useState<Address>();
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);
  const isCreator =
    account?.toLowerCase() === creator.toLowerCase() && walletClient;

  const refresh = useCallback(async () => {
    if (!account || account.toLowerCase() !== creator.toLowerCase()) {
      setData(undefined);
      return;
    }
    const [rewardResponse, daoResponse] = await Promise.all([
      fetch(`/api/launches/${token}/creator-rewards?account=${account}`, {
        cache: "no-store",
      }),
      fetch(`/api/dao?account=${account}`, { cache: "no-store" }),
    ]);
    if (!rewardResponse.ok || !daoResponse.ok) {
      throw new Error("Creator reward state is unavailable.");
    }
    const rewardPayload = (await rewardResponse.json()) as {
      data: CreatorRewardState;
    };
    const daoPayload = (await daoResponse.json()) as {
      data: { contracts: { protocolFeeRouter: Address } };
    };
    setData(rewardPayload.data);
    setRouter(daoPayload.data.contracts.protocolFeeRouter);
  }, [account, creator, token]);

  useEffect(() => {
    void refresh().catch((error) =>
      setStatus(error instanceof Error ? error.message : "Refresh failed."),
    );
    const interval = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 5_000);
    const onFocus = () => void refresh().catch(() => undefined);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  if (!isCreator || !data) return null;

  async function claim() {
    if (!account || !router || !walletClient) return;
    setWorking(true);
    setStatus("Simulating token-specific creator claim…");
    try {
      const request = await publicClient.simulateContract({
        account: walletClient.account ?? account,
        address: router,
        abi: feeRouterAbi,
        functionName: "claimCreatorFees",
        args: [token],
      });
      const hash = await walletClient.writeContract(request.request);
      setStatus(`Claim submitted: ${hash.slice(0, 12)}…`);
      await publicClient.waitForTransactionReceipt({ hash });
      await refresh();
      setStatus("Creator ETH claimed for this token only.");
    } catch (error) {
      setStatus(
        error instanceof BaseError
          ? error.shortMessage
          : error instanceof Error
            ? error.message
            : "Creator claim failed.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      className="creator-earnings-panel"
      aria-labelledby="creator-earnings-heading"
    >
      <div>
        <p className="card-label">Creator-only earnings</p>
        <h2 id="creator-earnings-heading">
          {amount(data.claimableNative)} ETH claimable
        </h2>
        <p>
          These fees belong only to this launch. Other tokens you created keep
          independent balances.
        </p>
      </div>
      <dl className="creator-earnings-metrics">
        <div>
          <dt>Pending conversion</dt>
          <dd>{amount(data.pendingCreatorBase)} mUSD</dd>
        </div>
        <div>
          <dt>Lifetime earned</dt>
          <dd>{amount(data.lifetimeAccruedNative)} ETH</dd>
        </div>
        <div>
          <dt>Lifetime claimed</dt>
          <dd>{amount(data.lifetimeClaimedNative)} ETH</dd>
        </div>
      </dl>
      <button
        className="button primary"
        disabled={working || BigInt(data.claimableNative) === 0n}
        onClick={() => void claim()}
      >
        {working ? "Claiming…" : "Claim this token"}
      </button>
      {status ? (
        <p className="transaction-status" role="status">
          {status}
        </p>
      ) : null}
      <small>
        This panel is wallet-gated for convenience. Balances and claim events
        remain publicly inspectable onchain.
      </small>
    </section>
  );
}

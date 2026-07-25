"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BaseError,
  formatEther,
  isAddress,
  parseAbi,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { TokenCardArt } from "@/components/launchpad-visuals";
import { LaunchTokenTrigger } from "@/components/launch-token-trigger";
import type { LaunchList, LaunchRecord } from "@/lib/data-api";
import type { CreatorRewardState } from "./creator-rewards-panel";

const feeRouterAbi = parseAbi([
  "function claimCreatorFees(address token) returns (uint256)",
  "function claimCreatorFeesBatch(address[] tokens) returns (uint256)",
  "function claimCreatorFeesBatchTo(address[] tokens,address recipient) returns (uint256)",
]);

type CreatorLaunch = {
  launch: LaunchRecord;
  rewards: CreatorRewardState;
};

type Profile = {
  display_name?: string;
  bio?: string;
  website?: string;
  x_url?: string;
  telegram_url?: string;
  discord_url?: string;
  avatar_media_id?: string;
};

function amount(value: string, digits = 6) {
  return Number(formatEther(BigInt(value))).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

export function CreatorPortfolio({
  account,
  publicClient,
  walletClient,
  readOnly = false,
}: {
  account?: Address;
  publicClient: PublicClient;
  walletClient?: WalletClient;
  readOnly?: boolean;
}) {
  const [launches, setLaunches] = useState<CreatorLaunch[]>();
  const [profile, setProfile] = useState<Profile>();
  const [router, setRouter] = useState<Address>();
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    if (!account) {
      setLaunches(undefined);
      return;
    }
    const [launchResponse, profileResponse, daoResponse] = await Promise.all([
      fetch(`/api/launches?creator=${account}&limit=100`, {
        cache: "no-store",
      }),
      fetch(`/api/profiles/${account}`, { cache: "no-store" }),
      fetch(`/api/dao?account=${account}`, { cache: "no-store" }),
    ]);
    if (!launchResponse.ok || !daoResponse.ok) {
      throw new Error("Creator portfolio is unavailable.");
    }
    const launchPayload = (await launchResponse.json()) as LaunchList;
    const daoPayload = (await daoResponse.json()) as {
      data: { contracts: { protocolFeeRouter: Address } };
    };
    const rewardRows = await Promise.all(
      launchPayload.data.map(async (launch) => {
        const response = await fetch(
          `/api/launches/${launch.token}/creator-rewards?account=${account}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("Creator earnings are unavailable.");
        return {
          launch,
          rewards: ((await response.json()) as { data: CreatorRewardState })
            .data,
        };
      }),
    );
    setRouter(daoPayload.data.contracts.protocolFeeRouter);
    setLaunches(rewardRows);
    if (profileResponse.ok) {
      const payload = (await profileResponse.json()) as {
        data: Profile | null;
      };
      setProfile(payload.data ?? undefined);
    }
  }, [account]);

  useEffect(() => {
    void refresh().catch((error) =>
      setStatus(error instanceof Error ? error.message : "Refresh failed."),
    );
  }, [refresh]);

  const totals = useMemo(
    () =>
      (launches ?? []).reduce(
        (sum, row) => ({
          pending: sum.pending + BigInt(row.rewards.pendingCreatorBase),
          claimable: sum.claimable + BigInt(row.rewards.claimableNative),
          accrued: sum.accrued + BigInt(row.rewards.lifetimeAccruedNative),
          claimed: sum.claimed + BigInt(row.rewards.lifetimeClaimedNative),
        }),
        { pending: 0n, claimable: 0n, accrued: 0n, claimed: 0n },
      ),
    [launches],
  );

  if (!account) return null;
  const canManage = Boolean(walletClient) && !readOnly;

  async function transact(
    functionName:
      "claimCreatorFees" | "claimCreatorFeesBatch" | "claimCreatorFeesBatchTo",
    args:
      readonly [Address] | readonly [Address[]] | readonly [Address[], Address],
  ) {
    if (!account || !router || !walletClient) return;
    setWorking(true);
    setStatus("Simulating creator claim…");
    try {
      const request = await publicClient.simulateContract({
        account: walletClient.account ?? account,
        address: router,
        abi: feeRouterAbi,
        functionName,
        args,
      });
      const hash = await walletClient.writeContract(request.request);
      setStatus(`Claim submitted: ${hash.slice(0, 12)}…`);
      await publicClient.waitForTransactionReceipt({ hash });
      await refresh();
      setStatus("Creator reward balances refreshed from chain state.");
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

  const claimableTokens = (launches ?? [])
    .filter((row) => BigInt(row.rewards.claimableNative) > 0n)
    .map((row) => row.launch.token as Address);

  return (
    <section
      className="creator-portfolio"
      aria-labelledby="creator-portfolio-heading"
    >
      <div className="creator-profile-card">
        <div>
          <p className="eyebrow">Wallet-owned creator profile</p>
          <h2>{profile?.display_name ?? "Unnamed creator"}</h2>
          <p>
            {profile?.bio ?? "Add a public bio and links for your launches."}
          </p>
          <small>
            Wallet ownership is verified. External social accounts are not.
          </small>
        </div>
        {canManage ? (
          <LaunchTokenTrigger className="button">
            Edit creator profile
          </LaunchTokenTrigger>
        ) : null}
      </div>

      <div className="creator-summary" aria-label="Creator earnings totals">
        <article>
          <span>Claimable now</span>
          <strong>{amount(totals.claimable.toString())} ETH</strong>
        </article>
        <article>
          <span>Pending conversion</span>
          <strong>{amount(totals.pending.toString())} mUSD</strong>
        </article>
        <article>
          <span>Lifetime earned</span>
          <strong>{amount(totals.accrued.toString())} ETH</strong>
        </article>
        <article>
          <span>Lifetime claimed</span>
          <strong>{amount(totals.claimed.toString())} ETH</strong>
        </article>
      </div>

      <div className="section-heading">
        <div>
          <p className="card-label">Created tokens</p>
          <h2 id="creator-portfolio-heading">
            {launches?.length ?? 0} canonical launch
            {(launches?.length ?? 0) === 1 ? "" : "es"}
          </h2>
        </div>
        {canManage ? (
          <button
            className="button primary"
            disabled={working || claimableTokens.length === 0}
            onClick={() =>
              void transact("claimCreatorFeesBatch", [claimableTokens])
            }
          >
            {working ? "Processing…" : "Claim all"}
          </button>
        ) : null}
      </div>

      {launches === undefined ? (
        <p className="empty-state">Loading created tokens…</p>
      ) : launches.length === 0 ? (
        <p className="empty-state">
          This wallet has not created a canonical launch yet.
        </p>
      ) : (
        <div className="creator-token-grid">
          {launches.map(({ launch, rewards }) => (
            <article className="creator-token-card" key={launch.token}>
              <TokenCardArt
                symbol={launch.symbol}
                name={launch.name}
                badge="Creator earnings"
                launchNumber={launch.launch_id}
              />
              <h3>
                {launch.name} <span>${launch.symbol}</span>
              </h3>
              <dl>
                <div>
                  <dt>Claimable</dt>
                  <dd>{amount(rewards.claimableNative)} ETH</dd>
                </div>
                <div>
                  <dt>Pending</dt>
                  <dd>{amount(rewards.pendingCreatorBase)} mUSD</dd>
                </div>
                <div>
                  <dt>Lifetime</dt>
                  <dd>{amount(rewards.lifetimeAccruedNative)} ETH</dd>
                </div>
              </dl>
              <div className="action-row">
                {canManage ? (
                  <button
                    className="button primary"
                    disabled={working || BigInt(rewards.claimableNative) === 0n}
                    onClick={() =>
                      void transact("claimCreatorFees", [
                        launch.token as Address,
                      ])
                    }
                  >
                    Claim token
                  </button>
                ) : null}
                <Link className="button" href={`/launches/${launch.token}`}>
                  View token
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      {canManage ? (
        <details className="advanced-token-details">
          <summary>
            <span>
              <b>Advanced claim recipient</b>
              <small>Send all currently claimable token fees elsewhere</small>
            </span>
            <span>Open</span>
          </summary>
          <div className="advanced-claim-control">
            <label className="field">
              <span>Recipient address</span>
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="0x…"
              />
            </label>
            <button
              className="button"
              disabled={
                working || !isAddress(recipient) || claimableTokens.length === 0
              }
              onClick={() =>
                void transact("claimCreatorFeesBatchTo", [
                  claimableTokens,
                  recipient as Address,
                ])
              }
            >
              Claim all to address
            </button>
          </div>
        </details>
      ) : null}
      {status ? (
        <p className="transaction-status" role="status">
          {status}
        </p>
      ) : null}
      <p className="freshness">
        {canManage
          ? "Personal controls are shown only to the connected canonical creator."
          : "Read-only view. Connect this canonical creator wallet to manage its profile or claim fees."}{" "}
        Fee balances and claim events remain public blockchain data.
      </p>
    </section>
  );
}

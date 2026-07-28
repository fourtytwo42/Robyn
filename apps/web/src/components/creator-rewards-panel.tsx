"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BaseError,
  formatEther,
  isAddress,
  parseAbi,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";

const feeRouterAbi = parseAbi([
  "function claimCreatorFees(address token) returns (uint256)",
  "function setCreatorFeeSplit(address token,address[] recipients,uint16[] sharesBps,bool lockConfiguration)",
]);

type CreatorSplit = {
  recipients: Address[];
  sharesBps: number[];
  locked: boolean;
  maxRecipients: number;
};

export type CreatorRewardState = {
  token: Address;
  creator: Address;
  viewerIsCreator: boolean;
  pendingCreatorBase: string;
  claimableNative: string;
  lifetimeAccruedNative: string;
  lifetimeClaimedNative: string;
  creatorSplit: CreatorSplit | null;
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
  const [splitRows, setSplitRows] = useState<
    { recipient: string; percent: string }[]
  >([]);
  const [lockConfiguration, setLockConfiguration] = useState(false);
  const isCreator =
    account?.toLowerCase() === creator.toLowerCase() && Boolean(walletClient);

  const refresh = useCallback(async () => {
    if (!account) {
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
    if (rewardPayload.data.creatorSplit) {
      setSplitRows(
        rewardPayload.data.creatorSplit.recipients.map((recipient, index) => ({
          recipient,
          percent: (
            rewardPayload.data.creatorSplit!.sharesBps[index] / 100
          ).toString(),
        })),
      );
      setLockConfiguration(false);
    }
    setRouter(daoPayload.data.contracts.protocolFeeRouter);
  }, [account, token]);

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

  if (!data || (!isCreator && BigInt(data.claimableNative) === 0n)) return null;
  const creatorSplit = data.creatorSplit;

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

  async function saveSplit() {
    if (!account || !router || !walletClient || !isCreator || !creatorSplit)
      return;
    const recipients = splitRows.map((row) => row.recipient.trim());
    const sharesBps = splitRows.map((row) =>
      Math.round(Number(row.percent) * 100),
    );
    if (
      recipients.length === 0 ||
      recipients.length > creatorSplit.maxRecipients ||
      recipients.some((recipient) => !isAddress(recipient)) ||
      new Set(recipients.map((recipient) => recipient.toLowerCase())).size !==
        recipients.length ||
      sharesBps.some((share) => share <= 0) ||
      sharesBps.reduce((sum, share) => sum + share, 0) !== 10_000
    ) {
      setStatus(
        "Use unique valid addresses and positive percentages totaling exactly 100%.",
      );
      return;
    }
    if (
      lockConfiguration &&
      !window.confirm(
        "Lock this creator reward split permanently? It can never be edited again.",
      )
    )
      return;
    setWorking(true);
    setStatus("Simulating creator reward split…");
    try {
      const request = await publicClient.simulateContract({
        account: walletClient.account ?? account,
        address: router,
        abi: feeRouterAbi,
        functionName: "setCreatorFeeSplit",
        args: [token, recipients as Address[], sharesBps, lockConfiguration],
      });
      const hash = await walletClient.writeContract(request.request);
      setStatus(`Split submitted: ${hash.slice(0, 12)}…`);
      await publicClient.waitForTransactionReceipt({ hash });
      await refresh();
      setStatus(
        lockConfiguration
          ? "Creator reward split is permanently locked."
          : "Creator reward split saved for future fees.",
      );
    } catch (error) {
      setStatus(
        error instanceof BaseError
          ? error.shortMessage
          : error instanceof Error
            ? error.message
            : "Creator split update failed.",
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
        <p className="card-label">Creator earnings</p>
        <h2 id="creator-earnings-heading">
          {amount(data.claimableNative)} ETH claimable
        </h2>
        <p>
          Your assigned fees are claimable immediately. Each launch keeps an
          independent balance.
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
      {isCreator && creatorSplit ? (
        <div className="creator-split-editor">
          <div>
            <p className="card-label">Future creator fees</p>
            <h3>
              {creatorSplit.locked
                ? "Reward split locked"
                : "Assign the 25% creator share"}
            </h3>
            <p>
              Changes apply only to future fees. Rewards already assigned to an
              address stay with that address.
            </p>
          </div>
          <div className="creator-split-rows">
            {splitRows.map((row, index) => (
              <div className="creator-split-row" key={index}>
                <label>
                  <span>Recipient {index + 1}</span>
                  <input
                    value={row.recipient}
                    disabled={creatorSplit.locked || working}
                    onChange={(event) =>
                      setSplitRows((rows) =>
                        rows.map((entry, rowIndex) =>
                          rowIndex === index
                            ? { ...entry, recipient: event.target.value }
                            : entry,
                        ),
                      )
                    }
                    placeholder="0x…"
                  />
                </label>
                <label>
                  <span>Percent</span>
                  <input
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={row.percent}
                    disabled={creatorSplit.locked || working}
                    onChange={(event) =>
                      setSplitRows((rows) =>
                        rows.map((entry, rowIndex) =>
                          rowIndex === index
                            ? { ...entry, percent: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                </label>
                {!creatorSplit.locked && splitRows.length > 1 ? (
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Remove recipient ${index + 1}`}
                    onClick={() =>
                      setSplitRows((rows) =>
                        rows.filter((_, rowIndex) => rowIndex !== index),
                      )
                    }
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {!creatorSplit.locked ? (
            <div className="creator-split-actions">
              <button
                className="button"
                type="button"
                disabled={
                  working || splitRows.length >= creatorSplit.maxRecipients
                }
                onClick={() =>
                  setSplitRows((rows) => [
                    ...rows,
                    { recipient: "", percent: "" },
                  ])
                }
              >
                Add recipient
              </button>
              <label className="creator-split-lock">
                <input
                  type="checkbox"
                  checked={lockConfiguration}
                  onChange={(event) =>
                    setLockConfiguration(event.target.checked)
                  }
                />
                Lock permanently after saving
              </label>
              <button
                className="button primary"
                type="button"
                disabled={working}
                onClick={() => void saveSplit()}
              >
                Save split
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {status ? (
        <p className="transaction-status" role="status">
          {status}
        </p>
      ) : null}
      <small>
        Split recipients claim their own assigned ETH. Only the canonical token
        creator can edit an open split or lock it permanently.
      </small>
    </section>
  );
}

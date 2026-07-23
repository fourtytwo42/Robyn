"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatEther,
  encodeFunctionData,
  isAddress,
  keccak256,
  parseAbi,
  parseEther,
  toBytes,
  type Address,
  type Abi,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import type { Deployment } from "@/lib/deployment";

const daoTokenAbi = parseAbi([
  "function claimRewards() returns (uint256)",
  "function claimRewardsTo(address) returns (uint256)",
  "function delegate(address)",
]);
const feeRouterAbi = parseAbi([
  "function claimCreatorFees() returns (uint256)",
  "function claimCreatorFeesTo(address) returns (uint256)",
]);
const governorAbi = parseAbi([
  "function propose(address[] targets,uint256[] values,bytes[] calldatas,string description) returns (uint256)",
  "function castVote(uint256 proposalId,uint8 support) returns (uint256)",
  "function queue(address[] targets,uint256[] values,bytes[] calldatas,bytes32 descriptionHash) returns (uint256)",
  "function execute(address[] targets,uint256[] values,bytes[] calldatas,bytes32 descriptionHash) payable returns (uint256)",
]);

type DaoOverview = {
  contracts: {
    daoToken: Address;
    governor: Address;
    timelock: Address;
    guardian: Address;
    protocolFeeRouter: Address;
    nativeFeeConverter: Address;
  };
  feePolicy: {
    basketBps: number;
    creatorBps: number;
    daoRewardsBps: number;
    treasuryBps: number;
  };
  totalSupply: string;
  eligibleRewardSupply: string;
  totalRewardsDeposited: string;
  totalRewardsClaimed: string;
  pendingCreatorLiability: string;
  totalDaoNativeRewards: string;
  totalTreasuryNative: string;
  treasuryBalance: string;
  conversionPaused: boolean;
  launchFees: Array<{
    token: Address;
    creator: Address;
    pendingCreatorBase: string;
    pendingDaoRewardBase: string;
    pendingTreasuryBase: string;
    cumulativeBaseFees: string;
    cumulativeLaunchFeesConverted: string;
    cumulativeNativeConverted: string;
  }>;
  governance: {
    votingDelaySeconds: string;
    votingPeriodSeconds: string;
    proposalThreshold: string;
    currentQuorum: string;
  };
  account: null | {
    address: Address;
    balance: string;
    delegate: Address;
    votingPower: string;
    claimableRewards: string;
    lifetimeRewards: string;
    claimableCreatorFees: string;
  };
};
type Proposal = {
  id: string;
  proposer: Address;
  title: string;
  description: string;
  targets: Address[];
  values: string[];
  calldatas: Hex[];
  voteStart: string;
  voteEnd: string;
  state: string;
  againstVotes: string;
  forVotes: string;
  abstainVotes: string;
  hasVoted: boolean;
  eta: string | null;
  transactionHash: Hex;
  votes: Array<{
    voter: Address;
    support: number;
    weight: string;
    reason: string;
    transactionHash: Hex;
  }>;
};
type Member = {
  address: Address;
  balance: string;
  delegate: Address;
  votingPower: string;
  claimableRewards: string;
};
type Activity = {
  address: Address;
  blockNumber: string | null;
  transactionHash: Hex;
  topic: Hex | null;
};
type Tab =
  "overview" | "rewards" | "governance" | "treasury" | "members" | "activity";

function tokenAmount(value: string, digits = 2) {
  return Number(formatEther(BigInt(value))).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}
function short(address: string) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}
function percentage(value: number) {
  return (value / 100).toFixed(value % 100 === 0 ? 0 : 2) + "%";
}

export function DaoView({
  deployment,
  proposalId,
  account,
  rpcClient,
  walletClient,
  connect,
  dataApiUrl,
}: {
  deployment: Deployment;
  proposalId?: string;
  account?: Address;
  rpcClient: PublicClient;
  walletClient?: WalletClient;
  connect: () => Promise<void>;
  dataApiUrl: string;
}) {
  const [overview, setOverview] = useState<DaoOverview>();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [tab, setTab] = useState<Tab>(proposalId ? "governance" : "overview");
  const [status, setStatus] = useState("Loading authoritative DAO state…");
  const [recipient, setRecipient] = useState("");
  const [delegateTo, setDelegateTo] = useState("");
  const [proposalTarget, setProposalTarget] = useState(
    deployment.contracts.timelock,
  );
  const [proposalValue, setProposalValue] = useState("0");
  const [proposalCalldata, setProposalCalldata] = useState<Hex>("0x");
  const [proposalDescription, setProposalDescription] = useState(
    "# Contributor grant\n\nDescribe the grant, recipient, milestones, and rationale.",
  );

  const refresh = useCallback(async () => {
    const suffix = account ? "?account=" + account : "";
    const [
      overviewResponse,
      proposalsResponse,
      membersResponse,
      activityResponse,
    ] = await Promise.all([
      fetch(dataApiUrl + "/dao" + suffix, { cache: "no-store" }),
      fetch(dataApiUrl + "/dao/proposals" + suffix, { cache: "no-store" }),
      fetch(dataApiUrl + "/dao/members", { cache: "no-store" }),
      fetch(dataApiUrl + "/dao/activity", { cache: "no-store" }),
    ]);
    if (
      ![
        overviewResponse,
        proposalsResponse,
        membersResponse,
        activityResponse,
      ].every((response) => response.ok)
    ) {
      throw new Error("DAO index is unavailable");
    }
    setOverview(
      ((await overviewResponse.json()) as { data: DaoOverview }).data,
    );
    setProposals(
      ((await proposalsResponse.json()) as { data: Proposal[] }).data,
    );
    setMembers(((await membersResponse.json()) as { data: Member[] }).data);
    setActivity(((await activityResponse.json()) as { data: Activity[] }).data);
    setStatus("Live contract state reconciled.");
  }, [account, dataApiUrl]);

  useEffect(() => {
    void refresh().catch((error: unknown) =>
      setStatus(error instanceof Error ? error.message : "DAO unavailable"),
    );
  }, [refresh]);

  const selectedProposal = useMemo(
    () =>
      proposalId
        ? proposals.find((proposal) => proposal.id === proposalId)
        : undefined,
    [proposalId, proposals],
  );

  const transact = useCallback(
    async (
      address: Address,
      abi: typeof daoTokenAbi | typeof feeRouterAbi | typeof governorAbi,
      functionName: string,
      args: readonly unknown[] = [],
    ) => {
      if (!account || !walletClient) {
        await connect();
        return;
      }
      try {
        setStatus("Simulating transaction…");
        const data = encodeFunctionData({
          abi: abi as Abi,
          functionName,
          args,
        });
        await rpcClient.call({
          account,
          to: address,
          data,
        });
        setStatus("Waiting for wallet confirmation…");
        const hash = await walletClient.sendTransaction({
          account: walletClient.account ?? account,
          chain: walletClient.chain,
          to: address,
          data,
        });
        setStatus("Transaction submitted. Waiting for confirmation…");
        await rpcClient.waitForTransactionReceipt({ hash });
        setStatus("Confirmed. Refreshing DAO state…");
        await refresh();
      } catch (error) {
        const detail =
          error && typeof error === "object" && "shortMessage" in error
            ? String(error.shortMessage)
            : error instanceof Error
              ? error.message.split("\n")[0]
              : "Unknown contract error";
        setStatus("Transaction failed: " + detail);
      }
    },
    [account, connect, refresh, rpcClient, walletClient],
  );

  const vote = (proposal: Proposal, support: number) =>
    transact(deployment.contracts.governor, governorAbi, "castVote", [
      BigInt(proposal.id),
      support,
    ]);
  const queueOrExecute = (proposal: Proposal, action: "queue" | "execute") =>
    transact(deployment.contracts.governor, governorAbi, action, [
      proposal.targets,
      proposal.values.map(BigInt),
      proposal.calldatas,
      keccak256(toBytes(proposal.description)),
    ]);

  if (!overview)
    return (
      <section className="dao-loading panel" aria-live="polite">
        <p>{status}</p>
      </section>
    );
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "rewards", label: "Rewards" },
    { id: "governance", label: "Governance" },
    { id: "treasury", label: "Treasury" },
    { id: "members", label: "Members" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <section className="dao-console">
      <div className="dao-status-row">
        <span
          className={
            overview.conversionPaused
              ? "status-chip warning"
              : "status-chip success"
          }
        >
          {overview.conversionPaused
            ? "Conversions paused"
            : "Conversions healthy"}
        </span>
        <span className="muted">{status}</span>
        {!account && (
          <button className="button primary" onClick={() => void connect()}>
            Connect wallet
          </button>
        )}
      </div>
      <div className="dao-tabs" role="tablist" aria-label="DAO views">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "dao-tab active" : "dao-tab"}
            onClick={() => setTab(item.id)}
            role="tab"
            aria-selected={tab === item.id}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <div className="dao-metrics">
            <article className="metric-card">
              <span>Your RDAO</span>
              <strong>
                {tokenAmount(overview.account?.balance ?? "0")} RDAO
              </strong>
              <small>Transferable reward membership</small>
            </article>
            <article className="metric-card">
              <span>Voting power</span>
              <strong>
                {tokenAmount(overview.account?.votingPower ?? "0")} RDAO
              </strong>
              <small>
                {overview.account?.delegate === account
                  ? "Self-delegated"
                  : "Delegation required"}
              </small>
            </article>
            <article className="metric-card">
              <span>Claimable ETH</span>
              <strong>
                {tokenAmount(overview.account?.claimableRewards ?? "0", 6)} ETH
              </strong>
              <small>RDAO member rewards</small>
            </article>
            <article className="metric-card">
              <span>Treasury</span>
              <strong>{tokenAmount(overview.treasuryBalance, 4)} ETH</strong>
              <small>Timelock-controlled</small>
            </article>
          </div>
          <div className="dao-grid two-column">
            <article className="panel dao-fee-flow">
              <p className="eyebrow">Immutable launch economics</p>
              <h2>Every fee follows the same four-way route.</h2>
              <div
                className="fee-split-bar"
                aria-label="50 percent basket, 25 percent creator, 20 percent DAO rewards, 5 percent treasury"
              >
                <span style={{ width: "50%" }} />
                <span style={{ width: "25%" }} />
                <span style={{ width: "20%" }} />
                <span style={{ width: "5%" }} />
              </div>
              <ul className="fee-legend">
                <li>
                  <b>{percentage(overview.feePolicy.basketBps)}</b> holder
                  basket
                </li>
                <li>
                  <b>{percentage(overview.feePolicy.creatorBps)}</b> creator ETH
                </li>
                <li>
                  <b>{percentage(overview.feePolicy.daoRewardsBps)}</b> RDAO ETH
                </li>
                <li>
                  <b>{percentage(overview.feePolicy.treasuryBps)}</b> treasury
                </li>
              </ul>
            </article>
            <article className="panel">
              <p className="eyebrow">Governance guardrails</p>
              <h2>Members govern what comes next.</h2>
              <p className="muted">
                Existing baskets, creator identity, fee shares, locked LP
                principal, accrued rewards, and completed votes cannot be
                rewritten.
              </p>
              <dl className="dao-definition-list">
                <div>
                  <dt>Proposal threshold</dt>
                  <dd>
                    {tokenAmount(overview.governance.proposalThreshold)} RDAO
                  </dd>
                </div>
                <div>
                  <dt>Current quorum</dt>
                  <dd>{tokenAmount(overview.governance.currentQuorum)} RDAO</dd>
                </div>
                <div>
                  <dt>Voting period</dt>
                  <dd>3 days</dd>
                </div>
                <div>
                  <dt>Execution delay</dt>
                  <dd>2 days</dd>
                </div>
              </dl>
            </article>
          </div>
        </>
      )}

      {tab === "rewards" && (
        <div className="dao-grid two-column">
          <article className="panel">
            <p className="eyebrow">Member rewards</p>
            <h2>
              {tokenAmount(overview.account?.claimableRewards ?? "0", 6)} ETH
              claimable
            </h2>
            <p>
              Rewards already accrued remain yours after transferring RDAO.
              Future deposits follow the new holder.
            </p>
            <div className="action-row">
              <button
                className="button primary"
                onClick={() =>
                  void transact(
                    overview.contracts.daoToken,
                    daoTokenAbi,
                    "claimRewards",
                  )
                }
              >
                Claim RDAO rewards
              </button>
            </div>
          </article>
          <article className="panel">
            <p className="eyebrow">Creator rewards</p>
            <h2>
              {tokenAmount(overview.account?.claimableCreatorFees ?? "0", 6)}{" "}
              ETH claimable
            </h2>
            <p>
              Creator payments use pull accounting and never block token trading
              or fee harvesting.
            </p>
            <button
              className="button primary"
              onClick={() =>
                void transact(
                  overview.contracts.protocolFeeRouter,
                  feeRouterAbi,
                  "claimCreatorFees",
                )
              }
            >
              Claim creator fees
            </button>
          </article>
          <article className="panel dao-wide">
            <label className="field">
              <span>Optional claim recipient</span>
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="0x…"
              />
            </label>
            <div className="action-row">
              <button
                className="button"
                disabled={!isAddress(recipient)}
                onClick={() =>
                  void transact(
                    overview.contracts.daoToken,
                    daoTokenAbi,
                    "claimRewardsTo",
                    [recipient],
                  )
                }
              >
                Send member claim
              </button>
              <button
                className="button"
                disabled={!isAddress(recipient)}
                onClick={() =>
                  void transact(
                    overview.contracts.protocolFeeRouter,
                    feeRouterAbi,
                    "claimCreatorFeesTo",
                    [recipient],
                  )
                }
              >
                Send creator claim
              </button>
            </div>
          </article>
        </div>
      )}

      {tab === "governance" && (
        <div className="dao-governance-layout">
          <div className="dao-proposal-list">
            <article className="panel">
              <p className="eyebrow">Delegation</p>
              <h2>Activate voting power</h2>
              <label className="field">
                <span>Delegate wallet</span>
                <input
                  value={delegateTo}
                  onChange={(event) => setDelegateTo(event.target.value)}
                  placeholder={account ?? "0x…"}
                />
              </label>
              <div className="action-row">
                <button
                  className="button primary"
                  disabled={!account}
                  onClick={() =>
                    void transact(
                      overview.contracts.daoToken,
                      daoTokenAbi,
                      "delegate",
                      [account],
                    )
                  }
                >
                  Delegate to myself
                </button>
                <button
                  className="button"
                  disabled={!isAddress(delegateTo)}
                  onClick={() =>
                    void transact(
                      overview.contracts.daoToken,
                      daoTokenAbi,
                      "delegate",
                      [delegateTo],
                    )
                  }
                >
                  Delegate
                </button>
              </div>
            </article>
            {proposals.map((proposal) => (
              <article
                className={
                  selectedProposal?.id === proposal.id
                    ? "panel proposal-card selected"
                    : "panel proposal-card"
                }
                key={proposal.id}
              >
                <div className="proposal-heading">
                  <span className="status-chip">{proposal.state}</span>
                  <small>#{proposal.id}</small>
                </div>
                <h2>{proposal.title}</h2>
                <p>
                  {proposal.description
                    .split("\n")
                    .slice(1)
                    .join(" ")
                    .slice(0, 220)}
                </p>
                <div className="vote-bars">
                  <span
                    style={{
                      width:
                        Math.max(
                          2,
                          (Number(proposal.forVotes) /
                            Math.max(
                              1,
                              Number(proposal.forVotes) +
                                Number(proposal.againstVotes) +
                                Number(proposal.abstainVotes),
                            )) *
                            100,
                        ) + "%",
                    }}
                  />
                </div>
                <div className="proposal-totals">
                  <span>For {tokenAmount(proposal.forVotes)}</span>
                  <span>Against {tokenAmount(proposal.againstVotes)}</span>
                  <span>Abstain {tokenAmount(proposal.abstainVotes)}</span>
                </div>
                <div className="action-row">
                  <button
                    className="button primary"
                    disabled={proposal.state !== "Active" || proposal.hasVoted}
                    onClick={() => void vote(proposal, 1)}
                  >
                    Vote for
                  </button>
                  <button
                    className="button"
                    disabled={proposal.state !== "Active" || proposal.hasVoted}
                    onClick={() => void vote(proposal, 0)}
                  >
                    Against
                  </button>
                  <button
                    className="button"
                    disabled={proposal.state !== "Active" || proposal.hasVoted}
                    onClick={() => void vote(proposal, 2)}
                  >
                    Abstain
                  </button>
                  {proposal.state === "Succeeded" && (
                    <button
                      className="button"
                      onClick={() => void queueOrExecute(proposal, "queue")}
                    >
                      Queue
                    </button>
                  )}
                  {proposal.state === "Queued" && (
                    <button
                      className="button"
                      onClick={() => void queueOrExecute(proposal, "execute")}
                    >
                      Execute
                    </button>
                  )}
                </div>
              </article>
            ))}
            {proposals.length === 0 && (
              <article className="empty-state">
                <h2>No proposals yet</h2>
                <p>Eligible delegates can create the first onchain proposal.</p>
              </article>
            )}
          </div>
          <aside className="panel proposal-builder">
            <p className="eyebrow">Proposal builder</p>
            <h2>Propose an onchain action</h2>
            <label className="field">
              <span>Template</span>
              <select
                onChange={(event) => {
                  const template = event.target.value;
                  if (template === "treasury")
                    setProposalDescription(
                      "# Treasury transfer\n\nDescribe recipient, amount, and purpose.",
                    );
                  if (template === "grant")
                    setProposalDescription(
                      "# Contributor grant\n\nDescribe recipient, milestones, and vesting.",
                    );
                  if (template === "factory")
                    setProposalDescription(
                      "# Future factory activation\n\nDocument version, audit evidence, and fee policy.",
                    );
                }}
              >
                <option value="grant">Contributor grant</option>
                <option value="treasury">Treasury transfer</option>
                <option value="factory">Future factory activation</option>
                <option value="advanced">Advanced calldata</option>
              </select>
            </label>
            <label className="field">
              <span>Target contract</span>
              <input
                value={proposalTarget}
                onChange={(event) =>
                  setProposalTarget(event.target.value as Address)
                }
              />
            </label>
            <label className="field">
              <span>Native value (ETH)</span>
              <input
                value={proposalValue}
                onChange={(event) => setProposalValue(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Calldata</span>
              <textarea
                value={proposalCalldata}
                onChange={(event) =>
                  setProposalCalldata(event.target.value as Hex)
                }
                rows={3}
              />
            </label>
            <label className="field">
              <span>Public proposal text</span>
              <textarea
                value={proposalDescription}
                onChange={(event) => setProposalDescription(event.target.value)}
                rows={7}
              />
            </label>
            <p className="muted small">
              Advanced calldata can execute arbitrary timelock actions. Simulate
              and independently verify every target and byte before voting.
            </p>
            <button
              className="button primary"
              disabled={
                !isAddress(proposalTarget) || !proposalCalldata.startsWith("0x")
              }
              onClick={() =>
                void transact(
                  overview.contracts.governor,
                  governorAbi,
                  "propose",
                  [
                    [proposalTarget],
                    [parseEther(proposalValue || "0")],
                    [proposalCalldata],
                    proposalDescription,
                  ],
                )
              }
            >
              Create proposal
            </button>
          </aside>
        </div>
      )}

      {tab === "treasury" && (
        <div className="dao-grid three-column">
          <article className="metric-card">
            <span>Timelock ETH</span>
            <strong>{tokenAmount(overview.treasuryBalance, 6)} ETH</strong>
          </article>
          <article className="metric-card">
            <span>Protocol treasury revenue</span>
            <strong>{tokenAmount(overview.totalTreasuryNative, 6)} ETH</strong>
          </article>
          <article className="metric-card">
            <span>Creator liabilities</span>
            <strong>
              {tokenAmount(overview.pendingCreatorLiability, 6)} ETH
            </strong>
          </article>
          <article className="panel dao-wide">
            <h2>Controlled by executed votes</h2>
            <p>
              Treasury assets can only move through the Governor and two-day
              timelock. The guardian can pause conversions and cancel malicious
              queued proposals, but cannot withdraw funds.
            </p>
            <p className="address-line">
              Timelock <code>{overview.contracts.timelock}</code>
            </p>
            <p className="address-line">
              Guardian <code>{overview.contracts.guardian}</code>
            </p>
          </article>
          <article className="panel dao-wide table-panel">
            <p className="eyebrow">Fee flow by source token</p>
            <h2>Queued and realized protocol fees</h2>
            <div className="dao-table">
              <div className="dao-table-row header">
                <span>Token</span>
                <span>Base fees</span>
                <span>Pending conversion</span>
                <span>Native realized</span>
              </div>
              {overview.launchFees.map((fees) => (
                <div className="dao-table-row" key={fees.token}>
                  <code title={fees.token}>{short(fees.token)}</code>
                  <span>{tokenAmount(fees.cumulativeBaseFees, 5)}</span>
                  <span>
                    {tokenAmount(
                      (
                        BigInt(fees.pendingCreatorBase) +
                        BigInt(fees.pendingDaoRewardBase) +
                        BigInt(fees.pendingTreasuryBase)
                      ).toString(),
                      5,
                    )}
                  </span>
                  <span>
                    {tokenAmount(fees.cumulativeNativeConverted, 5)} ETH
                  </span>
                </div>
              ))}
            </div>
          </article>
        </div>
      )}

      {tab === "members" && (
        <div className="panel table-panel">
          <div className="table-heading">
            <div>
              <p className="eyebrow">Onchain directory</p>
              <h2>{members.length} RDAO holders</h2>
            </div>
          </div>
          <div className="dao-table" role="table">
            <div className="dao-table-row header" role="row">
              <span>Wallet</span>
              <span>Balance</span>
              <span>Voting power</span>
              <span>Delegate</span>
            </div>
            {members.map((member) => (
              <div className="dao-table-row" role="row" key={member.address}>
                <code title={member.address}>{short(member.address)}</code>
                <span>{tokenAmount(member.balance)} RDAO</span>
                <span>{tokenAmount(member.votingPower)}</span>
                <code title={member.delegate}>{short(member.delegate)}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "activity" && (
        <div className="panel table-panel">
          <p className="eyebrow">Contract activity</p>
          <h2>Recent authoritative events</h2>
          <div className="activity-list">
            {activity.map((item, index) => (
              <div className="activity-item" key={item.transactionHash + index}>
                <span className="status-dot" />
                <div>
                  <strong>{short(item.address)}</strong>
                  <small>
                    Block {item.blockNumber ?? "pending"} ·{" "}
                    {short(item.transactionHash)}
                  </small>
                </div>
                <code>{item.topic ? short(item.topic) : "event"}</code>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  encodeFunctionData,
  formatEther,
  parseAbi,
  parseEther,
  type Abi,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import type { Deployment } from "@/lib/deployment";
import { DaoView } from "./dao-view";

const saleAbi = parseAbi([
  "function quoteBuy(uint256) view returns (uint256 tokensOut,uint256 principal,uint256 fee,uint256 refund)",
  "function quoteSell(uint256) view returns (uint256 principalOut,uint256 fee,uint256 nativeOut)",
  "function buy(uint256 minimumTokensOut,uint256 deadline,address recipient) payable returns (uint256)",
  "function sell(uint256 tokensIn,uint256 minimumNativeOut,uint256 deadline,address recipient) returns (uint256)",
]);
const tokenAbi = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const stakingAbi = parseAbi([
  "function stake(uint256 amount,address delegatee)",
  "function activateFor(address) returns (uint256)",
  "function unstake(uint256 amount,address recipient)",
  "function setDelegate(address)",
  "function claim() returns (uint256)",
  "function claimFor(address) returns (uint256)",
]);
const wethAbi = parseAbi(["function withdraw(uint256 amount)"]);

type RdaoState = {
  contracts: {
    token: Address;
    sale: Address;
    staking: Address;
    liquidityLocker: Address;
    governor: Address;
    timelock: Address;
    wrappedNative?: Address;
  };
  policy: Deployment["rdao"] | null;
  totalSupply: string;
  sale: Record<string, string | boolean>;
  staking: Record<string, string | boolean | string[]>;
  liquidity: Record<string, string | boolean>;
  account: null | {
    address: Address;
    liquidBalance: string;
    liquidDelegate: Address;
    votingPower: string;
    escrow: Address;
    eligibleStake: string;
    warmingStake: string;
    activationTime: string;
    stakeDelegate: Address;
    claimableWeth: string;
    wethBalance: string;
  };
};

type Tab = "sale" | "stake" | "rewards" | "governance";

function amount(value: string | boolean | string[] | undefined, digits = 3) {
  if (typeof value !== "string") return "0";
  return Number(formatEther(BigInt(value))).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function pct(numerator: string | boolean | string[] | undefined, denominator: string | boolean | string[] | undefined) {
  if (typeof numerator !== "string" || typeof denominator !== "string" || BigInt(denominator) === 0n) return 0;
  return Number((BigInt(numerator) * 10_000n) / BigInt(denominator)) / 100;
}

export function RdaoWorkspace({
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
  const [state, setState] = useState<RdaoState>();
  const [tab, setTab] = useState<Tab>(proposalId ? "governance" : "sale");
  const [status, setStatus] = useState("Loading live Schema-20 state…");
  const [buyEth, setBuyEth] = useState("0.1");
  const [sellRdao, setSellRdao] = useState("1000");
  const [stakeRdao, setStakeRdao] = useState("1000");
  const [unstakeRdao, setUnstakeRdao] = useState("1000");
  const [delegate, setDelegate] = useState(account ?? "");

  useEffect(() => setDelegate((current) => current || account || ""), [account]);

  const refresh = useCallback(async () => {
    const suffix = account ? `?account=${account}` : "";
    const response = await fetch(`${dataApiUrl}/rdao${suffix}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Schema-20 RDAO state is unavailable");
    setState(((await response.json()) as { data: RdaoState }).data);
    setStatus("Live contract state reconciled.");
  }, [account, dataApiUrl]);

  useEffect(() => {
    void refresh().catch((error: unknown) =>
      setStatus(error instanceof Error ? error.message : "RDAO unavailable"),
    );
  }, [refresh]);

  const transact = useCallback(async (
    to: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[] = [],
    value?: bigint,
  ) => {
    if (!account || !walletClient) {
      await connect();
      return;
    }
    try {
      const data = encodeFunctionData({ abi, functionName, args });
      setStatus("Simulating transaction…");
      await rpcClient.call({ account, to, data, value });
      setStatus("Waiting for wallet confirmation…");
      const hash = await walletClient.sendTransaction({
        account: walletClient.account ?? account,
        chain: walletClient.chain,
        to,
        data,
        value,
      });
      setStatus("Submitted. Waiting for confirmation…");
      await rpcClient.waitForTransactionReceipt({ hash });
      await refresh();
      setStatus("Confirmed and reconciled.");
    } catch (error) {
      const detail = error && typeof error === "object" && "shortMessage" in error
        ? String(error.shortMessage)
        : error instanceof Error ? error.message.split("\n")[0] : "Unknown transaction error";
      setStatus(`Transaction failed: ${detail}`);
    }
  }, [account, connect, refresh, rpcClient, walletClient]);

  const approveIfNeeded = useCallback(async (spender: Address, required: bigint) => {
    if (!state || !account || !walletClient) return false;
    const allowance = await rpcClient.readContract({
      address: state.contracts.token,
      abi: tokenAbi,
      functionName: "allowance",
      args: [account, spender],
    });
    if (allowance >= required) return true;
    await transact(state.contracts.token, tokenAbi, "approve", [spender, required]);
    return false;
  }, [account, rpcClient, state, transact, walletClient]);

  const buy = useCallback(async () => {
    if (!state || !account) return void connect();
    const value = parseEther(buyEth);
    const quote = await rpcClient.readContract({
      address: state.contracts.sale, abi: saleAbi, functionName: "quoteBuy", args: [value],
    });
    const minimum = quote[0] * 99n / 100n;
    await transact(state.contracts.sale, saleAbi, "buy", [
      minimum, BigInt(Math.floor(Date.now() / 1000) + 120), account,
    ], value);
  }, [account, buyEth, connect, rpcClient, state, transact]);

  const sell = useCallback(async () => {
    if (!state || !account) return void connect();
    const tokens = parseEther(sellRdao);
    if (!(await approveIfNeeded(state.contracts.sale, tokens))) return;
    const quote = await rpcClient.readContract({
      address: state.contracts.sale, abi: saleAbi, functionName: "quoteSell", args: [tokens],
    });
    await transact(state.contracts.sale, saleAbi, "sell", [
      tokens, quote[2] * 99n / 100n, BigInt(Math.floor(Date.now() / 1000) + 120), account,
    ]);
  }, [account, approveIfNeeded, connect, rpcClient, sellRdao, state, transact]);

  const stake = useCallback(async () => {
    if (!state || !account) return void connect();
    const value = parseEther(stakeRdao);
    if (!(await approveIfNeeded(state.contracts.staking, value))) return;
    await transact(state.contracts.staking, stakingAbi, "stake", [value, (delegate || account) as Address]);
  }, [account, approveIfNeeded, connect, delegate, stakeRdao, state, transact]);

  const progress = useMemo(() => state ? pct(state.sale.sold, state.sale.saleInventory) : 0, [state]);
  if (!state) return <section className="dao-loading panel"><p>{status}</p></section>;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "sale", label: "Sale" },
    { id: "stake", label: "Stake" },
    { id: "rewards", label: "Rewards" },
    { id: "governance", label: "Governance" },
  ];
  const activation = Number(state.account?.activationTime ?? "0");
  const warmupReady = activation > 0 && activation <= Math.floor(Date.now() / 1000);

  return <section className="dao-console rdao-workspace">
    <div className="dao-status-row">
      <span className="status-chip success">Schema-20 Devnet only</span>
      <span className="muted">{status}</span>
      {!account && <button className="button primary" onClick={() => void connect()}>Connect wallet</button>}
    </div>
    <div className="dao-tabs" role="tablist" aria-label="RDAO workspace">
      {tabs.map((item) => <button key={item.id} className={tab === item.id ? "dao-tab active" : "dao-tab"}
        onClick={() => setTab(item.id)} role="tab" aria-selected={tab === item.id}>{item.label}</button>)}
    </div>

    {tab === "sale" && <>
      <div className="dao-metrics">
        <article className="metric-card"><span>Public allocation</span><strong>150m RDAO</strong><small>{progress.toFixed(2)}% sold</small></article>
        <article className="metric-card"><span>Current price</span><strong>{amount(state.sale.currentPriceE18, 9)} ETH</strong><small>Constant-product curve</small></article>
        <article className="metric-card"><span>Owner proceeds</span><strong>$300,000</strong><small>{amount(state.sale.deployerPayout, 3)} ETH frozen fixture</small></article>
        <article className="metric-card"><span>Locked liquidity</span><strong>$240,000</strong><small>50m RDAO + {amount(state.sale.liquidityNative, 3)} ETH</small></article>
      </div>
      <article className="panel rdao-sale-card">
        <div className="rdao-progress"><span style={{ width: `${Math.min(progress, 100)}%` }} /></div>
        <div className="dao-grid two-column">
          <div><p className="eyebrow">Buy from the curve</p><label className="field"><span>ETH amount</span><input value={buyEth} onChange={(event) => setBuyEth(event.target.value)} /></label><button className="button primary" disabled={state.sale.buysPaused === true || state.sale.finalized === true} onClick={() => void buy()}>Buy RDAO</button></div>
          <div><p className="eyebrow">Sell while bonding</p><label className="field"><span>RDAO amount</span><input value={sellRdao} onChange={(event) => setSellRdao(event.target.value)} /></label><button className="button" disabled={state.sale.finalized === true} onClick={() => void sell()}>Sell RDAO</button></div>
        </div>
        <p className="muted">1% bonding fee goes only to eligible stakers. Finalization atomically locks the full-range 1% RDAO/WETH position. No wallet or transaction cap.</p>
      </article>
    </>}

    {tab === "stake" && <>
      <div className="dao-metrics">
        <article className="metric-card"><span>Your liquid RDAO</span><strong>{amount(state.account?.liquidBalance)}</strong><small>Transferable</small></article>
        <article className="metric-card"><span>Eligible stake</span><strong>{amount(state.account?.eligibleStake)}</strong><small>Earning WETH</small></article>
        <article className="metric-card"><span>Warming stake</span><strong>{amount(state.account?.warmingStake)}</strong><small>{activation ? new Date(activation * 1000).toLocaleString() : "No pending warm-up"}</small></article>
        <article className="metric-card"><span>Voting power</span><strong>{amount(state.account?.votingPower)}</strong><small>Liquid plus delegated escrow votes</small></article>
      </div>
      <div className="dao-grid two-column">
        <article className="panel"><p className="eyebrow">Stake without a cap</p><label className="field"><span>RDAO amount</span><input value={stakeRdao} onChange={(event) => setStakeRdao(event.target.value)} /></label><label className="field"><span>Vote delegate</span><input value={delegate} onChange={(event) => setDelegate(event.target.value)} /></label><button className="button primary" disabled={state.staking.paused === true} onClick={() => void stake()}>Stake RDAO</button>{warmupReady && <button className="button" onClick={() => void transact(state.contracts.staking, stakingAbi, "activateFor", [account])}>Activate matured stake</button>}<p className="muted">Every deposit warms independently for 24 hours. There is no address cap, lock bonus, slashing, or automatic compounding.</p></article>
        <article className="panel"><p className="eyebrow">Exit or delegate</p><label className="field"><span>RDAO to unstake</span><input value={unstakeRdao} onChange={(event) => setUnstakeRdao(event.target.value)} /></label><button className="button" onClick={() => account && void transact(state.contracts.staking, stakingAbi, "unstake", [parseEther(unstakeRdao), account])}>Unstake immediately</button><button className="button" onClick={() => void transact(state.contracts.staking, stakingAbi, "setDelegate", [delegate])}>Update delegate</button><p className="muted">Unstaking checkpoints rewards first. Founder transfers must unstake, transfer, and restake under the recipient&apos;s own warm-up.</p></article>
      </div>
    </>}

    {tab === "rewards" && <>
      <div className="dao-metrics">
        <article className="metric-card"><span>Claimable</span><strong>{amount(state.account?.claimableWeth, 8)} WETH</strong><small>Pull-based</small></article>
        <article className="metric-card"><span>Total deposited</span><strong>{amount(state.staking.totalRewardsDeposited, 6)} WETH</strong><small>Bonding + protocol + LP fees</small></article>
        <article className="metric-card"><span>Queued</span><strong>{amount(state.staking.queuedRewards, 6)} WETH</strong><small>Seven-day release after zero stake</small></article>
        <article className="metric-card"><span>Eligible supply</span><strong>{amount(state.staking.totalEligibleStake)}</strong><small>No APY projection</small></article>
      </div>
        <article className="panel"><p className="eyebrow">Staking-only distributions</p><h2>Claim vested WETH when you choose.</h2><p>Rewards combine the protocol&apos;s immutable 20% DAO share, 1% RDAO bonding fees, and harvestable fees from the permanently locked RDAO/WETH position. Returns vary with actual usage.</p><div className="action-row"><button className="button primary" onClick={() => void transact(state.contracts.staking, stakingAbi, "claim")}>Claim WETH</button>{state.contracts.wrappedNative && <button className="button" disabled={BigInt(state.account?.wethBalance ?? "0") === 0n} onClick={() => void transact(state.contracts.wrappedNative as Address, wethAbi, "withdraw", [BigInt(state.account?.wethBalance ?? "0")])}>Unwrap wallet WETH</button>}</div><p className="muted">Wallet WETH available to unwrap: {amount(state.account?.wethBalance, 8)} WETH</p></article>
    </>}

    {tab === "governance" && <DaoView deployment={deployment} proposalId={proposalId} account={account} rpcClient={rpcClient} walletClient={walletClient} connect={connect} dataApiUrl={dataApiUrl} />}
  </section>;
}

"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { Address, PublicClient } from "viem";
import { hasDaoMembership } from "@/lib/dao-access-policy";

const daoTokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type DaoAccessStatus =
  "disconnected" | "checking" | "member" | "nonmember" | "unavailable";

export function useDaoAccess({
  account,
  daoToken,
  publicClient,
}: {
  account?: Address;
  daoToken: Address;
  publicClient: PublicClient;
}) {
  const [status, setStatus] = useState<DaoAccessStatus>(
    account ? "checking" : "disconnected",
  );

  useEffect(() => {
    let cancelled = false;
    if (!account) {
      setStatus("disconnected");
      return () => {
        cancelled = true;
      };
    }

    setStatus("checking");
    void publicClient
      .readContract({
        address: daoToken,
        abi: daoTokenAbi,
        functionName: "balanceOf",
        args: [account],
      })
      .then((balance) => {
        if (!cancelled) {
          setStatus(hasDaoMembership(balance) ? "member" : "nonmember");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [account, daoToken, publicClient]);

  return status;
}

export function DaoNavigation({ status }: { status: DaoAccessStatus }) {
  if (status !== "member") return null;
  return <Link href="/dao">DAO</Link>;
}

export function DaoAccessGate({
  status,
  connect,
  children,
}: {
  status: DaoAccessStatus;
  connect: () => void | Promise<void>;
  children: ReactNode;
}) {
  if (status === "member") return children;

  const content = {
    disconnected: {
      eyebrow: "Wallet-gated governance",
      title: "Connect a DAO-member wallet to enter.",
      body: "DAO governance and member rewards are available only to connected wallets that hold the governance token.",
    },
    checking: {
      eyebrow: "Checking membership",
      title: "Verifying your governance-token balance…",
      body: "Sherwood Forest is reading the connected wallet's balance from the configured network.",
    },
    nonmember: {
      eyebrow: "DAO membership required",
      title: "This wallet does not hold the governance token.",
      body: "DAO navigation and member controls stay hidden until the connected wallet owns at least one governance token.",
    },
    unavailable: {
      eyebrow: "Membership unavailable",
      title: "DAO membership could not be verified.",
      body: "DAO access fails closed when the chain balance cannot be confirmed. Please retry after the RPC recovers.",
    },
    member: { eyebrow: "", title: "", body: "" },
  }[status];

  return (
    <section className="page-shell dao-page dao-access-gate" aria-live="polite">
      <div className="empty-state">
        <p className="eyebrow">{content.eyebrow}</p>
        <h1>{content.title}</h1>
        <p>{content.body}</p>
        <div className="hero-actions">
          {status === "disconnected" ? (
            <button className="button primary" type="button" onClick={connect}>
              Connect wallet
            </button>
          ) : null}
          {status === "nonmember" ? (
            <Link className="button secondary" href="/discover">
              Browse markets
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

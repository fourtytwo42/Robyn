"use client";

import { DaoView } from "./dao-view";
import type { Deployment } from "@/lib/deployment";
import { useRobynTestnetWallet } from "./robyn-testnet-wallet";

export function NetworkDaoView({
  deployment,
  proposalId,
}: {
  deployment: Deployment;
  proposalId?: string;
}) {
  const { account, publicClient, walletClient, connect } =
    useRobynTestnetWallet();
  const dataApiUrl =
    process.env.NEXT_PUBLIC_DATA_API_URL ??
    "http://" +
      (typeof window === "undefined" ? "127.0.0.1" : window.location.hostname) +
      ":3111";
  return (
    <DaoView
      deployment={deployment}
      proposalId={proposalId}
      account={account}
      rpcClient={publicClient!}
      walletClient={walletClient}
      connect={connect}
      dataApiUrl={dataApiUrl}
    />
  );
}

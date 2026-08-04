"use client";

import { DaoView } from "./dao-view";
import type { Deployment } from "@/lib/deployment";
import { resolveDataApiUrl } from "@/lib/data-api-url";
import { useRobynTestnetWallet } from "./robyn-testnet-wallet";

export function NetworkDaoView({
  deployment,
  proposalId,
}: {
  deployment: Deployment;
  proposalId?: string;
  surface?: "workspace" | "market";
}) {
  const { account, publicClient, walletClient, connect } =
    useRobynTestnetWallet();
  const dataApiUrl = resolveDataApiUrl(process.env.NEXT_PUBLIC_DATA_API_URL);
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

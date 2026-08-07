"use client";

import { DaoView } from "./dao-view";
import { RdaoTokenMarket } from "./rdao-token-market";
import { RdaoWorkspace } from "./rdao-workspace";
import type { Deployment } from "@/lib/deployment";
import { resolveDataApiUrl } from "@/lib/data-api-url";
import { useRobynTestnetWallet } from "./robyn-testnet-wallet";

export function NetworkDaoView({
  deployment,
  proposalId,
  surface = "workspace",
}: {
  deployment: Deployment;
  proposalId?: string;
  surface?: "workspace" | "market";
}) {
  const { account, publicClient, walletClient, connect } =
    useRobynTestnetWallet();
  const dataApiUrl = resolveDataApiUrl(process.env.NEXT_PUBLIC_DATA_API_URL);
  if (deployment.schemaVersion === 20 && surface === "market") {
    return (
      <RdaoTokenMarket
        account={account}
        rpcClient={publicClient!}
        walletClient={walletClient}
        connect={connect}
        dataApiUrl={dataApiUrl}
      />
    );
  }
  if (deployment.schemaVersion === 20) {
    return (
      <RdaoWorkspace
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

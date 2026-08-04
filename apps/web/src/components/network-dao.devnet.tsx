"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DaoView } from "./dao-view";
import { RdaoWorkspace } from "./rdao-workspace";
import { RdaoTokenMarket } from "./rdao-token-market";
import type { Deployment } from "@/lib/deployment";

const chain = defineChain({
  id: 31337,
  name: "Robyn Controlled Devnet",
  nativeCurrency: { name: "Dev Ether", symbol: "DEV", decimals: 18 },
  rpcUrls: { default: { http: ["/rpc"] } },
});

export function NetworkDaoView({
  deployment,
  proposalId,
  surface = "workspace",
}: {
  deployment: Deployment;
  proposalId?: string;
  surface?: "workspace" | "market";
}) {
  const [key, setKey] = useState<Hex>();
  const load = useCallback(() => {
    const stored = window.sessionStorage.getItem("robyn-devnet-session-key");
    setKey(stored?.startsWith("0x") ? (stored as Hex) : undefined);
  }, []);
  useEffect(() => {
    load();
    window.addEventListener("robyn-wallet-change", load);
    return () => window.removeEventListener("robyn-wallet-change", load);
  }, [load]);
  const account = useMemo(
    () => (key ? privateKeyToAccount(key) : undefined),
    [key],
  );
  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http("/rpc") }),
    [],
  );
  const walletClient = useMemo(
    () =>
      account
        ? createWalletClient({ account, chain, transport: http("/rpc") })
        : undefined,
    [account],
  );
  const connect = useCallback(async () => {
    window.location.href = "/#devnet-console";
  }, []);
  const dataApiUrl = "/api";
  if (deployment.schemaVersion === 20 && surface === "market") {
    return (
      <RdaoTokenMarket
        account={account?.address as Address | undefined}
        rpcClient={publicClient}
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
        account={account?.address as Address | undefined}
        rpcClient={publicClient}
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
      account={account?.address as Address | undefined}
      rpcClient={publicClient}
      walletClient={walletClient}
      connect={connect}
      dataApiUrl={dataApiUrl}
    />
  );
}

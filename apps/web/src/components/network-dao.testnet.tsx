"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type Address,
  type EIP1193Provider,
} from "viem";
import { DaoView } from "./dao-view";
import type { Deployment } from "@/lib/deployment";

const rpcUrl =
  process.env.NEXT_PUBLIC_ROBYN_RPC_URL ??
  "https://rpc.testnet.chain.robinhood.com";
const chain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  testnet: true,
});

export function NetworkDaoView({
  deployment,
  proposalId,
}: {
  deployment: Deployment;
  proposalId?: string;
}) {
  const [account, setAccount] = useState<Address>();
  const provider =
    typeof window === "undefined"
      ? undefined
      : (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  const refreshAccount = useCallback(async () => {
    if (!provider) return setAccount(undefined);
    const accounts = await provider.request({ method: "eth_accounts" });
    setAccount(
      Array.isArray(accounts) && typeof accounts[0] === "string"
        ? (accounts[0] as Address)
        : undefined,
    );
  }, [provider]);
  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);
  const connect = useCallback(async () => {
    if (!provider) throw new Error("No injected EVM wallet was detected");
    await provider.request({ method: "eth_requestAccounts" });
    await refreshAccount();
  }, [provider, refreshAccount]);
  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http(rpcUrl) }),
    [],
  );
  const walletClient = useMemo(
    () =>
      provider && account
        ? createWalletClient({ account, chain, transport: custom(provider) })
        : undefined,
    [account, provider],
  );
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
      rpcClient={publicClient}
      walletClient={walletClient}
      connect={connect}
      dataApiUrl={dataApiUrl}
    />
  );
}

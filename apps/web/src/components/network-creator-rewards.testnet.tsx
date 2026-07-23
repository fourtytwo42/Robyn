"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type Address,
  type EIP1193Provider,
} from "viem";
import { CreatorRewardsPanel } from "./creator-rewards-panel";

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

export function NetworkCreatorRewardsPanel({
  token,
  creator,
}: {
  token: Address;
  creator: Address;
}) {
  const [provider, setProvider] = useState<EIP1193Provider>();
  const [account, setAccount] = useState<Address>();
  useEffect(() => {
    const next = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    setProvider(next);
    if (!next) return;
    const read = async () => {
      const accounts = await next.request({ method: "eth_accounts" });
      setAccount(
        Array.isArray(accounts) && typeof accounts[0] === "string"
          ? (accounts[0] as Address)
          : undefined,
      );
    };
    void read();
    next.on?.("accountsChanged", read);
    return () => next.removeListener?.("accountsChanged", read);
  }, []);
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
  return (
    <CreatorRewardsPanel
      account={account}
      creator={creator}
      token={token}
      publicClient={publicClient}
      walletClient={walletClient}
    />
  );
}

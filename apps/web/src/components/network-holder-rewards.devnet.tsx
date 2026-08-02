"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HolderRewardsPanel } from "./holder-rewards-panel";

const chain = defineChain({
  id: 31337,
  name: "Robyn Controlled Devnet",
  nativeCurrency: { name: "Dev Ether", symbol: "DEV", decimals: 18 },
  rpcUrls: { default: { http: ["/rpc"] } },
});

export function NetworkHolderRewardsPanel({
  token,
  symbol,
}: {
  token: Address;
  symbol: string;
}) {
  const [key, setKey] = useState<Hex>();
  useEffect(() => {
    const read = () => {
      const stored = window.sessionStorage.getItem("robyn-devnet-session-key");
      setKey(stored?.startsWith("0x") ? (stored as Hex) : undefined);
    };
    read();
    window.addEventListener("robyn-wallet-change", read);
    return () => window.removeEventListener("robyn-wallet-change", read);
  }, []);
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
  return (
    <HolderRewardsPanel
      account={account?.address}
      token={token}
      symbol={symbol}
      publicClient={publicClient}
      walletClient={walletClient}
      connect={() => window.location.assign("/#devnet-console")}
    />
  );
}

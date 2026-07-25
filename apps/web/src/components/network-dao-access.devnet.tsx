"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPublicClient, defineChain, http, type Address } from "viem";
import type { Deployment } from "@/lib/deployment";
import { DaoAccessGate, DaoNavigation, useDaoAccess } from "./dao-access";

const chain = defineChain({
  id: 31337,
  name: "Robyn Controlled Devnet",
  nativeCurrency: { name: "Dev Ether", symbol: "DEV", decimals: 18 },
  rpcUrls: { default: { http: ["/rpc"] } },
});

function useDevnetDaoAccess(deployment: Deployment) {
  const [account, setAccount] = useState<Address>();
  const load = useCallback(() => {
    const stored = window.sessionStorage.getItem(
      "robyn-devnet-session-address",
    );
    setAccount(stored?.startsWith("0x") ? (stored as Address) : undefined);
  }, []);
  useEffect(() => {
    load();
    window.addEventListener("robyn-wallet-change", load);
    return () => window.removeEventListener("robyn-wallet-change", load);
  }, [load]);
  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: http("/rpc") }),
    [],
  );
  return useDaoAccess({
    account,
    daoToken: deployment.contracts.daoToken,
    publicClient,
  });
}

export function NetworkDaoNavigation({
  deployment,
}: {
  deployment: Deployment;
}) {
  return <DaoNavigation status={useDevnetDaoAccess(deployment)} />;
}

export function NetworkDaoAccessGate({
  deployment,
  children,
}: {
  deployment: Deployment;
  children: ReactNode;
}) {
  const status = useDevnetDaoAccess(deployment);
  const connect = useCallback(() => {
    window.location.href = "/#devnet-console";
  }, []);
  return (
    <DaoAccessGate status={status} connect={connect}>
      {children}
    </DaoAccessGate>
  );
}

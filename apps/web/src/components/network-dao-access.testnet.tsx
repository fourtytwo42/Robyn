"use client";

import type { ReactNode } from "react";
import type { Deployment } from "@/lib/deployment";
import { DaoAccessGate, DaoNavigation, useDaoAccess } from "./dao-access";
import { useRobynTestnetWallet } from "./robyn-testnet-wallet";

export function NetworkDaoNavigation({
  deployment,
}: {
  deployment: Deployment;
}) {
  const { account, publicClient } = useRobynTestnetWallet();
  const status = useDaoAccess({
    account,
    daoToken: deployment.contracts.daoToken,
    publicClient,
  });
  return <DaoNavigation status={status} />;
}

export function NetworkDaoAccessGate({
  deployment,
  children,
}: {
  deployment: Deployment;
  children: ReactNode;
}) {
  const { account, publicClient, connect } = useRobynTestnetWallet();
  const status = useDaoAccess({
    account,
    daoToken: deployment.contracts.daoToken,
    publicClient,
  });
  if (deployment.schemaVersion === 20) return children;
  return (
    <DaoAccessGate status={status} connect={connect}>
      {children}
    </DaoAccessGate>
  );
}

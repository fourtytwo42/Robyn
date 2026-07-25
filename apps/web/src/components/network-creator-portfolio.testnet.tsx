"use client";

import { CreatorPortfolio } from "./creator-portfolio";
import { useRobynTestnetWallet } from "./robyn-testnet-wallet";
import type { Address } from "viem";

export function NetworkCreatorPortfolio({
  account: requestedAccount,
  readOnly = false,
}: {
  account?: Address;
  readOnly?: boolean;
} = {}) {
  const { account, publicClient, walletClient } = useRobynTestnetWallet();
  const targetAccount = requestedAccount ?? account;
  const canManage =
    !readOnly &&
    Boolean(account) &&
    account?.toLowerCase() === targetAccount?.toLowerCase();
  return (
    <CreatorPortfolio
      account={targetAccount}
      publicClient={publicClient!}
      walletClient={canManage ? walletClient : undefined}
      readOnly={!canManage}
    />
  );
}

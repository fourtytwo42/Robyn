"use client";

import type { Address } from "viem";
import { CreatorRewardsPanel } from "./creator-rewards-panel";
import { useRobynTestnetWallet } from "./robyn-testnet-wallet";

export function NetworkCreatorRewardsPanel({
  token,
  creator,
}: {
  token: Address;
  creator: Address;
}) {
  const { account, publicClient, walletClient } = useRobynTestnetWallet();
  return (
    <CreatorRewardsPanel
      account={account}
      creator={creator}
      token={token}
      publicClient={publicClient!}
      walletClient={walletClient}
    />
  );
}

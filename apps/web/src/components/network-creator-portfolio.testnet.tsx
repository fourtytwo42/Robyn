"use client";

import { CreatorPortfolio } from "./creator-portfolio";
import { useRobynTestnetWallet } from "./robyn-testnet-wallet";

export function NetworkCreatorPortfolio() {
  const { account, publicClient, walletClient } = useRobynTestnetWallet();
  return (
    <CreatorPortfolio
      account={account}
      publicClient={publicClient!}
      walletClient={walletClient}
    />
  );
}

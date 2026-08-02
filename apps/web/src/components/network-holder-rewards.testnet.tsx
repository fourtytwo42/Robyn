"use client";

import type { Address } from "viem";
import { HolderRewardsPanel } from "./holder-rewards-panel";
import { useRobynTestnetWallet } from "./robyn-testnet-wallet";

export function NetworkHolderRewardsPanel({
  token,
  symbol,
}: {
  token: Address;
  symbol: string;
}) {
  const {
    account,
    publicClient,
    walletClient,
    connect,
    isWrongChain,
    switchToRobinhoodTestnet,
  } = useRobynTestnetWallet();
  return (
    <HolderRewardsPanel
      account={account}
      token={token}
      symbol={symbol}
      publicClient={publicClient!}
      walletClient={walletClient}
      correctChain={!isWrongChain}
      connect={connect}
      switchNetwork={switchToRobinhoodTestnet}
    />
  );
}

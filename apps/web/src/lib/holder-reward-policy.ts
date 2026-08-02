export type HolderRewardAction =
  | "connect"
  | "switch-network"
  | "claim"
  | "claiming"
  | "nothing-to-claim"
  | "wallet-unavailable";

export function holderRewardAction({
  connected,
  correctChain,
  walletReady,
  working,
  claimableAssetCount,
}: {
  connected: boolean;
  correctChain: boolean;
  walletReady: boolean;
  working: boolean;
  claimableAssetCount: number;
}): HolderRewardAction {
  if (!connected) return "connect";
  if (!correctChain) return "switch-network";
  if (working) return "claiming";
  if (!walletReady) return "wallet-unavailable";
  if (claimableAssetCount === 0) return "nothing-to-claim";
  return "claim";
}

export function holderRewardActionLabel(action: HolderRewardAction) {
  switch (action) {
    case "connect":
      return "Connect wallet";
    case "switch-network":
      return "Switch network";
    case "claiming":
      return "Claiming rewards...";
    case "wallet-unavailable":
      return "Wallet unavailable";
    case "nothing-to-claim":
      return "Nothing claimable yet";
    default:
      return "Claim all for this token";
  }
}

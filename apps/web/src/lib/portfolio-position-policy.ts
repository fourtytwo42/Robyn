type WalletPositionState = {
  balance: bigint;
  pendingBase?: bigint;
  rewards: ReadonlyArray<{ claimable: bigint; claimed?: bigint }>;
};

export function isActivePortfolioPosition({
  balance,
  rewards,
}: WalletPositionState) {
  return balance > 0n || rewards.some((reward) => reward.claimable > 0n);
}

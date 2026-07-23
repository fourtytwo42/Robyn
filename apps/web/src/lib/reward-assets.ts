export const rewardAssetCatalog = [
  { symbol: "mNVDA", name: "Mock NVIDIA" },
  { symbol: "mSPY", name: "Mock S&P 500" },
  { symbol: "mETH", name: "Mock Ether" },
] as const;

export type RewardAssetMetadata = {
  symbol: string;
  name: string;
};

export function rewardAssetMetadata(
  address: string,
  canonicalAddresses: readonly string[],
  isTestnet: boolean,
  catalog?: readonly {
    address: string;
    symbol: string;
    mockSymbol?: string;
    name: string;
  }[],
): RewardAssetMetadata {
  const catalogAsset = catalog?.find(
    (candidate) => candidate.address.toLowerCase() === address.toLowerCase(),
  );
  if (catalogAsset)
    return {
      symbol: catalogAsset.mockSymbol ?? catalogAsset.symbol,
      name: catalogAsset.name,
    };
  const index = canonicalAddresses.findIndex(
    (candidate) => candidate.toLowerCase() === address.toLowerCase(),
  );
  const known = rewardAssetCatalog[index];
  if (!known) return { symbol: "Unknown asset", name: "Unverified asset" };
  return {
    symbol: isTestnet ? "t" + known.symbol : known.symbol,
    name: known.name,
  };
}

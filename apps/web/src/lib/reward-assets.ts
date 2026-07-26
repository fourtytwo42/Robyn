export const rewardAssetCatalog = [
  { symbol: "mNVDA", name: "Mock NVIDIA" },
  { symbol: "mSPY", name: "Mock S&P 500" },
  { symbol: "mETH", name: "Mock Ether" },
] as const;

export type RewardAssetMetadata = {
  symbol: string;
  name: string;
  description: string;
  logoUrl: string | null;
  category: string;
  verification: string;
  mockOnly: boolean;
};

export function assetVerificationLabel(verification: string) {
  if (verification === "robinhood-testnet-faucet-stock") {
    return "Faucet stock";
  }
  if (verification === "robyn-testnet-mock") {
    return "Testnet mock";
  }
  if (verification === "official-robinhood-current-chain") {
    return "Verified asset";
  }
  if (verification === "robyn-controlled-testnet-dex") {
    return "Verified route asset";
  }
  if (verification === "robyn-token-list") {
    return "Sherwood listed";
  }
  return "Unverified ERC-20";
}

function assetDescription(asset: {
  symbol: string;
  name: string;
  category: string;
  verification: string;
  mockOnly: boolean;
}) {
  if (asset.verification === "robinhood-testnet-faucet-stock") {
    return `${asset.name} (${asset.symbol}) is a faucet-issued Robinhood Chain Testnet asset. It is for testing only and has no backing or redemption rights.`;
  }
  if (asset.verification === "robyn-testnet-mock" || asset.mockOnly) {
    return `${asset.name} (${asset.symbol}) is a Sherwood Forest testnet mock used to test basket purchases and holder rewards. It has no backing or redemption rights.`;
  }
  if (
    asset.verification === "robyn-controlled-testnet-dex" ||
    asset.symbol === "WETH"
  ) {
    return `${asset.name} (${asset.symbol}) is the wrapped native asset used for onchain routing and basket rewards.`;
  }
  if (asset.verification === "official-robinhood-current-chain") {
    return `${asset.name} (${asset.symbol}) is identified by its current-chain contract address and canonical Robinhood metadata.`;
  }
  return `${asset.name} (${asset.symbol}) is identified by its onchain contract metadata. Review the linked contract before relying on it.`;
}

export function rewardAssetMetadata(
  address: string,
  canonicalAddresses: readonly string[],
  isTestnet: boolean,
  catalog?: readonly {
    address: string;
    symbol: string;
    mockSymbol?: string;
    name: string;
    category?: string;
    logoUrl?: string | null;
    verification?: string;
    mockOnly?: boolean;
  }[],
): RewardAssetMetadata {
  const catalogAsset = catalog?.find(
    (candidate) => candidate.address.toLowerCase() === address.toLowerCase(),
  );
  if (catalogAsset) {
    const metadata = {
      symbol: catalogAsset.mockSymbol ?? catalogAsset.symbol,
      name: catalogAsset.name,
      logoUrl: catalogAsset.logoUrl ?? null,
      category: catalogAsset.category ?? "custom",
      verification: catalogAsset.verification ?? "unverified-erc20",
      mockOnly: catalogAsset.mockOnly ?? false,
    };
    return { ...metadata, description: assetDescription(metadata) };
  }
  const index = canonicalAddresses.findIndex(
    (candidate) => candidate.toLowerCase() === address.toLowerCase(),
  );
  const known = rewardAssetCatalog[index];
  if (!known)
    return {
      symbol: "Unknown asset",
      name: "Unverified asset",
      description:
        "This contract is not in the current Sherwood Forest asset catalog. Review the linked contract before relying on it.",
      logoUrl: null,
      category: "custom",
      verification: "unverified-erc20",
      mockOnly: false,
    };
  return {
    symbol: isTestnet ? "t" + known.symbol : known.symbol,
    name: known.name,
    description: `${known.name} is identified by its configured reward-asset contract address.`,
    logoUrl: null,
    category: "custom",
    verification: isTestnet ? "robyn-testnet-mock" : "robyn-token-list",
    mockOnly: isTestnet,
  };
}

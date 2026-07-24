export type BasketAssetVerification =
  | "official-robinhood-current-chain"
  | "robinhood-testnet-faucet-stock"
  | "robyn-testnet-mock"
  | "robyn-controlled-testnet-dex"
  | "robyn-token-list"
  | "unverified-erc20";

type SortableBasketAsset = {
  symbol: string;
  verification: BasketAssetVerification;
};

function assetSortPriority(asset: SortableBasketAsset) {
  if (
    asset.verification === "robinhood-testnet-faucet-stock" ||
    asset.verification === "official-robinhood-current-chain"
  )
    return 0;
  if (asset.verification === "robyn-token-list") return 1;
  if (asset.verification === "robyn-controlled-testnet-dex") return 2;
  if (asset.verification === "robyn-testnet-mock") return 3;
  return 4;
}

export function compareBasketAssets(
  left: SortableBasketAsset,
  right: SortableBasketAsset,
) {
  return (
    assetSortPriority(left) - assetSortPriority(right) ||
    left.symbol.localeCompare(right.symbol)
  );
}

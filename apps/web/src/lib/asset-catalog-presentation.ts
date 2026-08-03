export function assetCatalogVerificationLabel(asset: { verification: string }) {
  if (asset.verification === "robinhood-testnet-faucet-stock")
    return "Robinhood faucet stock";
  if (asset.verification === "official-robinhood-current-chain")
    return "Official on this chain";
  if (asset.verification === "robyn-testnet-mock") return "Robyn testnet mock";
  if (asset.verification === "robyn-controlled-testnet-dex")
    return "Robyn test DEX";
  if (asset.verification === "robyn-token-list") return "Robyn verified";
  if (asset.verification === "canonical-weth-runtime") return "Canonical WETH";
  if (asset.verification === "robinhood-mainnet-token-runtime")
    return "Mainnet runtime verified";
  if (asset.verification === "robinhood-mainnet-token-runtime-and-v4-route")
    return "Mainnet runtime + route verified";
  return "Unverified ERC-20";
}

export function compactNativePrice(value: string | null) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (amount >= 1)
    return amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
  if (amount >= 0.0001)
    return amount.toLocaleString(undefined, { maximumSignificantDigits: 6 });
  return amount.toExponential(4);
}

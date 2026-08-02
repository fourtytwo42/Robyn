import { describe, expect, it } from "vitest";
import {
  compareBasketAssets,
  type BasketAssetVerification,
} from "../lib/basket-asset-order";
import {
  compactNativePrice,
  assetCatalogVerificationLabel,
} from "../lib/asset-catalog-presentation";

function asset(symbol: string, verification: BasketAssetVerification) {
  return { symbol, verification };
}

describe("compareBasketAssets", () => {
  it("presents faucet-issued assets before Robyn mocks", () => {
    const sorted = [
      asset("tmAAPL", "robyn-testnet-mock"),
      asset("TSLA", "robinhood-testnet-faucet-stock"),
      asset("AMD", "robinhood-testnet-faucet-stock"),
    ].sort(compareBasketAssets);

    expect(sorted.map(({ symbol }) => symbol)).toEqual([
      "AMD",
      "TSLA",
      "tmAAPL",
    ]);
  });
});

describe("asset catalog presentation", () => {
  it("labels verified Mainnet routes and canonical WETH explicitly", () => {
    expect(
      assetCatalogVerificationLabel({
        verification: "robinhood-mainnet-token-runtime-and-v4-route",
      }),
    ).toBe("Mainnet runtime + route verified");
    expect(
      assetCatalogVerificationLabel({ verification: "canonical-weth-runtime" }),
    ).toBe("Canonical WETH");
  });

  it("formats small pool-implied native prices without rounding them to zero", () => {
    expect(compactNativePrice("0.000123456789")).toBe("0.000123457");
    expect(compactNativePrice("0.000000123456789")).toBe("1.2346e-7");
    expect(compactNativePrice(null)).toBeNull();
  });
});

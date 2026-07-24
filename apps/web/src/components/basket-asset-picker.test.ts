import { describe, expect, it } from "vitest";
import {
  compareBasketAssets,
  type BasketAssetVerification,
} from "../lib/basket-asset-order";

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

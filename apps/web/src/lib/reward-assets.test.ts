import { describe, expect, it } from "vitest";

import { rewardAssetMetadata } from "./reward-assets";

const addresses = [
  "0x0000000000000000000000000000000000000001",
  "0x0000000000000000000000000000000000000002",
  "0x0000000000000000000000000000000000000003",
];

describe("rewardAssetMetadata", () => {
  it("maps canonical addresses case-insensitively to user-facing names", () => {
    expect(
      rewardAssetMetadata(addresses[0]!.toUpperCase(), addresses, false),
    ).toMatchObject({ symbol: "mNVDA", name: "Mock NVIDIA" });
    expect(rewardAssetMetadata(addresses[1]!, addresses, true)).toMatchObject({
      symbol: "tmSPY",
      name: "Mock S&P 500",
      mockOnly: true,
    });
  });

  it("does not present an unknown address as a friendly asset", () => {
    expect(
      rewardAssetMetadata(
        "0x0000000000000000000000000000000000000004",
        addresses,
        false,
      ),
    ).toMatchObject({
      symbol: "Unknown asset",
      name: "Unverified asset",
      verification: "unverified-erc20",
    });
  });

  it("uses catalog names, symbols, artwork and verification descriptions", () => {
    expect(
      rewardAssetMetadata(addresses[0]!, addresses, true, [
        {
          address: addresses[0]!,
          symbol: "TSLA",
          name: "Tesla",
          category: "stock",
          logoUrl: "https://cdn.example/tsla.png",
          verification: "robinhood-testnet-faucet-stock",
          mockOnly: false,
        },
      ]),
    ).toMatchObject({
      symbol: "TSLA",
      name: "Tesla",
      logoUrl: "https://cdn.example/tsla.png",
      category: "stock",
      verification: "robinhood-testnet-faucet-stock",
      description:
        "Tesla (TSLA) is a faucet-issued Robinhood Chain Testnet asset. It is for testing only and has no backing or redemption rights.",
    });
  });
});

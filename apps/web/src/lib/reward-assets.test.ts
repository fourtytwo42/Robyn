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
    ).toEqual({ symbol: "mNVDA", name: "Mock NVIDIA" });
    expect(rewardAssetMetadata(addresses[1]!, addresses, true)).toEqual({
      symbol: "tmSPY",
      name: "Mock S&P 500",
    });
  });

  it("does not present an unknown address as a friendly asset", () => {
    expect(
      rewardAssetMetadata(
        "0x0000000000000000000000000000000000000004",
        addresses,
        false,
      ),
    ).toEqual({ symbol: "Unknown asset", name: "Unverified asset" });
  });
});

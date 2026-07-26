import { describe, expect, it } from "vitest";
import {
  baseValueInUsd,
  marketAmount,
  marketCapAmount,
  usdAmount,
} from "../lib/display-format";

describe("marketAmount", () => {
  it("does not round small testnet market values down to zero", () => {
    expect(marketAmount("5730284000000000", "ETH")).toBe("0.00573 ETH");
    expect(marketAmount("39195226729484", "ETH")).toBe("0.000039 ETH");
    expect(marketAmount("200000000000000", "ETH")).toBe("0.0002 ETH");
  });

  it("labels nonzero dust rather than displaying zero", () => {
    expect(marketAmount("1", "ETH")).toBe("<0.000001 ETH");
    expect(marketAmount("0", "ETH")).toBe("0 ETH");
  });

  it("converts ETH market values into concise USD display values", () => {
    expect(baseValueInUsd("2000000000000000000", "ETH", 3500)).toBe(7000);
    expect(marketCapAmount("2000000000000000000", "ETH", 3500)).toBe(
      "$7,000.00",
    );
    expect(usdAmount(0.0000001)).toBe("<$0.000001");
  });

  it("fails closed when an ETH USD reference is unavailable", () => {
    expect(marketCapAmount("1000000000000000000", "ETH", null)).toBe(
      "USD unavailable",
    );
  });
});

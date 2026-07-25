import { describe, expect, it } from "vitest";
import { marketAmount } from "../lib/display-format";

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
});

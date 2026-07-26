import { afterEach, describe, expect, it, vi } from "vitest";

import { getEthUsdPrice } from "./eth-usd";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getEthUsdPrice", () => {
  it("accepts a valid unauthenticated Coinbase ETH USD spot quote", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { amount: "3842.51", currency: "USD" },
        }),
      }),
    );
    await expect(getEthUsdPrice()).resolves.toBe(3842.51);
  });

  it("fails closed when the reference quote is missing or malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { amount: "not-a-number" } }),
      }),
    );
    await expect(getEthUsdPrice()).resolves.toBeNull();
  });
});

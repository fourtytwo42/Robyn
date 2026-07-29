import { describe, expect, it } from "vitest";
import {
  requestZeroExAllowanceHolderQuote,
  schema12QuoteId,
} from "../src/provider-quotes.js";

const allowanceHolder = "0x1111111111111111111111111111111111111111";
const request = {
  apiKey: "protected-test-key",
  chainId: 4663,
  sellToken: "0x2222222222222222222222222222222222222222",
  buyToken: "0x3333333333333333333333333333333333333333",
  sellAmount: 100n,
  taker: "0x4444444444444444444444444444444444444444",
  expectedAllowanceHolder: allowanceHolder,
  slippageBps: 50,
  idempotencyKey: "conversion:one",
  endpoint: "https://example.invalid/quote",
} as const;

function response(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      liquidityAvailable: true,
      buyAmount: "200",
      minBuyAmount: "190",
      sellAmount: "100",
      transaction: {
        to: allowanceHolder,
        data: "0x12345678",
      },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("schema-12 provider quotes", () => {
  it("builds a bounded server-side firm quote request", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return response();
    };
    const quote = await requestZeroExAllowanceHolderQuote(request, fetcher);
    expect(quote.buyAmount).toBe(200n);
    expect(quote.minimumBuyAmount).toBe(190n);
    expect(quote.allowanceTarget).toBe(allowanceHolder);
    expect(quote.executionData).toBe("0x12345678");
    expect(capturedUrl).toContain("chainId=4663");
    expect(capturedUrl).toContain(`taker=${request.taker}`);
    expect(capturedUrl).not.toContain(request.apiKey);
    expect(
      (capturedInit?.headers as Record<string, string>)["0x-api-key"],
    ).toBe(request.apiKey);
  });

  it("rejects target substitution and amount drift", async () => {
    await expect(
      requestZeroExAllowanceHolderQuote(request, async () =>
        response({
          transaction: {
            to: "0x5555555555555555555555555555555555555555",
            data: "0x12345678",
          },
        }),
      ),
    ).rejects.toThrow("allowance target");
    await expect(
      requestZeroExAllowanceHolderQuote(request, async () =>
        response({ sellAmount: "99" }),
      ),
    ).rejects.toThrow("sell amount");
  });

  it("rejects missing liquidity, malformed output, and unsafe slippage", async () => {
    await expect(
      requestZeroExAllowanceHolderQuote(request, async () =>
        response({ liquidityAvailable: false }),
      ),
    ).rejects.toThrow("no available liquidity");
    await expect(
      requestZeroExAllowanceHolderQuote(request, async () =>
        response({ minBuyAmount: "201" }),
      ),
    ).rejects.toThrow("exceeds");
    await expect(
      requestZeroExAllowanceHolderQuote(
        { ...request, slippageBps: 101 },
        async () => response(),
      ),
    ).rejects.toThrow("slippage");
  });

  it("derives stable quote identities without exposing credentials", () => {
    expect(schema12QuoteId("conversion:one")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(schema12QuoteId("conversion:one")).toBe(
      schema12QuoteId("conversion:one"),
    );
    expect(schema12QuoteId("conversion:two")).not.toBe(
      schema12QuoteId("conversion:one"),
    );
  });
});

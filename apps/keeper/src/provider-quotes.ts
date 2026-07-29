import { createHash } from "node:crypto";
import { getAddress, isHex, type Address, type Hex } from "viem";

export type ProviderQuote = {
  buyAmount: bigint;
  minimumBuyAmount: bigint;
  executionData: Hex;
  allowanceTarget: Address;
  quoteId: Hex;
};

type FetchLike = typeof fetch;

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`0x ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function requireInteger(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`0x ${label} is invalid`);
  }
  return BigInt(value);
}

function requireAddress(value: unknown, label: string): Address {
  if (typeof value !== "string") throw new Error(`0x ${label} is invalid`);
  try {
    return getAddress(value);
  } catch {
    throw new Error(`0x ${label} is invalid`);
  }
}

export function schema12QuoteId(idempotencyKey: string): Hex {
  if (!idempotencyKey) throw new Error("Idempotency key is required");
  return `0x${createHash("sha256").update(idempotencyKey).digest("hex")}`;
}

export async function requestZeroExAllowanceHolderQuote(
  input: {
    apiKey: string;
    chainId: number;
    sellToken: Address;
    buyToken: Address;
    sellAmount: bigint;
    taker: Address;
    expectedAllowanceHolder: Address;
    slippageBps: number;
    idempotencyKey: string;
    endpoint?: string;
  },
  fetchImplementation: FetchLike = fetch,
): Promise<ProviderQuote> {
  if (!input.apiKey) throw new Error("0x API key is not configured");
  if (input.chainId !== 4663)
    throw new Error("0x provider quotes are Mainnet-only");
  if (input.sellAmount <= 0n)
    throw new Error("0x sell amount must be positive");
  if (
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 1 ||
    input.slippageBps > 100
  ) {
    throw new Error("0x slippage must be between 1 and 100 bps");
  }
  const url = new URL(
    input.endpoint ?? "https://api.0x.org/swap/allowance-holder/quote",
  );
  url.search = new URLSearchParams({
    chainId: String(input.chainId),
    sellToken: input.sellToken,
    buyToken: input.buyToken,
    sellAmount: input.sellAmount.toString(),
    taker: input.taker,
    recipient: input.taker,
    slippageBps: String(input.slippageBps),
  }).toString();
  const response = await fetchImplementation(url, {
    method: "GET",
    headers: {
      "0x-api-key": input.apiKey,
      "0x-version": "v2",
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`0x quote request failed with HTTP ${response.status}`);
  }
  const payload = requireRecord(await response.json(), "response");
  if (payload.liquidityAvailable === false) {
    throw new Error("0x quote has no available liquidity");
  }
  const transaction = requireRecord(payload.transaction, "transaction");
  const allowanceTarget = requireAddress(transaction.to, "allowance target");
  if (allowanceTarget !== getAddress(input.expectedAllowanceHolder)) {
    throw new Error("0x allowance target does not match the pinned adapter");
  }
  const data = transaction.data;
  if (typeof data !== "string" || !isHex(data) || data.length < 10) {
    throw new Error("0x transaction calldata is invalid");
  }
  const buyAmount = requireInteger(payload.buyAmount, "buy amount");
  const minimumBuyAmount = requireInteger(
    payload.minBuyAmount,
    "minimum buy amount",
  );
  if (minimumBuyAmount > buyAmount) {
    throw new Error("0x minimum buy amount exceeds the quoted output");
  }
  if (
    typeof payload.sellAmount !== "string" ||
    BigInt(payload.sellAmount) !== input.sellAmount
  ) {
    throw new Error("0x sell amount does not match the requested amount");
  }
  return {
    buyAmount,
    minimumBuyAmount,
    executionData: data,
    allowanceTarget,
    quoteId: schema12QuoteId(input.idempotencyKey),
  };
}

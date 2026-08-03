import { describe, expect, it, vi } from "vitest";
import type { Address, PublicClient } from "viem";
import { ChainlinkReferencePriceService } from "../src/chainlink-reference-price.js";

const token = "0x0000000000000000000000000000000000000001" as Address;
const feed = "0x0000000000000000000000000000000000000002" as Address;

function client(
  updatedAt: bigint,
  options: { paused?: boolean; answer?: bigint } = {},
) {
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "oraclePaused") return options.paused ?? false;
      if (functionName === "decimals") return 8;
      if (functionName === "latestRoundData")
        return [7n, options.answer ?? 123_45000000n, updatedAt, updatedAt, 7n];
      throw new Error(`unexpected ${functionName}`);
    }),
  } as unknown as PublicClient;
}

describe("ChainlinkReferencePriceService", () => {
  it("returns multiplier-adjusted token USD answers without applying another multiplier", async () => {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const result = await new ChainlinkReferencePriceService(client(now)).read(
      token,
      {
        kind: "chainlink-usd",
        feedAddress: feed,
        heartbeatSeconds: 86_400,
        expectedDecimals: 8,
        oraclePauseCheck: true,
      },
    );
    expect(result).toMatchObject({
      status: "available",
      usdPerToken: "123.45",
      sequencerStatus: "not-published",
    });
  });

  it("uses ETH/USD for optional WETH display without changing exact native parity", async () => {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const result = await new ChainlinkReferencePriceService(client(now)).read(
      token,
      {
        kind: "native-parity",
        feedAddress: feed,
        heartbeatSeconds: 86_400,
        expectedDecimals: 8,
      },
    );
    expect(result).toMatchObject({
      kind: "native-parity",
      status: "available",
      usdPerToken: "123.45",
    });
  });

  it("fails closed for stale, paused, nonpositive, and unpublished feeds", async () => {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const policy = {
      kind: "chainlink-usd" as const,
      feedAddress: feed,
      heartbeatSeconds: 60,
      expectedDecimals: 8,
      oraclePauseCheck: true,
    };
    await expect(
      new ChainlinkReferencePriceService(client(now - 61n)).read(token, policy),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "Chainlink feed is stale",
    });
    await expect(
      new ChainlinkReferencePriceService(client(now, { paused: true })).read(
        token,
        policy,
      ),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "Stock Token oracle is paused",
    });
    await expect(
      new ChainlinkReferencePriceService(client(now, { answer: 0n })).read(
        token,
        policy,
      ),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "Chainlink answer is not positive",
    });
    await expect(
      new ChainlinkReferencePriceService(client(now)).read(token, {
        kind: "none",
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "Chainlink reference feed is not published",
    });
  });

  it("never caches an unavailable value", async () => {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    let answer = 0n;
    const rpc = client(now);
    vi.mocked(rpc.readContract).mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "oraclePaused") return false as never;
        if (functionName === "decimals") return 8 as never;
        return [7n, answer, now, now, 7n] as never;
      },
    );
    const service = new ChainlinkReferencePriceService(rpc);
    const policy = {
      kind: "chainlink-usd" as const,
      feedAddress: feed,
      heartbeatSeconds: 60,
      expectedDecimals: 8,
    };
    await expect(service.read(token, policy)).resolves.toMatchObject({
      status: "unavailable",
    });
    answer = 1_00000000n;
    await expect(service.read(token, policy)).resolves.toMatchObject({
      status: "available",
      usdPerToken: "1",
    });
  });
});

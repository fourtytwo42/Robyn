import { describe, expect, it, vi } from "vitest";
import type { Address, PublicClient } from "viem";
import { ChainlinkReferencePriceService } from "../src/chainlink-reference-price.js";

const token = "0x0000000000000000000000000000000000000001" as Address;
const feed = "0x0000000000000000000000000000000000000002" as Address;
const sequencer = "0x0000000000000000000000000000000000000003" as Address;

function client(
  sequencerAnswer: bigint,
  sequencerStartedAt: bigint,
  now: bigint,
) {
  return {
    readContract: vi.fn(
      async ({
        address,
        functionName,
      }: {
        address: Address;
        functionName: string;
      }) => {
        if (address === sequencer && functionName === "latestRoundData")
          return [
            1n,
            sequencerAnswer,
            sequencerStartedAt,
            sequencerStartedAt,
            1n,
          ];
        if (functionName === "decimals") return 8;
        if (functionName === "latestRoundData")
          return [1n, 100_00000000n, now, now, 1n];
        throw new Error(`unexpected ${functionName}`);
      },
    ),
  } as unknown as PublicClient;
}

describe("Chainlink sequencer admission", () => {
  it.each([
    ["down", 1n, 7_200n],
    ["inside grace", 0n, 30n],
  ])("fails closed while the sequencer is %s", async (_label, answer, age) => {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    await expect(
      new ChainlinkReferencePriceService(client(answer, now - age, now), {
        sequencerUptimeFeed: sequencer,
        sequencerGracePeriodSeconds: 60,
      }).read(token, {
        kind: "chainlink-usd",
        feedAddress: feed,
        heartbeatSeconds: 86_400,
        expectedDecimals: 8,
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      sequencerStatus: "unavailable",
    });
  });

  it("accepts a healthy sequencer after the grace period", async () => {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    await expect(
      new ChainlinkReferencePriceService(client(0n, now - 61n, now), {
        sequencerUptimeFeed: sequencer,
        sequencerGracePeriodSeconds: 60,
      }).read(token, {
        kind: "chainlink-usd",
        feedAddress: feed,
        heartbeatSeconds: 86_400,
        expectedDecimals: 8,
      }),
    ).resolves.toMatchObject({
      status: "available",
      sequencerStatus: "healthy",
    });
  });
});

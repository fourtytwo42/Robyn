import { describe, expect, it } from "vitest";
import type { Address, PublicClient } from "viem";
import {
  AssetCatalogService,
  type AssetCatalogManifest,
} from "../src/asset-catalog.js";

const zero = "0x0000000000000000000000000000000000000000" as Address;
const token = "0x0000000000000000000000000000000000000002" as Address;
const router = "0x0000000000000000000000000000000000000003" as Address;
const quoter = "0x0000000000000000000000000000000000000004" as Address;
const feed = "0x0000000000000000000000000000000000000005" as Address;

describe("asset market admission", () => {
  it("shows a raw pool price but remains unselectable while the contract route is disabled", async () => {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const client = {
      getCode: async () => "0x01",
      readContract: async ({
        address,
        functionName,
      }: {
        address: Address;
        functionName: string;
      }) => {
        if (address === feed && functionName === "decimals") return 8;
        if (address === feed && functionName === "latestRoundData")
          return [7n, 123_45000000n, now, now, 7n];
        if (functionName === "executionRouteStatus")
          return {
            kind: 0,
            maximumNativeInput: 0n,
            maximumAssetInput: 0n,
            disabledReason: `0x${"0".repeat(64)}`,
            enabled: false,
            runtimeVerified: true,
            ready: false,
            reason: `0x${"0".repeat(64)}`,
          };
        if (functionName === "routeStatus")
          return {
            poolId: `0x${"1".repeat(64)}`,
            liquidity: 0n,
            minimumLiquidity: 1n,
            maximumNativeInput: 0n,
            spotTick: 0,
            referenceTick: 0,
            maximumReferenceTickDeviation: 198,
            enforceReferencePrice: true,
            verificationClass: `0x${"0".repeat(64)}`,
            fee: 3_000,
            tickSpacing: 60,
            hooks: zero,
            ready: false,
            reason: `0x${"0".repeat(64)}`,
          };
        throw new Error(`unexpected ${functionName}`);
      },
      simulateContract: async ({
        address,
        args,
      }: {
        address: Address;
        args: readonly unknown[];
      }) => {
        expect(address).toBe(quoter);
        const quote = args[0] as {
          exactAmount: bigint;
          zeroForOne: boolean;
        };
        return {
          result: [quote.zeroForOne ? 200_000n : 99_000_000_000_000n, 100_000n],
        };
      },
    } as unknown as PublicClient;
    const manifest: AssetCatalogManifest = {
      schemaVersion: 18,
      snapshotAt: "2026-08-03T00:00:00Z",
      disclosure: "test",
      v4Venue: { quoter },
      assets: [
        {
          symbol: "USDG",
          name: "Global Dollar",
          category: "stock",
          address: token,
          chainId: 4663,
          decimals: 6,
          verification: "robinhood-mainnet-token-runtime",
          mockOnly: false,
          referencePrice: {
            kind: "chainlink-usd",
            feedAddress: feed,
            heartbeatSeconds: 86_400,
            expectedDecimals: 8,
          },
          route: { kind: "none", ready: false },
          pool: {
            fee: 3_000,
            tickSpacing: 60,
            hooks: zero,
            poolId: `0x${"1".repeat(64)}`,
            quoteAmountNativeWei: "100000000000000",
          },
        },
      ],
    };

    await expect(
      new AssetCatalogService(client, 4663, zero, router, manifest).list(),
    ).resolves.toEqual([
      expect.objectContaining({
        referencePrice: expect.objectContaining({
          status: "available",
          usdPerToken: "123.45",
        }),
        poolPrice: expect.objectContaining({
          status: "available",
          nativePerAsset: "0.0005",
        }),
        route: expect.objectContaining({
          contractReady: false,
          marketReady: true,
          selectable: false,
        }),
      }),
    ]);
  });
});

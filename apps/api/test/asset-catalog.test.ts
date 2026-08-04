import { describe, expect, it } from "vitest";
import { keccak256, stringToHex, type Address, type PublicClient } from "viem";
import {
  AssetCatalogService,
  type AssetCatalogManifest,
} from "../src/asset-catalog.js";

const base = "0x0000000000000000000000000000000000000001" as Address;
const asset = "0x0000000000000000000000000000000000000002" as Address;
const registry = "0x0000000000000000000000000000000000000003" as Address;
const native = "0x0000000000000000000000000000000000000000" as Address;

function manifest(): AssetCatalogManifest {
  return {
    schemaVersion: 1,
    snapshotAt: "2026-07-23T00:00:00Z",
    disclosure: "testnet mock",
    assets: [
      {
        symbol: "NVDA",
        mockSymbol: "tmNVDA",
        name: "Robyn Testnet Mock NVIDIA",
        category: "stock",
        address: asset,
        chainId: 46630,
        decimals: 18,
        verification: "robyn-testnet-mock",
        mockOnly: true,
      },
    ],
  };
}

describe("AssetCatalogService", () => {
  it("rejects malformed and no-code addresses without metadata reads", async () => {
    let reads = 0;
    const client = {
      getCode: async () => "0x",
      readContract: async () => {
        reads += 1;
        throw new Error("unexpected");
      },
    } as unknown as PublicClient;
    const service = new AssetCatalogService(
      client,
      46630,
      base,
      registry,
      manifest(),
    );
    await expect(service.resolve("not-an-address")).resolves.toBeNull();
    await expect(service.resolve(asset)).resolves.toBeNull();
    expect(reads).toBe(0);
  });

  it("uses chain-address provenance and live route state", async () => {
    let codeReads = 0;
    const client = {
      getCode: async () => {
        codeReads += 1;
        return "0x01";
      },
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "name") return "Spoofed NVIDIA";
        if (functionName === "symbol") return "NVDA";
        if (functionName === "decimals") return 6;
        if (functionName === "totalSupply") return 1_000_000n;
        if (functionName === "routeStatus") {
          return {
            kind: 1,
            ready: true,
            venue: "0x0000000000000000000000000000000000000000",
            poolFee: 0,
            liquidity: 0n,
            fixedRateX18: 1n,
            reason: `0x${"0".repeat(64)}`,
          };
        }
        throw new Error(`unexpected ${functionName}`);
      },
    } as unknown as PublicClient;
    const service = new AssetCatalogService(
      client,
      46630,
      base,
      registry,
      manifest(),
    );
    const first = await service.resolve(asset);
    const second = await service.resolve(asset);
    expect(first).toMatchObject({
      address: asset,
      verification: "robyn-testnet-mock",
      name: "Robyn Testnet Mock NVIDIA",
      symbol: "tmNVDA",
      decimals: 18,
      route: { kind: "fixed-testnet", ready: true },
    });
    expect(second).toEqual(first);
    expect(codeReads).toBe(1);
  });

  it("reads and quotes native Uniswap v4 routes", async () => {
    const v4Manifest = manifest();
    v4Manifest.v4Venue = { quoter: registry };
    const client = {
      getCode: async () => "0x01",
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "name") return "Tesla";
        if (functionName === "symbol") return "TSLA";
        if (functionName === "decimals") return 18;
        if (functionName === "totalSupply") return 100n;
        if (functionName === "executionRouteStatus") {
          return {
            kind: 1,
            maximumNativeInput: 1_000_000n,
            maximumAssetInput: 2n ** 128n - 1n,
            disabledReason: `0x${"0".repeat(64)}`,
            enabled: true,
            runtimeVerified: true,
            ready: true,
            reason: `0x${"0".repeat(64)}`,
          };
        }
        if (functionName === "routeStatus") {
          return {
            poolId: `0x${"1".repeat(64)}`,
            liquidity: 5_000n,
            minimumLiquidity: 1_000n,
            maximumNativeInput: 1_000_000n,
            spotTick: 0,
            referenceTick: 0,
            maximumReferenceTickDeviation: 198,
            enforceReferencePrice: true,
            verificationClass: `0x${"0".repeat(64)}`,
            fee: 10_000,
            tickSpacing: 200,
            hooks: native,
            ready: true,
            reason: `0x${"0".repeat(64)}`,
          };
        }
        throw new Error(`unexpected ${functionName}`);
      },
      simulateContract: async () => ({ result: [25n, 0n] }),
    } as unknown as PublicClient;
    const service = new AssetCatalogService(
      client,
      46630,
      base,
      registry,
      v4Manifest,
    );

    await expect(service.resolve(asset)).resolves.toMatchObject({
      route: {
        kind: "uniswap-v4",
        ready: true,
        venue: registry,
        poolFee: 10_000,
        liquidity: "5000",
      },
    });
    await expect(service.quote(asset, 10n)).resolves.toBe(25n);
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        livePrice: expect.objectContaining({
          kind: "pool-implied",
          status: "available",
          quoteAmountNative: "1000000",
          quoteAmountAsset: "25",
        }),
      }),
    ]);
  });

  it("keeps a direct WETH wrap selectable without reading a v4 pool", async () => {
    let routeStatusReads = 0;
    const wethManifest = manifest();
    wethManifest.v4Venue = { quoter: registry };
    wethManifest.assets[0] = {
      ...wethManifest.assets[0]!,
      symbol: "WETH",
      mockSymbol: undefined,
      name: "Wrapped Ether",
      category: "wrapped-native",
      chainId: 4663,
      mockOnly: false,
      verification: "canonical-weth-runtime",
    };
    const client = {
      getCode: async () => "0x01",
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "executionRouteStatus") {
          return {
            kind: 2,
            maximumNativeInput: 500_000_000_000_000_000n,
            maximumAssetInput: 500_000_000_000_000_000n,
            disabledReason: `0x${"0".repeat(64)}`,
            enabled: true,
            runtimeVerified: true,
            ready: true,
            reason: `0x${"0".repeat(64)}`,
          };
        }
        if (functionName === "routeStatus") {
          routeStatusReads += 1;
          throw new Error("direct WETH wrap has no v4 pool");
        }
        throw new Error(`unexpected ${functionName}`);
      },
    } as unknown as PublicClient;
    const service = new AssetCatalogService(
      client,
      4663,
      base,
      registry,
      wethManifest,
    );

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        symbol: "WETH",
        route: expect.objectContaining({
          kind: "wrapped-native",
          ready: true,
          contractReady: true,
          selectable: true,
          maximumNativeInput: "500000000000000000",
          maximumAssetInput: "500000000000000000",
          poolId: null,
        }),
        poolPrice: expect.objectContaining({
          status: "available",
          kind: "exact-native",
          nativePerAsset: "1",
        }),
      }),
    ]);
    expect(routeStatusReads).toBe(0);
  });

  it("keeps canonical symbols for verified Mainnet assets with mock aliases", async () => {
    const mainnetManifest = manifest();
    mainnetManifest.assets[0] = {
      ...mainnetManifest.assets[0]!,
      chainId: 4663,
      mockOnly: false,
      verification: "robinhood-mainnet-token-runtime-and-v4-route",
    };
    const client = {
      getCode: async () => "0x01",
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "routeStatus")
          return {
            poolId: `0x${"1".repeat(64)}`,
            liquidity: 0n,
            minimumLiquidity: 1n,
            maximumNativeInput: 1_000_000n,
            spotTick: 0,
            referenceTick: 0,
            maximumReferenceTickDeviation: 0,
            enforceReferencePrice: false,
            verificationClass: `0x${"0".repeat(64)}`,
            fee: 10_000,
            tickSpacing: 200,
            hooks: native,
            ready: false,
            reason: keccak256(stringToHex("INSUFFICIENT_LIQUIDITY")),
          };
        if (functionName === "executionRouteStatus")
          return {
            kind: 1,
            maximumNativeInput: 1_000_000n,
            maximumAssetInput: 1_000_000n,
            disabledReason: `0x${"0".repeat(64)}`,
            enabled: true,
            runtimeVerified: true,
            ready: false,
            reason: keccak256(stringToHex("INSUFFICIENT_LIQUIDITY")),
          };
        throw new Error(`unexpected ${functionName}`);
      },
    } as unknown as PublicClient;
    const service = new AssetCatalogService(
      client,
      4663,
      native,
      registry,
      mainnetManifest,
    );
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        symbol: "NVDA",
        verification: "robinhood-mainnet-token-runtime-and-v4-route",
        route: expect.objectContaining({
          ready: false,
          reason: "Conversion pool has insufficient liquidity",
        }),
        livePrice: expect.objectContaining({ status: "unavailable" }),
      }),
    ]);
  });

  it("classifies an unknown contract as unverified even when its symbol spoofs a curated asset", async () => {
    const unknown = "0x0000000000000000000000000000000000000004" as Address;
    const client = {
      getCode: async () => "0x01",
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "name") return "NVIDIA";
        if (functionName === "symbol") return "tmNVDA";
        if (functionName === "decimals") return 18;
        if (functionName === "totalSupply") return 1n;
        if (functionName === "executionRouteStatus") {
          return {
            kind: 0,
            maximumNativeInput: 0n,
            maximumAssetInput: 0n,
            disabledReason: `0x${"0".repeat(64)}`,
            enabled: false,
            runtimeVerified: false,
            ready: false,
            reason: keccak256(stringToHex("ROUTE_NOT_CONFIGURED")),
          };
        }
        if (functionName === "routeStatus") {
          return {
            kind: 0,
            ready: false,
            venue: "0x0000000000000000000000000000000000000000",
            poolFee: 0,
            liquidity: 0n,
            fixedRateX18: 0n,
            reason: `0x${Buffer.from("no-route").toString("hex").padEnd(64, "0")}`,
          };
        }
        throw new Error(`unexpected ${functionName}`);
      },
    } as unknown as PublicClient;
    const service = new AssetCatalogService(
      client,
      46630,
      base,
      registry,
      manifest(),
    );
    await expect(service.resolve(unknown)).resolves.toMatchObject({
      verification: "unverified-erc20",
      mockOnly: false,
      logoUrl: null,
      route: { ready: false, reason: "no-route" },
    });
  });

  it("renders v4 route hashes as safe actionable text", async () => {
    const unknown = "0x0000000000000000000000000000000000000004" as Address;
    const client = {
      getCode: async () => "0x01",
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "name") return "Launch token";
        if (functionName === "symbol") return "LAUNCH";
        if (functionName === "decimals") return 18;
        if (functionName === "totalSupply") return 1n;
        if (functionName === "executionRouteStatus") {
          return {
            kind: 0,
            maximumNativeInput: 0n,
            maximumAssetInput: 0n,
            disabledReason: `0x${"0".repeat(64)}`,
            enabled: false,
            runtimeVerified: false,
            ready: false,
            reason: keccak256(stringToHex("ROUTE_NOT_CONFIGURED")),
          };
        }
        if (functionName === "routeStatus") {
          return {
            poolId: `0x${"0".repeat(64)}`,
            liquidity: 0n,
            minimumLiquidity: 1n,
            maximumNativeInput: 0n,
            spotTick: 0,
            referenceTick: 0,
            maximumReferenceTickDeviation: 0,
            enforceReferencePrice: false,
            verificationClass: `0x${"0".repeat(64)}`,
            fee: 0,
            tickSpacing: 0,
            hooks: native,
            ready: false,
            reason: keccak256(stringToHex("ROUTE_NOT_CONFIGURED")),
          };
        }
        throw new Error(`unexpected ${functionName}`);
      },
    } as unknown as PublicClient;
    const service = new AssetCatalogService(
      client,
      46630,
      native,
      registry,
      manifest(),
    );

    await expect(service.resolve(unknown)).resolves.toMatchObject({
      route: { ready: false, reason: "No funded conversion route" },
    });
  });

  it("rejects unsafe decimal metadata", async () => {
    const unknown = "0x0000000000000000000000000000000000000004" as Address;
    const client = {
      getCode: async () => "0x01",
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "name") return "Token";
        if (functionName === "symbol") return "TKN";
        if (functionName === "decimals") return 255;
        if (functionName === "totalSupply") return 1n;
        throw new Error("unexpected");
      },
    } as unknown as PublicClient;
    const service = new AssetCatalogService(
      client,
      46630,
      base,
      registry,
      manifest(),
    );
    await expect(service.resolve(unknown)).resolves.toBeNull();
  });

  it("uses the verified manifest route while a curated live route read is unavailable", async () => {
    const currentManifest = manifest();
    currentManifest.assets[0]!.route = {
      kind: "uniswap-v4",
      ready: true,
    };
    const client = {
      getCode: async () => "0x01",
      readContract: async () => {
        throw new Error("public RPC temporarily unavailable");
      },
    } as unknown as PublicClient;
    const service = new AssetCatalogService(
      client,
      46630,
      native,
      registry,
      currentManifest,
    );

    await expect(service.resolve(asset)).resolves.toMatchObject({
      name: "Robyn Testnet Mock NVIDIA",
      symbol: "tmNVDA",
      route: {
        kind: "uniswap-v4",
        ready: true,
        venue: registry,
        reason:
          "Live route check temporarily unavailable; launch simulation revalidates",
      },
    });
  });
});

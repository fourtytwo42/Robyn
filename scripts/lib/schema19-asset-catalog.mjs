import { createHash } from "node:crypto";
import { encodeAbiParameters, getAddress, keccak256, zeroAddress } from "viem";

const TESTNET_ASSETS = {
  GOOGL: {
    mockSymbol: "tmGOOGL",
    name: "Robyn Testnet Mock Alphabet Class A",
    category: "stock",
    logoUrl:
      "https://cdn.robinhood.com/ncw_assets/logos/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3.png",
    mainnetAddress: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",
    referencePriceUsd: "319.64",
  },
  MSFT: {
    mockSymbol: "tmMSFT",
    name: "Robyn Testnet Mock Microsoft",
    category: "stock",
    logoUrl:
      "https://cdn.robinhood.com/ncw_assets/logos/0xe93237c50d904957cf27e7b1133b510c669c2e74.png",
    mainnetAddress: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
    referencePriceUsd: "383.25",
  },
  NVDA: {
    mockSymbol: "tmNVDA",
    name: "Robyn Testnet Mock NVIDIA",
    category: "stock",
    logoUrl:
      "https://cdn.robinhood.com/ncw_assets/logos/0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec.png",
    mainnetAddress: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    referencePriceUsd: "208.34",
  },
  SPCX: {
    mockSymbol: "tmSPCX",
    name: "Robyn Testnet Mock SpaceX",
    category: "stock",
    logoUrl: null,
    mainnetAddress: null,
    referencePriceUsd: null,
  },
  SPY: {
    mockSymbol: "tmSPY",
    name: "Robyn Testnet Mock SPDR S&P 500 ETF Trust",
    category: "etf-commodity",
    logoUrl:
      "https://cdn.robinhood.com/ncw_assets/logos/0x117cc2133c37b721f49de2a7a74833232b3b4c0c.png",
    mainnetAddress: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
    referencePriceUsd: "739.22",
  },
  WETH: {
    mockSymbol: "WETH",
    name: "Wrapped Ether",
    category: "crypto",
    logoUrl: "/assets/launchpad/asset-meth.webp",
    mainnetAddress: null,
    referencePriceUsd: null,
  },
};

function v4PoolId(route) {
  if (route.kind !== "uniswap-v4") return null;
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [
        zeroAddress,
        getAddress(route.address),
        route.fee,
        route.tickSpacing,
        getAddress(route.hooks),
      ],
    ),
  );
}

export function buildSchema19AssetCatalog({
  chainId,
  assetRoutes,
  quoter,
  suppliedCatalog,
}) {
  if (chainId === 4663) {
    if (
      suppliedCatalog?.schemaVersion !== 19 ||
      !Array.isArray(suppliedCatalog.assets) ||
      suppliedCatalog.assets.length === 0
    ) {
      throw new Error("Schema-19 Mainnet asset catalog is required");
    }
    return suppliedCatalog;
  }
  if (chainId !== 46630)
    throw new Error("unsupported Schema-19 asset catalog chain");

  const assets = assetRoutes.map((route) => {
    const metadata = TESTNET_ASSETS[route.symbol];
    if (!metadata)
      throw new Error(`unknown Schema-19 Testnet asset: ${route.symbol}`);
    const isWrappedNative = route.kind === "wrapped-native";
    const poolId = v4PoolId(route);
    return {
      symbol: route.symbol,
      mockSymbol: metadata.mockSymbol,
      name: metadata.name,
      category: metadata.category,
      logoUrl: metadata.logoUrl,
      mainnetAddress: metadata.mainnetAddress,
      referencePriceUsd: metadata.referencePriceUsd,
      address: getAddress(route.address),
      chainId,
      decimals: 18,
      verification: isWrappedNative
        ? "robyn-controlled-testnet-dex"
        : "robyn-testnet-mock",
      mockOnly: true,
      route: { kind: route.kind, ready: route.enabled === true },
      ...(poolId
        ? {
            pool: {
              fee: route.fee,
              tickSpacing: route.tickSpacing,
              hooks: getAddress(route.hooks),
              poolId,
              zeroForOne: true,
              quoteAmountNativeWei: "100000000000000",
            },
          }
        : {}),
    };
  });
  const policy = {
    schemaVersion: 19,
    snapshotAt: "2026-08-03T23:06:38.875Z",
    disclosure:
      "Schema-19 Testnet assets are deterministic test fixtures. They are not production Stock Tokens, backed shares, or redeemable securities.",
    policyVersion: "schema19-testnet-assets-v1",
    v4Venue: { quoter: getAddress(quoter) },
    assets,
  };
  return {
    ...policy,
    policyHash: createHash("sha256")
      .update(JSON.stringify(policy))
      .digest("hex"),
  };
}

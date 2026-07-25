import {
  bytesToString,
  getAddress,
  hexToBytes,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
  type PublicClient,
} from "viem";
import { SingleFlightTtlCache } from "./single-flight-cache.js";

export type AssetCategory = "stock" | "etf-commodity" | "crypto" | "custom";
export type AssetVerification =
  | "official-robinhood-current-chain"
  | "robinhood-testnet-faucet-stock"
  | "robyn-testnet-mock"
  | "robyn-controlled-testnet-dex"
  | "robyn-token-list"
  | "unverified-erc20";

export type AssetRoute = {
  kind: "none" | "fixed-testnet" | "uniswap-v3" | "uniswap-v4";
  ready: boolean;
  venue: Address | null;
  poolFee: number | null;
  liquidity: string | null;
  reason: string | null;
};

export type CatalogAsset = {
  chainId: number;
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: string;
  category: AssetCategory;
  logoUrl: string | null;
  verification: AssetVerification;
  mockOnly: boolean;
  disclosure: string | null;
  mainnetAddress: Address | null;
  referencePriceUsd: string | null;
  referencePriceAt: string | null;
  route: AssetRoute;
};

type ManifestAsset = {
  symbol: string;
  mockSymbol?: string;
  name: string;
  category: AssetCategory;
  logoUrl?: string | null;
  mainnetAddress?: Address | null;
  referencePriceUsd?: string | null;
  address: Address;
  chainId: number;
  decimals: number;
  verification: AssetVerification;
  mockOnly: boolean;
  route?: { kind?: AssetRoute["kind"]; ready?: boolean };
};

export type AssetCatalogManifest = {
  schemaVersion: number;
  snapshotAt: string;
  disclosure: string;
  assets: ManifestAsset[];
};

const stringMetadataAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const bytes32MetadataAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const routeRegistryAbi = [
  {
    type: "function",
    name: "routeStatus",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "kind", type: "uint8" },
          { name: "ready", type: "bool" },
          { name: "venue", type: "address" },
          { name: "poolFee", type: "uint24" },
          { name: "liquidity", type: "uint128" },
          { name: "fixedRateX18", type: "uint256" },
          { name: "reason", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
const v4AssetRouterAbi = [
  {
    type: "function",
    name: "routeStatus",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "poolId", type: "bytes32" },
          { name: "liquidity", type: "uint128" },
          { name: "minimumLiquidity", type: "uint128" },
          { name: "maximumNativeInput", type: "uint128" },
          { name: "spotTick", type: "int24" },
          { name: "referenceTick", type: "int24" },
          { name: "maximumReferenceTickDeviation", type: "uint24" },
          { name: "enforceReferencePrice", type: "bool" },
          { name: "verificationClass", type: "bytes32" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
          { name: "ready", type: "bool" },
          { name: "reason", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "quoteNativeToAsset",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint128" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },
] as const;

const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;

function cleanText(value: string, fallback: string) {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return normalized.length > 0 && normalized.length <= 96
    ? normalized
    : fallback;
}

function bytes32Text(value: `0x${string}`, fallback: string) {
  try {
    return cleanText(bytesToString(hexToBytes(value), { size: 32 }), fallback);
  } catch {
    return fallback;
  }
}

function reasonText(value: `0x${string}`) {
  if (/^0x0+$/.test(value)) return null;
  const known = routeReasonLabels.get(value.toLowerCase());
  if (known) return known;
  try {
    const decoded = bytesToString(hexToBytes(value), { size: 32 }).trim();
    return /^[\x20-\x7e]{1,64}$/.test(decoded) ? decoded : "route-unavailable";
  } catch {
    return "route-unavailable";
  }
}

const routeReasonLabels = new Map(
  [
    ["ROUTE_NOT_CONFIGURED", "No funded conversion route"],
    ["ROUTE_DISABLED", "Conversion route is disabled"],
    ["POOL_UNINITIALIZED", "Conversion pool is not initialized"],
    ["INSUFFICIENT_LIQUIDITY", "Conversion pool has insufficient liquidity"],
    [
      "REFERENCE_PRICE_DEVIATION",
      "Conversion price is outside the safety bound",
    ],
  ].map(([reason, label]) => [
    keccak256(stringToHex(reason!)).toLowerCase(),
    label!,
  ]),
);

function routeKind(value: number): AssetRoute["kind"] {
  return value === 1 ? "fixed-testnet" : value === 2 ? "uniswap-v3" : "none";
}

export class AssetCatalogService {
  private readonly byAddress: Map<string, ManifestAsset>;
  private readonly assetCache = new SingleFlightTtlCache<CatalogAsset | null>(
    600_000,
    256,
  );

  constructor(
    private readonly rpcClient: PublicClient,
    private readonly chainId: number,
    private readonly baseAsset: Address,
    private readonly routeRegistry: Address | undefined,
    private readonly manifest: AssetCatalogManifest | undefined,
  ) {
    this.byAddress = new Map(
      (manifest?.assets ?? []).map((asset) => [
        asset.address.toLowerCase(),
        asset,
      ]),
    );
  }

  async list(query = "", category?: string) {
    const needle = query.trim().toLowerCase();
    const assets: Array<CatalogAsset | null> = [];
    const manifestAssets = this.manifest?.assets ?? [];
    for (let offset = 0; offset < manifestAssets.length; offset += 4) {
      assets.push(
        ...(await Promise.all(
          manifestAssets
            .slice(offset, offset + 4)
            .map((asset) => this.resolve(asset.address)),
        )),
      );
    }
    return assets.filter(
      (asset): asset is CatalogAsset =>
        asset !== null &&
        (!category || category === "all" || asset.category === category) &&
        (!needle ||
          asset.symbol.toLowerCase().includes(needle) ||
          asset.name.toLowerCase().includes(needle) ||
          asset.address.toLowerCase().includes(needle)),
    );
  }

  async resolve(value: string): Promise<CatalogAsset | null> {
    if (!isAddress(value)) return null;
    const address = getAddress(value);
    return this.assetCache.get(address.toLowerCase(), () =>
      this.resolveUncached(address),
    );
  }

  private async resolveUncached(
    address: Address,
  ): Promise<CatalogAsset | null> {
    const code = await this.rpcClient.getCode({ address });
    if (!code || code === "0x") return null;
    const known = this.byAddress.get(address.toLowerCase());
    if (known) {
      return {
        chainId: this.chainId,
        address,
        symbol: cleanText(known.mockSymbol ?? known.symbol, "TOKEN"),
        name: cleanText(known.name, "Unnamed token"),
        decimals: known.decimals,
        totalSupply: "0",
        category: known.category,
        logoUrl: known.logoUrl ?? null,
        verification: known.verification,
        mockOnly: known.mockOnly,
        disclosure: known.mockOnly ? (this.manifest?.disclosure ?? null) : null,
        mainnetAddress: known.mainnetAddress ?? null,
        referencePriceUsd: known.referencePriceUsd ?? null,
        referencePriceAt: this.manifest?.snapshotAt ?? null,
        route: await this.readRoute(address, known.route),
      };
    }
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      this.readText(address, "name", "Unnamed token"),
      this.readText(address, "symbol", "TOKEN"),
      this.rpcClient
        .readContract({
          address,
          abi: stringMetadataAbi,
          functionName: "decimals",
        })
        .then(Number)
        .catch(() => 18),
      this.rpcClient
        .readContract({
          address,
          abi: stringMetadataAbi,
          functionName: "totalSupply",
        })
        .catch(() => 0n),
    ]);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
      return null;
    const route = await this.readRoute(address);
    return {
      chainId: this.chainId,
      address,
      symbol: cleanText(symbol, "TOKEN"),
      name: cleanText(name, "Unnamed token"),
      decimals,
      totalSupply: totalSupply.toString(),
      category: "custom",
      logoUrl: null,
      verification: "unverified-erc20",
      mockOnly: false,
      disclosure: null,
      mainnetAddress: null,
      referencePriceUsd: null,
      referencePriceAt: null,
      route,
    };
  }

  async quote(address: Address, amount: bigint) {
    if (!this.routeRegistry || amount <= 0n) return null;
    if (this.baseAsset === zeroAddress) {
      const result = await this.rpcClient.simulateContract({
        address: this.routeRegistry,
        abi: v4AssetRouterAbi,
        functionName: "quoteNativeToAsset",
        args: [address, amount],
      });
      return result.result[0];
    }
    return this.rpcClient.readContract({
      address: this.routeRegistry,
      abi: routeRegistryAbi,
      functionName: "quoteExactInput",
      args: [this.baseAsset, address, amount],
    });
  }

  private async readText(
    address: Address,
    key: "name" | "symbol",
    fallback: string,
  ) {
    try {
      return cleanText(
        await this.rpcClient.readContract({
          address,
          abi: stringMetadataAbi,
          functionName: key,
        }),
        fallback,
      );
    } catch {
      try {
        const value = await this.rpcClient.readContract({
          address,
          abi: bytes32MetadataAbi,
          functionName: key,
        });
        return bytes32Text(value, fallback);
      } catch {
        return fallback;
      }
    }
  }

  private async readRoute(
    outputToken: Address,
    fallback?: ManifestAsset["route"],
  ): Promise<AssetRoute> {
    if (!this.routeRegistry) {
      return {
        kind: "none",
        ready: false,
        venue: null,
        poolFee: null,
        liquidity: null,
        reason: "route-registry-unavailable",
      };
    }
    if (this.baseAsset === zeroAddress) {
      try {
        const status = await this.rpcClient.readContract({
          address: this.routeRegistry,
          abi: v4AssetRouterAbi,
          functionName: "routeStatus",
          args: [outputToken],
        });
        return {
          kind: "uniswap-v4",
          ready: status.ready,
          venue: this.routeRegistry,
          poolFee: status.fee === 0 ? null : status.fee,
          liquidity: status.liquidity.toString(),
          reason: status.ready ? null : reasonText(status.reason),
        };
      } catch {
        const ready = fallback?.ready === true;
        return {
          kind: fallback?.kind ?? "uniswap-v4",
          ready,
          venue: ready ? this.routeRegistry : null,
          poolFee: null,
          liquidity: null,
          reason: ready
            ? "Live route check temporarily unavailable; launch simulation revalidates"
            : "route-read-failed",
        };
      }
    }
    try {
      const status = await this.rpcClient.readContract({
        address: this.routeRegistry,
        abi: routeRegistryAbi,
        functionName: "routeStatus",
        args: [this.baseAsset, outputToken],
      });
      return {
        kind: routeKind(status.kind),
        ready: status.ready,
        venue: status.venue === zeroAddress ? null : status.venue,
        poolFee: status.poolFee === 0 ? null : status.poolFee,
        liquidity: status.kind === 2 ? status.liquidity.toString() : null,
        reason: status.ready ? null : reasonText(status.reason),
      };
    } catch {
      const ready = fallback?.ready === true;
      return {
        kind: fallback?.kind ?? "none",
        ready,
        venue: ready ? this.routeRegistry : null,
        poolFee: null,
        liquidity: null,
        reason: ready
          ? "Live route check temporarily unavailable; launch simulation revalidates"
          : "route-read-failed",
      };
    }
  }
}

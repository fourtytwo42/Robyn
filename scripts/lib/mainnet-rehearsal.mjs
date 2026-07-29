import { encodeAbiParameters, getAddress, keccak256, zeroAddress } from "viem";

const poolKeyParameters = [
  {
    type: "tuple",
    components: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
    ],
  },
];

export function poolIdForRoute(asset, route) {
  return keccak256(
    encodeAbiParameters(poolKeyParameters, [
      {
        currency0: zeroAddress,
        currency1: getAddress(asset),
        fee: Number(route.fee),
        tickSpacing: Number(route.tickSpacing),
        hooks: getAddress(route.hooks),
      },
    ]),
  );
}

export function validateMainnetRehearsalConfig(config, curatedCatalog) {
  const failures = [];
  if (config?.schemaVersion !== 1)
    failures.push("unsupported rehearsal schema");
  if (config?.chainId !== 4663)
    failures.push("rehearsal chain ID must be 4663");
  const venueNames = [
    "poolManager",
    "positionManager",
    "stateView",
    "quoter",
    "universalRouter",
    "permit2",
    "weth",
  ];
  for (const name of venueNames) {
    const entry = config?.venue?.[name];
    try {
      getAddress(entry?.address ?? "");
    } catch {
      failures.push(`invalid ${name} address`);
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(entry?.runtimeCodeHash ?? "")) {
      failures.push(`invalid ${name} runtime hash`);
    }
  }
  const assets = curatedCatalog?.assets ?? [];
  if (assets.length !== config?.expectedStockAssetCount) {
    failures.push(
      "the frozen Stock Token catalog must contain exactly 23 assets",
    );
  }
  const symbols = new Set();
  const addresses = new Set();
  for (const asset of assets) {
    if (!asset.symbol || symbols.has(asset.symbol)) {
      failures.push("duplicate asset symbol");
    }
    symbols.add(asset.symbol);
    try {
      const address = getAddress(asset.mainnetAddress);
      const normalized = address.toLowerCase();
      if (addresses.has(normalized))
        failures.push("duplicate mainnet asset address");
      addresses.add(normalized);
    } catch {
      failures.push(`invalid mainnet address for ${asset.symbol ?? "unknown"}`);
    }
  }
  if (!config?.includeWethRoute)
    failures.push("the production WETH route is missing");
  if (Number(config?.route?.fee) !== 10_000) {
    failures.push("route fee must be 1 percent");
  }
  if (Number(config?.route?.tickSpacing) !== 200) {
    failures.push("route tick spacing must be 200");
  }
  if (config?.route?.hooks !== zeroAddress) {
    failures.push("production basket routes must be hookless");
  }
  if (config?.market?.graduationThresholdNative !== "6000000000000000001") {
    failures.push("production graduation threshold mismatch");
  }
  if (config?.governance?.votingDelaySeconds !== 86_400) {
    failures.push("production voting delay mismatch");
  }
  if (config?.governance?.votingPeriodSeconds !== 259_200) {
    failures.push("production voting period mismatch");
  }
  if (config?.governance?.timelockSeconds !== 172_800) {
    failures.push("production timelock mismatch");
  }
  return failures;
}

export function intendedMainnetAssets(config, curatedCatalog) {
  return [
    ...(curatedCatalog.assets ?? []).map((asset) => ({
      symbol: asset.symbol,
      address: getAddress(asset.mainnetAddress),
      kind: "robinhood-stock-token",
    })),
    {
      symbol: "WETH",
      address: getAddress(config.venue.weth.address),
      kind: "canonical-weth",
    },
  ];
}

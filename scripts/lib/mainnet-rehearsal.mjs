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

export function validateMainnetRehearsalConfig(config, supportPolicy) {
  const failures = [];
  if (config?.schemaVersion !== 14)
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
  if (supportPolicy?.schemaVersion !== 14 || supportPolicy?.chainId !== 4663) {
    failures.push("support policy must be schema 14 on chain 4663");
  }
  const assets = supportPolicy?.candidates ?? [];
  if (
    assets.length !== config?.expectedCandidateCount ||
    assets.length !== 11
  ) {
    failures.push("the support policy must contain exactly 11 candidates");
  }
  const symbols = new Set();
  const addresses = new Set();
  for (const asset of assets) {
    if (!asset.symbol || symbols.has(asset.symbol)) {
      failures.push("duplicate asset symbol");
    }
    symbols.add(asset.symbol);
    try {
      const address = getAddress(asset.address);
      const normalized = address.toLowerCase();
      if (addresses.has(normalized))
        failures.push("duplicate mainnet asset address");
      addresses.add(normalized);
    } catch {
      failures.push(`invalid mainnet address for ${asset.symbol ?? "unknown"}`);
    }
  }
  const requiredSymbols = assets
    .filter((asset) => asset.required)
    .map((asset) => asset.symbol);
  const optionalSymbols = assets
    .filter((asset) => !asset.required)
    .map((asset) => asset.symbol);
  if (
    JSON.stringify(requiredSymbols) !== JSON.stringify(config?.requiredSymbols)
  ) {
    failures.push("required asset symbols do not match the support policy");
  }
  if (
    JSON.stringify(optionalSymbols) !== JSON.stringify(config?.optionalSymbols)
  ) {
    failures.push("optional asset symbols do not match the support policy");
  }
  const executionClasses = new Set(assets.map((asset) => asset.executionClass));
  for (const requiredClass of [
    "canonical-v4-single-hop",
    "direct-native-wrap",
  ]) {
    if (!executionClasses.has(requiredClass)) {
      failures.push(`missing ${requiredClass} candidate`);
    }
  }
  if (
    [...executionClasses].some(
      (executionClass) =>
        !["canonical-v4-single-hop", "direct-native-wrap"].includes(
          executionClass,
        ),
    )
  ) {
    failures.push("support policy contains a non-v4 execution class");
  }
  const weth = assets.find((asset) => asset.symbol === "WETH");
  if (
    !weth ||
    weth.executionClass !== "direct-native-wrap" ||
    getAddress(weth.address) !==
      getAddress(config?.venue?.weth?.address ?? zeroAddress)
  ) {
    failures.push("the production WETH route is missing or inconsistent");
  }
  if (config?.provider !== undefined) {
    failures.push("schema 14 forbids external execution providers");
  }
  if (Number(config?.route?.fee) !== 10_000) {
    failures.push("route fee must be 1 percent");
  }
  if (Number(config?.route?.tickSpacing) !== 200) {
    failures.push("route tick spacing must be 200");
  }
  if (config?.route?.hooks !== zeroAddress) {
    failures.push("production basket routes must be hookless");
  }
  if (config?.market?.initialLaunchMode !== "Paused") {
    failures.push("schema 14 must deploy in Paused launch mode");
  }
  if (config?.safe?.version !== "1.4.1" || config?.safe?.threshold !== 2) {
    failures.push("Safe v1.4.1 threshold-two policy mismatch");
  }
  for (const name of ["proxyFactory", "singleton", "fallbackHandler"]) {
    const entry = config?.safe?.[name];
    try {
      getAddress(entry?.address ?? "");
    } catch {
      failures.push(`invalid Safe ${name} address`);
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(entry?.runtimeCodeHash ?? "")) {
      failures.push(`invalid Safe ${name} runtime hash`);
    }
  }
  const canary = config?.market?.canaryProfile;
  if (
    canary?.targetGraduationNative !== "10000000000000000" ||
    canary?.actualGraduationNative !== "10000000000000000" ||
    canary?.maximumCurvePurchase !== "1000000000000000"
  ) {
    failures.push("canary graduation profile mismatch");
  }
  const production = config?.market?.productionProfile;
  if (
    production?.targetGraduationNative !== "6000000000000000000" ||
    production?.actualGraduationNative !== "6000000000000000001" ||
    production?.maximumCurvePurchase !== "500000000000000000"
  ) {
    failures.push("production graduation profile mismatch");
  }
  const funding = config?.funding;
  if (
    funding?.approvedCeilingWei !== "47072920000000000" ||
    funding?.l1EmergencyReserveWei !== "10000000000000000" ||
    funding?.l2OperationalReserveWei !== "20000000000000000" ||
    funding?.canaryPrincipalWei !== "10000000000000000" ||
    funding?.l2GasHeadroomBps !== 15_000 ||
    funding?.bridgeGasHeadroomBps !== 20_000
  ) {
    failures.push("capital-preserving funding policy mismatch");
  }
  const bridge = config?.bridge;
  if (
    bridge?.method !== "depositEth()" ||
    bridge?.delayedInbox?.address?.toLowerCase() !==
      "0x1a07cc4bd17e0118bdb54d70990d2158abad7a2d" ||
    bridge?.delayedInbox?.runtimeCodeHash?.toLowerCase() !==
      "0x69a469ef198a7f785b09fb0783fe42576faef7635e2d56426ec8746bad638e64" ||
    bridge?.estimateOnlyUntilFundingGatePasses !== true
  ) {
    failures.push("canonical bridge policy mismatch");
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

export function intendedMainnetAssets(config, supportPolicy) {
  const failures = validateMainnetRehearsalConfig(config, supportPolicy);
  if (failures.length > 0) {
    throw new Error(
      `invalid mainnet rehearsal configuration: ${failures.join("; ")}`,
    );
  }
  return (supportPolicy.candidates ?? []).map((asset) => ({
    symbol: asset.symbol,
    address: getAddress(asset.address),
    kind: asset.kind,
    required: Boolean(asset.required),
    executionClass: asset.executionClass,
    maximumNativeInputWei: BigInt(asset.maximumNativeInputWei),
    activation: asset.activation,
  }));
}

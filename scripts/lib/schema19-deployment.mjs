import {
  encodeFunctionData,
  getAddress,
  getContractAddress,
  isAddress,
  parseAbi,
} from "viem";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const SCHEMA19_DEPLOYMENT_SEQUENCE = Object.freeze([
  { label: "assetRouter", nonceOffset: 0, directCreate: true },
  { label: "launchDeployer", nonceOffset: 1, directCreate: true },
  { label: "vaultDeployer", nonceOffset: 2, directCreate: true },
  { label: "launchFactory", nonceOffset: 3, directCreate: true },
  { label: "feeRouter", nonceOffset: 4, directCreate: true },
  { label: "daoRewards", nonceOffset: 5, directCreate: true },
  { label: "maintenance", nonceOffset: 6, directCreate: true },
  { label: "claimsRouter", nonceOffset: 7, directCreate: true },
  { label: "tradeRouter", nonceOffset: 8, directCreate: true },
  { label: "tokenSink", nonceOffset: 9, directCreate: true },
  { label: "oracleHook", nonceOffset: 10, directCreate: false },
  { label: "adapterDeployer", nonceOffset: 11, directCreate: true },
  { label: "lockerDeployer", nonceOffset: 12, directCreate: true },
  { label: "marketDeployer", nonceOffset: 13, directCreate: true },
  { label: "marketFactory", nonceOffset: 14, directCreate: true },
  { label: "bindMaintenance", nonceOffset: 15, directCreate: false },
  { label: "bindDaoDepositor", nonceOffset: 16, directCreate: false },
  { label: "bindDaoReceiver", nonceOffset: 17, directCreate: false },
  { label: "coordinator", nonceOffset: 18, directCreate: true },
]);

export function predictSchema19Deployments({
  deployer,
  startingNonce,
  oracleHook,
}) {
  assert(isAddress(deployer), "invalid Schema-19 deployer");
  assert(
    Number.isSafeInteger(startingNonce) && startingNonce >= 0,
    "invalid starting nonce",
  );
  assert(isAddress(oracleHook), "predicted Schema-19 oracle hook is required");
  const from = getAddress(deployer);
  const transactions = SCHEMA19_DEPLOYMENT_SEQUENCE.map((entry) => {
    const nonce = startingNonce + entry.nonceOffset;
    const predictedAddress = entry.directCreate
      ? getContractAddress({ from, nonce: BigInt(nonce) })
      : entry.label === "oracleHook"
        ? getAddress(oracleHook)
        : null;
    return { ...entry, nonce, predictedAddress };
  });
  const contracts = Object.fromEntries(
    transactions
      .filter((entry) => entry.predictedAddress)
      .map((entry) => [entry.label, entry.predictedAddress]),
  );
  return {
    deployer: from,
    startingNonce,
    endingNonceExclusive: startingNonce + SCHEMA19_DEPLOYMENT_SEQUENCE.length,
    contracts,
    transactions,
  };
}

const routeAbi = parseAbi([
  "function configureRoute(address asset,(uint24 fee,int24 tickSpacing,address hooks,uint128 minimumLiquidity,uint128 maximumNativeInput,int24 referenceTick,uint24 maximumReferenceTickDeviation,bool enforceReferencePrice,bytes32 verificationClass,bool enabled) route)",
  "function configureWrappedNativeRoute(uint128 maximumNativeInput,bool enabled)",
]);

const routeTuple = (route) => ({
  fee: Number(route.fee),
  tickSpacing: Number(route.tickSpacing),
  hooks: getAddress(route.hooks),
  minimumLiquidity: BigInt(route.minimumLiquidity),
  maximumNativeInput: BigInt(route.maximumNativeInput),
  referenceTick: Number(route.referenceTick),
  maximumReferenceTickDeviation: Number(route.maximumReferenceTickDeviation),
  enforceReferencePrice: route.enforceReferencePrice === true,
  verificationClass: route.verificationClass,
  enabled: route.enabled === true,
});

export function buildSchema19RouteConfiguration(routes, wrappedNative) {
  assert(isAddress(wrappedNative), "invalid wrapped native address");
  assert(Array.isArray(routes) && routes.length >= 6, "six routes required");
  const symbols = new Set();
  const assets = [];
  const configurationCalldata = [];
  for (const route of routes) {
    assert(
      typeof route.symbol === "string" && route.symbol,
      "route symbol required",
    );
    assert(!symbols.has(route.symbol), `duplicate route ${route.symbol}`);
    symbols.add(route.symbol);
    assert(isAddress(route.asset), `invalid ${route.symbol} asset`);
    assert(route.enabled === true, `${route.symbol} route must start enabled`);
    const asset = getAddress(route.asset);
    assets.push(asset);
    if (route.kind === "wrapped-native") {
      assert(
        asset === getAddress(wrappedNative),
        "wrapped-native asset mismatch",
      );
      assert(
        BigInt(route.maximumNativeInput) > 0n,
        "wrapped-native cap required",
      );
      configurationCalldata.push(
        encodeFunctionData({
          abi: routeAbi,
          functionName: "configureWrappedNativeRoute",
          args: [BigInt(route.maximumNativeInput), true],
        }),
      );
      continue;
    }
    assert(route.kind === "uniswap-v4", `${route.symbol} route kind rejected`);
    const tuple = routeTuple(route);
    assert(tuple.maximumNativeInput > 0n, `${route.symbol} cap required`);
    assert(
      tuple.minimumLiquidity > 0n,
      `${route.symbol} liquidity floor required`,
    );
    assert(
      /^0x[0-9a-fA-F]{64}$/.test(tuple.verificationClass),
      `${route.symbol} verification class required`,
    );
    configurationCalldata.push(
      encodeFunctionData({
        abi: routeAbi,
        functionName: "configureRoute",
        args: [asset, tuple],
      }),
    );
  }
  assert(
    routes.filter((route) => route.kind === "wrapped-native").length === 1,
    "exactly one wrapped-native route required",
  );
  return { assets, configurationCalldata };
}

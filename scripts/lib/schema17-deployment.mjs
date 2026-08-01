import {
  encodeFunctionData,
  getAddress,
  getContractAddress,
  isAddress,
  parseAbi,
} from "viem";

export const SCHEMA17_DEPLOYMENT_SEQUENCE = Object.freeze([
  { label: "daoToken", directCreate: true },
  { label: "assetRouter", directCreate: true },
  { label: "launchDeployer", directCreate: true },
  { label: "vaultDeployer", directCreate: true },
  { label: "launchFactory", directCreate: true },
  { label: "feeRouter", directCreate: true },
  { label: "tokenSink", directCreate: true },
  { label: "oracleHook", directCreate: false },
  { label: "adapterDeployer", directCreate: true },
  { label: "lockerDeployer", directCreate: true },
  { label: "marketDeployer", directCreate: true },
  { label: "marketFactory", directCreate: true },
  { label: "coordinator", directCreate: true },
  { label: "timelock", directCreate: true },
  { label: "governor", directCreate: true },
]);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function predictSchema17Deployments({
  deployer,
  startingNonce,
  oracleHook,
}) {
  assert(isAddress(deployer), "invalid Schema-17 deployer");
  assert(
    Number.isSafeInteger(startingNonce) && startingNonce >= 0,
    "invalid starting nonce",
  );
  assert(isAddress(oracleHook), "predicted oracle hook is required");
  const from = getAddress(deployer);
  const transactions = [];
  const contracts = {};
  for (const [offset, entry] of SCHEMA17_DEPLOYMENT_SEQUENCE.entries()) {
    const nonce = startingNonce + offset;
    const address = entry.directCreate
      ? getContractAddress({ from, nonce: BigInt(nonce) })
      : getAddress(oracleHook);
    contracts[entry.label] = address;
    transactions.push({ ...entry, nonce, predictedAddress: address });
  }
  return {
    deployer: from,
    startingNonce,
    endingNonceExclusive: startingNonce + SCHEMA17_DEPLOYMENT_SEQUENCE.length,
    contracts,
    transactions,
  };
}

const assetRouterAbi = parseAbi([
  "function resumeConversions()",
  "function configureRoute(address asset,(uint24 fee,int24 tickSpacing,address hooks,uint128 minimumLiquidity,uint128 maximumNativeInput,int24 referenceTick,uint24 maximumReferenceTickDeviation,bool enforceReferencePrice,bytes32 verificationClass,bool enabled) route)",
  "function configureWrappedNativeRoute(uint128 maximumNativeInput,bool enabled)",
]);
const feeRouterAbi = parseAbi(["function setPaused(bool paused)"]);
const coordinatorAbi = parseAbi([
  "function setCanaryMode(address launcher)",
  "function setPublicMode()",
]);
const marketFactoryAbi = parseAbi([
  "function setGraduationProfile(uint256 targetGraduationNative,uint256 maximumCurvePurchase)",
]);

const routeCall = (label, target, functionName, args) => ({
  label,
  target: getAddress(target),
  valueWei: "0",
  data: encodeFunctionData({
    abi:
      functionName === "setPaused"
        ? feeRouterAbi
        : functionName === "setCanaryMode" || functionName === "setPublicMode"
          ? coordinatorAbi
          : functionName === "setGraduationProfile"
            ? marketFactoryAbi
            : assetRouterAbi,
    functionName,
    args,
  }),
});

export function buildSchema17BootstrapCalls({
  contracts,
  deployer,
  routes,
  wrappedNativeCanaryCapWei,
  wrappedNativePublicCapWei,
}) {
  for (const key of [
    "assetRouter",
    "feeRouter",
    "coordinator",
    "marketFactory",
  ]) {
    assert(isAddress(contracts?.[key]), `missing Schema-17 ${key}`);
  }
  assert(isAddress(deployer), "invalid bootstrap deployer");
  assert(
    Array.isArray(routes) && routes.length > 0,
    "at least one qualified stock route is required",
  );
  const symbols = new Set();
  for (const route of routes) {
    assert(
      typeof route.symbol === "string" && route.symbol !== "",
      "route symbol is required",
    );
    assert(!symbols.has(route.symbol), `duplicate route ${route.symbol}`);
    symbols.add(route.symbol);
    assert(isAddress(route.asset), `invalid ${route.symbol} asset`);
    assert(
      route.canary && route.public,
      `${route.symbol} requires canary and public route snapshots`,
    );
    assert(
      route.canary.enabled === true && route.public.enabled === true,
      `${route.symbol} route must be enabled in both plans`,
    );
    assert(
      BigInt(route.public.maximumNativeInput) * 10n ===
        BigInt(route.canary.maximumNativeInput),
      `${route.symbol} public cap must equal 10% of the qualified canary cap`,
    );
  }
  assert(
    BigInt(wrappedNativePublicCapWei) * 10n ===
      BigInt(wrappedNativeCanaryCapWei),
    "WETH public cap must equal 10% of the qualified canary cap",
  );
  const first = [
    routeCall(
      "resume-asset-conversions",
      contracts.assetRouter,
      "resumeConversions",
      [],
    ),
    routeCall("resume-fee-conversions", contracts.feeRouter, "setPaused", [
      false,
    ]),
    ...routes.map((route) =>
      routeCall(
        `enable-${route.symbol}-canary-route`,
        contracts.assetRouter,
        "configureRoute",
        [getAddress(route.asset), route.canary],
      ),
    ),
    routeCall(
      "enable-WETH-canary-route",
      contracts.assetRouter,
      "configureWrappedNativeRoute",
      [BigInt(wrappedNativeCanaryCapWei), true],
    ),
    routeCall("enter-canary-mode", contracts.coordinator, "setCanaryMode", [
      getAddress(deployer),
    ]),
  ];
  const second = [
    routeCall(
      "install-production-profile",
      contracts.marketFactory,
      "setGraduationProfile",
      [6n * 10n ** 18n, 5n * 10n ** 17n],
    ),
    ...routes.map((route) =>
      routeCall(
        `install-${route.symbol}-public-cap`,
        contracts.assetRouter,
        "configureRoute",
        [getAddress(route.asset), route.public],
      ),
    ),
    routeCall(
      "install-WETH-public-cap",
      contracts.assetRouter,
      "configureWrappedNativeRoute",
      [BigInt(wrappedNativePublicCapWei), true],
    ),
    routeCall("enter-public-mode", contracts.coordinator, "setPublicMode", []),
  ];
  return [first, second];
}

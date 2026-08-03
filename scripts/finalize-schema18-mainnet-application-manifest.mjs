#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { decodeFunctionData, getAddress } from "viem";
import { buildSchema18IndexingPolicy } from "./lib/schema18-indexing-policy.mjs";

const [baselineArg, lifecycleArg, gate1Arg, postdeploymentArg, outputArg] = process.argv.slice(2);
if (![baselineArg, lifecycleArg, gate1Arg, postdeploymentArg, outputArg].every(Boolean)) {
  throw new Error(
    "usage: finalize-schema18-mainnet-application-manifest.mjs <schema18-testnet.json> <lifecycle.json> <gate1.json> <postdeployment.json> <output.json>",
  );
}
const [baselinePath, lifecyclePath, gate1Path, postdeploymentPath, outputPath] = [
  baselineArg,
  lifecycleArg,
  gate1Arg,
  postdeploymentArg,
  outputArg,
].map((value) => path.resolve(value));
const [baselineRaw, lifecycleRaw, gate1Raw, postdeploymentRaw] = await Promise.all(
  [baselinePath, lifecyclePath, gate1Path, postdeploymentPath].map((file) => readFile(file, "utf8")),
);
const baseline = JSON.parse(baselineRaw);
const lifecycle = JSON.parse(lifecycleRaw);
const gate1 = JSON.parse(gate1Raw);
const postdeployment = JSON.parse(postdeploymentRaw);
const CONTRACT_SHA = "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
const DEPLOYMENT_APPLICATION_SHA = "8327b250122cd9050a7da6a44e12859e3cf521aa";
const APPLICATION_SHA = "5ea50ed836d81416a7a6a32c8078a864fca28d0b";
const INDEXING_POLICY_HASH = "5e92d61940f39b05f7b61273b0a2d190d77cf204369a224822b098a4f5ca01e1";
if (
  baseline.schemaVersion !== 18 ||
  baseline.chainId !== 46630 ||
  lifecycle.schemaVersion !== 18 ||
  lifecycle.chainId !== 4663 ||
  lifecycle.releaseSha !== CONTRACT_SHA ||
  lifecycle.applicationReleaseSha !== DEPLOYMENT_APPLICATION_SHA ||
  gate1.contractReleaseSha !== CONTRACT_SHA ||
  gate1.applicationReleaseSha !== DEPLOYMENT_APPLICATION_SHA ||
  postdeployment.schemaVersion !== 18 ||
  postdeployment.chainId !== 4663
) {
  throw new Error("Schema-18 Mainnet application-manifest identity mismatch");
}

// Keep this operational finalizer independent of the Solidity build cache. The
// release process freezes the qualified contract closure separately; these two
// ABI fragments are the only calls decoded from the sealed bootstrap plan.
const ROUTER_CONFIGURATION_ABI = [
  {
    type: "function",
    name: "configureRoute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      {
        name: "route_",
        type: "tuple",
        components: [
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
          { name: "minimumLiquidity", type: "uint128" },
          { name: "maximumNativeInput", type: "uint128" },
          { name: "referenceTick", type: "int24" },
          { name: "maximumReferenceTickDeviation", type: "uint24" },
          { name: "enforceReferencePrice", type: "bool" },
          { name: "verificationClass", type: "bytes32" },
          { name: "enabled", type: "bool" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "configureWrappedNativeRoute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "maximumNativeInput", type: "uint128" },
      { name: "enabled", type: "bool" },
    ],
    outputs: [],
  },
];
const publicRoutes = new Map();
for (const call of lifecycle.bootstrap.steps[1].calls.filter((item) => item.label.includes("public-cap"))) {
  const symbol = call.label.replace("install-", "").replace("-public-cap", "");
  const decoded = decodeFunctionData({ abi: ROUTER_CONFIGURATION_ABI, data: call.data });
  if (decoded.functionName === "configureRoute") {
    const [asset, route] = decoded.args;
    publicRoutes.set(symbol, {
      symbol,
      address: getAddress(asset),
      poolId: lifecycle.routes.find((item) => item.symbol === symbol)?.poolId ?? null,
      fee: Number(route.fee),
      tickSpacing: Number(route.tickSpacing),
      hook: getAddress(route.hooks),
      minimumLiquidity: route.minimumLiquidity.toString(),
      maximumNativeInput: route.maximumNativeInput.toString(),
      referenceTick: Number(route.referenceTick),
      maximumReferenceTickDeviation: Number(route.maximumReferenceTickDeviation),
      enforceReferencePrice: route.enforceReferencePrice,
      verificationClass: route.verificationClass,
      routeKind: "uniswap-v4",
      verification: "robinhood-mainnet-real-liquidity",
      provenance: "schema18-qualified-mainnet-v4-pool",
      enabled: true,
      disabledReason: null,
    });
  } else if (decoded.functionName === "configureWrappedNativeRoute") {
    publicRoutes.set(symbol, {
      symbol,
      address: getAddress(lifecycle.contracts.wrappedNative),
      poolId: null,
      fee: 0,
      tickSpacing: 0,
      hook: "0x0000000000000000000000000000000000000000",
      minimumLiquidity: "0",
      maximumNativeInput: decoded.args[0].toString(),
      referenceTick: 0,
      maximumReferenceTickDeviation: 0,
      enforceReferencePrice: false,
      verificationClass: null,
      routeKind: "wrapped-native",
      verification: "canonical-weth-runtime",
      provenance: "schema18-direct-wrap",
      enabled: decoded.args[1],
      disabledReason: null,
    });
  } else {
    throw new Error(`unexpected Public route function ${decoded.functionName}`);
  }
}
if (publicRoutes.size !== 6 || [...publicRoutes.values()].some((route) => !route.enabled)) {
  throw new Error("qualified Mainnet Public route set is incomplete");
}

const testnetBySymbol = new Map(baseline.assetRoutes.map((route) => [route.symbol, route]));
const assetRoutes = [...publicRoutes.values()].map((route) => ({
  ...(testnetBySymbol.get(route.symbol) ?? {}),
  ...route,
  mockSymbol: undefined,
  liquidityLocker: undefined,
  seedTransaction: undefined,
  assetCreationTransaction: undefined,
  maximumProtectedRouteSlippageBps: route.routeKind === "wrapped-native" ? 0 : 100,
}));
const routeAddressBySymbol = new Map(assetRoutes.map((route) => [route.symbol, route.address]));
const productionNames = new Map(
  assetRoutes.map((route) => [
    route.symbol,
    route.name ?? (route.symbol === "WETH" ? "Wrapped Ether" : route.symbol),
  ]),
);
const assetCatalog = {
  ...baseline.assetCatalog,
  schemaVersion: 18,
  chainId: 4663,
  disclosure:
    "Schema-18 Mainnet uses individually qualified Robinhood Chain assets and canonical WETH. External token availability and issuer terms remain outside Sherwood Forest control.",
  assets: baseline.assetCatalog.assets
    .filter((asset) => routeAddressBySymbol.has(asset.symbol))
    .map((asset) => ({
      ...asset,
      address: routeAddressBySymbol.get(asset.symbol),
      name: productionNames.get(asset.symbol),
      mock: false,
      mockOnly: false,
      network: "robinhood-mainnet",
      verification:
        asset.symbol === "WETH"
          ? "canonical-weth-runtime"
          : "robinhood-mainnet-token-runtime-and-v4-route",
      disclosure:
        "Qualified for the sealed Robinhood Mainnet release; route availability is rechecked before activation.",
    })),
};
const contracts = {
  ...baseline.contracts,
  ...lifecycle.contracts,
  conversionRouter: lifecycle.contracts.assetRouter,
  routeRegistry: lifecycle.contracts.assetRouter,
  launchFactory: lifecycle.contracts.launchFactory,
  factory: lifecycle.contracts.launchFactory,
  feeRouter: lifecycle.contracts.protocolFeeRouter,
  coordinator: lifecycle.contracts.atomicLaunchCoordinator,
  guardian: lifecycle.guardianSafe,
  rewardAssets: assetRoutes.map((route) => route.address),
};
const runtimeCodeHashes = Object.fromEntries(
  gate1.runtimeIdentities.map((identity) => [
    identity.name === "existingSafe" ? "guardianSafe" : identity.name,
    identity.name === "timelock"
      ? postdeployment.timelock.rawLiveHash
      : identity.runtimeCodeHash,
  ]),
);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
// The qualified scoped policy permanently retains the original Schema-18
// factory root for its historical logs. Runtime reads use launchFactory via
// contracts.factory, while this policy-only alias preserves the sealed 15-root
// ingestion closure.
const indexingPolicy = buildSchema18IndexingPolicy({
  schemaVersion: 18,
  contracts: {
    ...contracts,
    factory: baseline.contracts.factory,
  },
});
if (indexingPolicy.policyHash !== INDEXING_POLICY_HASH) {
  throw new Error(
    `Schema-18 Mainnet indexing-policy mismatch: ${indexingPolicy.policyHash}`,
  );
}
const result = {
  ...baseline,
  schemaVersion: 18,
  chainId: 4663,
  environment: "robinhood-mainnet",
  releaseSha: CONTRACT_SHA,
  gitCommit: CONTRACT_SHA,
  contractReleaseSha: CONTRACT_SHA,
  applicationReleaseSha: APPLICATION_SHA,
  venueProvenance: "qualified-robinhood-mainnet-uniswap-v4-and-canonical-weth",
  deployer: lifecycle.deployer,
  guardianSafe: lifecycle.guardianSafe,
  guardian: lifecycle.guardianSafe,
  governance: lifecycle.governance,
  bootstrap: lifecycle.bootstrap,
  authorization: {
    additionalBridgeAuthorized: false,
    publicActivationAuthorized: false,
    applicationWritesAuthorized: false,
  },
  deploymentBlock: postdeployment.deploymentBlock,
  contracts,
  indexingPolicy,
  runtimeCodeHashes,
  deploymentTransactions: {},
  configurationTransactions: [],
  assetRoutes,
  routes: assetRoutes.map((route) => ({ symbol: route.symbol, asset: route.address })),
  assetCatalog,
  governanceProfile: "schema18-hour-governance-mainnet",
  launchControl: {
    initialMode: "Public",
    canaryLauncher: lifecycle.deployer,
    guardianAuthority: "pause-cancel-disable-only",
    governorAuthority: "timelock-only-after-bootstrap",
    bootstrapFinalized: true,
    unanimousTimelockRequired: true,
  },
  dao: {
    ...baseline.dao,
    rewardStreamDurationSeconds: 3600,
    governance: {
      profile: "schema18-hour-governance-mainnet",
      votingDelaySeconds: lifecycle.governance.votingDelaySeconds,
      votingPeriodSeconds: lifecycle.governance.votingPeriodSeconds,
      timelockSeconds: lifecycle.governance.timelockDelaySeconds,
      quorumBps: lifecycle.governance.quorumBps,
      proposalThresholdBps: lifecycle.governance.proposalThresholdBps,
      bootstrapWindowSeconds: lifecycle.governance.bootstrapWindowSeconds,
      bootstrapPlanHashes: lifecycle.governance.bootstrapPlanHashes,
      unanimousTimelockRequired: lifecycle.governance.unanimousTimelockRequired,
    },
  },
  rewardStreams: {
    ...baseline.rewardStreams,
    launchTokenDurationSeconds: 3600,
    daoDurationSeconds: 3600,
    creatorDurationSeconds: 3600,
    release: "rolling-linear-one-hour",
  },
  creatorRewards: {
    ...baseline.creatorRewards,
    allocation: "assigned-at-fee-intake-and-unlocked-over-one-hour",
  },
  initialState: {
    launchMode: "Public",
    assetConversionsPaused: false,
    feeConversionsPaused: false,
    applicationWritesEnabled: true,
  },
  deploymentEvidence: {
    gate1ManifestSha256: sha256(gate1Raw),
    lifecycleManifestSha256: sha256(lifecycleRaw),
    postdeploymentVerificationSha256: sha256(postdeploymentRaw),
    qualifiedBaselineSha256: sha256(baselineRaw),
  },
};
const rendered = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(outputPath, rendered, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `${JSON.stringify({
    output: outputPath,
    deploymentBlock: result.deploymentBlock,
    routes: assetRoutes.length,
    sha256: sha256(rendered),
  })}\n`,
);

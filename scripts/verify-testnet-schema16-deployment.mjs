#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
} from "viem";

const manifestPath =
  process.argv.find((argument) => argument.endsWith(".json")) ??
  "deployments/46630-v4-schema16.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const rpcUrl =
  process.env.ROBYN_TESTNET_RPC_URL ??
  "https://rpc.testnet.chain.robinhood.com";
const client = createPublicClient({ transport: http(rpcUrl) });
const checks = [];
const failures = [];

function check(condition, label, details = {}) {
  checks.push({ label, ok: Boolean(condition), ...details });
  if (!condition) failures.push(label);
}

async function artifactAbi(name) {
  return JSON.parse(
    await readFile(
      `packages/contracts/out/${name}.sol/${name}.json`,
      "utf8",
    ),
  ).abi;
}

async function read(address, abi, functionName, args = []) {
  return client.readContract({ address, abi, functionName, args });
}

const contracts = Object.fromEntries(
  Object.entries(manifest.contracts ?? {})
    .filter(
      ([, value]) =>
        typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value),
    )
    .map(([key, value]) => [key, getAddress(value)]),
);
for (const key of [
  "assetRouter",
  "atomicLaunchCoordinator",
  "daoToken",
  "governor",
  "guardian",
  "launchFactory",
  "marketFactory",
  "oracleHook",
  "protocolFeeRouter",
  "timelock",
  "tokenSink",
]) {
  check(Boolean(contracts[key]), `manifest contains ${key}`);
}
if (failures.length) {
  console.log(JSON.stringify({ manifestPath, checks, failures }, null, 2));
  process.exit(1);
}

check((await client.getChainId()) === 46630, "RPC chain ID is 46630");
check(manifest.chainId === 46630, "manifest chain ID is 46630");
check(manifest.schemaVersion === 16, "deployment manifest schema is v15");
check(
  manifest.liquidityVenue === "uniswap-v4",
  "manifest selects Uniswap v4",
);
check(
  manifest.launchControl?.initialMode === "Paused",
  "manifest freezes Paused initial launch mode",
);

for (const [key, frozenHash] of Object.entries(
  manifest.runtimeCodeHashes ?? {},
)) {
  if (!contracts[key] || !frozenHash) continue;
  const code = await client.getCode({ address: contracts[key] });
  check(code !== "0x", `${key} has runtime code`);
  check(
    code !== "0x" && keccak256(code) === frozenHash,
    `${key} runtime hash matches manifest`,
  );
}
for (const [key, transactionHash] of Object.entries(
  manifest.deploymentTransactions ?? {},
)) {
  if (!transactionHash) continue;
  const receipt = await client.getTransactionReceipt({
    hash: transactionHash,
  });
  check(receipt.status === "success", `${key} deployment succeeded`);
}
for (const [index, transactionHash] of (
  manifest.configurationTransactions ?? []
).entries()) {
  const receipt = await client.getTransactionReceipt({
    hash: transactionHash,
  });
  check(
    receipt.status === "success",
    `configuration transaction ${index + 1} succeeded`,
  );
}

const coordinatorAbi = await artifactAbi("RobynV4LaunchCoordinatorV6");
const marketFactoryAbi = await artifactAbi("RobynV4MarketFactory");
const launchFactoryAbi = await artifactAbi("RobynNativeLaunchFactoryV4");
const feeRouterAbi = await artifactAbi("RobynNativeProtocolFeeRouterV4");
const assetRouterAbi = await artifactAbi("RobynV4AssetRouter");
const hookAbi = await artifactAbi("RobynV4FeeAndPhaseHook");

check(
  (await read(
    contracts.atomicLaunchCoordinator,
    coordinatorAbi,
    "launchMode",
  )) === 0,
  "coordinator remains Paused",
);
check(
  getAddress(
    await read(
      contracts.atomicLaunchCoordinator,
      coordinatorAbi,
      "canaryLauncher",
    ),
  ) === getAddress("0x0000000000000000000000000000000000000000"),
  "canary launcher is unset while Paused",
);
check(
  getAddress(
    await read(
      contracts.atomicLaunchCoordinator,
      coordinatorAbi,
      "governor",
    ),
  ) === contracts.timelock,
  "Timelock governs launch activation",
);
check(
  getAddress(
    await read(
      contracts.atomicLaunchCoordinator,
      coordinatorAbi,
      "guardian",
    ),
  ) === contracts.guardian,
  "coordinator guardian matches manifest",
);
check(
  getAddress(
    await read(contracts.marketFactory, marketFactoryAbi, "governor"),
  ) === contracts.timelock,
  "Timelock governs graduation profiles",
);
check(
  getAddress(
    await read(contracts.launchFactory, launchFactoryAbi, "coordinator"),
  ) === contracts.atomicLaunchCoordinator,
  "launch factory coordinator is bound",
);
check(
  getAddress(
    await read(contracts.marketFactory, marketFactoryAbi, "coordinator"),
  ) === contracts.atomicLaunchCoordinator,
  "market factory coordinator is bound",
);
check(
  getAddress(
    await read(contracts.protocolFeeRouter, feeRouterAbi, "coordinator"),
  ) === contracts.atomicLaunchCoordinator,
  "fee router coordinator is bound",
);
check(
  getAddress(
    await read(contracts.assetRouter, assetRouterAbi, "launchRegistrar"),
  ) === contracts.marketFactory,
  "asset-router launch registrar is bound",
);
check(
  getAddress(await read(contracts.oracleHook, hookAbi, "registrar")) ===
    contracts.marketFactory,
  "phase hook registrar is bound",
);

const profile = await read(
  contracts.marketFactory,
  marketFactoryAbi,
  "currentGraduationProfile",
);
const profileManifest = manifest.graduationProfiles?.current;
check(profile.version === 1n, "initial profile version is one");
check(
  profile.targetGraduationNative === 10_000_000_000_000_000n,
  "initial target is 0.01 ETH",
);
check(
  profile.maximumCurvePurchase === 1_000_000_000_000_000n,
  "initial maximum purchase is 0.001 ETH",
);
check(
  profile.actualGraduationNative >= profile.targetGraduationNative,
  "derived actual threshold meets target",
);
check(
  profileManifest?.version === profile.version.toString() &&
    profileManifest?.targetGraduationNative ===
      profile.targetGraduationNative.toString() &&
    profileManifest?.actualGraduationNative ===
      profile.actualGraduationNative.toString() &&
    profileManifest?.maximumCurvePurchase ===
      profile.maximumCurvePurchase.toString() &&
    profileManifest?.initialVirtualNativeReserve ===
      profile.initialVirtualNativeReserve.toString() &&
    profileManifest?.terminalNativePerTokenX18 ===
      profile.terminalNativePerTokenX18.toString() &&
    profileManifest?.terminalSqrtPriceX96 ===
      profile.terminalSqrtPriceX96.toString(),
  "manifest current profile matches live derivation",
);
const encodedProfile = encodeAbiParameters(
  [
    { type: "uint64" },
    { type: "uint256" },
    { type: "uint256" },
    { type: "uint256" },
    { type: "uint256" },
    { type: "uint256" },
    { type: "uint160" },
  ],
  [
    profile.version,
    profile.targetGraduationNative,
    profile.actualGraduationNative,
    profile.maximumCurvePurchase,
    profile.initialVirtualNativeReserve,
    profile.terminalNativePerTokenX18,
    profile.terminalSqrtPriceX96,
  ],
);
check(
  (await read(
    contracts.marketFactory,
    marketFactoryAbi,
    "currentGraduationProfileHash",
  )) === keccak256(encodedProfile),
  "live graduation profile hash is canonical",
);
check(
  manifest.graduationProfiles?.production?.targetGraduationNative ===
    "6000000000000000000" &&
    manifest.graduationProfiles?.production?.maximumCurvePurchase ===
      "500000000000000000",
  "manifest freezes the governed production profile",
);

const routes = manifest.assetRoutes ?? [];
check(routes.length === 11, "manifest contains ten v4 routes and direct WETH");
check(
  routes.filter((route) => route.routeKind === "uniswap-v4").length === 10,
  "ten asset routes are Uniswap v4 single-hop",
);
check(
  routes.filter((route) => route.routeKind === "wrapped-native").length === 1,
  "one route is direct wrapped native",
);
check(
  !/(pinned-adapter|provider|priceGuard|adapterRuntimeHash|quoteExpiry)/i.test(
    JSON.stringify(routes),
  ),
  "route manifest contains no external execution-adapter surface",
);

for (const route of routes) {
  const execution = await read(
    contracts.assetRouter,
    assetRouterAbi,
    "executionRouteStatus",
    [getAddress(route.address)],
  );
  check(
    execution.runtimeVerified,
    `${route.symbol} route runtime is verified`,
  );
  check(
    execution.enabled === Boolean(route.enabled),
    `${route.symbol} enabled state matches manifest`,
  );
  check(
    execution.kind === (route.routeKind === "wrapped-native" ? 2 : 1),
    `${route.symbol} route kind is v4-only`,
  );
}

console.log(
  JSON.stringify(
    {
      manifest: manifestPath,
      checkedAt: new Date().toISOString(),
      count: checks.length,
      checks,
      failures,
    },
    null,
    2,
  ),
);
if (failures.length) process.exit(1);

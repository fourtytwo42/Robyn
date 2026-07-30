#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { createPublicClient, getAddress, http, keccak256 } from "viem";

const manifestPath = process.argv.find((argument) => argument.endsWith(".json")) ??
  "deployments/46630-v4.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const venueManifest = JSON.parse(
  await readFile("deployments/46630-uniswap-v4-shared.json", "utf8"),
);
const rpcUrl = process.env.ROBYN_TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const client = createPublicClient({ transport: http(rpcUrl) });
const isPausedSchema = manifest.schemaVersion >= 14;
const schemaLabel = `Schema-${manifest.schemaVersion}`;
const checks = [];
const failures = [];

function check(condition, label, details = {}) {
  checks.push({ label, ok: Boolean(condition), ...details });
  if (!condition) failures.push(label);
}

async function artifactAbi(name, dependency = false) {
  const path = dependency
    ? `node_modules/@uniswap/v4-periphery/foundry-out/${name}.sol/${name}.json`
    : `packages/contracts/out/${name}.sol/${name}.json`;
  return JSON.parse(await readFile(path, "utf8")).abi;
}

const contracts = Object.fromEntries(
  Object.entries(manifest.contracts)
    .filter(
      ([, value]) =>
        typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value),
    )
    .map(([key, value]) => [key, getAddress(value)]),
);
const requiredContracts = [
  "assetRouter",
  "atomicLaunchCoordinator",
  "daoToken",
  "governor",
  "launchDeployer",
  "vaultDeployer",
  "launchFactory",
  "marketFactory",
  "oracleHook",
  "poolManager",
  "protocolFeeRouter",
  "stateView",
  "testAssetLiquidityLocker",
  "timelock",
  "tokenSink",
  "universalRouter",
];
for (const key of requiredContracts) {
  check(Boolean(contracts[key]), `manifest contains ${key}`);
}
if (failures.length > 0) {
  console.log(
    JSON.stringify(
      {
        manifest: manifestPath,
        checkedAt: new Date().toISOString(),
        checks,
        failures,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
check(await client.getChainId() === 46630, "RPC chain ID is 46630");
check(manifest.chainId === 46630, "manifest chain ID is 46630");
check(manifest.liquidityVenue === "uniswap-v4", "manifest selects Uniswap v4");
check(
  manifest.venueProvenance === "shared-unlisted-robinhood-testnet-uniswap-v4-mirror",
  "unlisted venue disclosure is exact",
);
check(isPausedSchema, "deployment manifest is a paused launch-control schema");
check(
  manifest.kingOfForestPolicy?.version === "forest-v1" &&
    manifest.kingOfForestPolicy?.activationBlock === manifest.deploymentBlock &&
    manifest.kingOfForestPolicy?.progressThresholdBps === 5_000 &&
    manifest.kingOfForestPolicy?.minimumUniqueTraders === 10,
  "King of the Forest policy is top-level and activation-bound",
);
check(
  manifest.assetCatalog?.kingOfForestPolicy === undefined,
  "asset catalog does not contain a misplaced King policy",
);
check(
  contracts.universalRouter ===
    getAddress(venueManifest.contracts.universalRouter.address),
  "Universal Router matches the frozen shared-v4 venue",
);
check(
  (await client.getCode({ address: contracts.universalRouter })) !== "0x",
  "Universal Router has runtime code",
);
check(
  manifest.governanceProfile === "robinhood-testnet-short-assurance",
  "manifest selects the shortened testnet assurance governance profile",
);

for (const [key, address] of Object.entries(contracts)) {
  if (!(key in (manifest.runtimeCodeHashes ?? {}))) continue;
  const code = await client.getCode({ address });
  check(code && code !== "0x", `${key} has runtime code`, {
    runtimeCodeHash: code && code !== "0x" ? keccak256(code) : null,
  });
  const frozenHash = manifest.runtimeCodeHashes?.[key];
  if (frozenHash) {
    check(keccak256(code) === frozenHash, `${key} runtime hash matches manifest`);
  }
}

for (const [key, transactionHash] of Object.entries(manifest.deploymentTransactions ?? {})) {
  if (!transactionHash) continue;
  const receipt = await client.getTransactionReceipt({ hash: transactionHash });
  check(receipt.status === "success", `${key} deployment transaction succeeded`);
  if (key in contracts && key !== "oracleHook") {
    check(
      receipt.contractAddress && getAddress(receipt.contractAddress) === contracts[key],
      `${key} deployment transaction created the manifest address`,
    );
  }
}
const configurationTransactions = manifest.configurationTransactions ?? [];
check(configurationTransactions.length >= 20, "all configuration transactions are frozen");
check(
  new Set(configurationTransactions).size === configurationTransactions.length,
  "configuration transactions contain no duplicates",
);
for (const [index, transactionHash] of configurationTransactions.entries()) {
  const receipt = await client.getTransactionReceipt({ hash: transactionHash });
  check(receipt.status === "success", `configuration transaction ${index + 1} succeeded`);
}
if (isPausedSchema) {
  check(
    !manifest.deploymentTransactions?.genesis && manifest.genesis == null,
    `${schemaLabel} paused deployment contains no genesis launch transaction`,
  );
} else {
  check(
    manifest.deploymentTransactions?.genesis === manifest.genesis?.transactionHash,
    "genesis transaction is frozen consistently",
  );
}

const abis = {
  stateView: await artifactAbi("StateView", true),
  daoToken: await artifactAbi("RobynDaoToken"),
  timelock: await artifactAbi("TimelockController"),
  governor: await artifactAbi("RobynTestnetGovernor"),
  assetRouter: await artifactAbi("RobynV4AssetRouter"),
  testAssetLiquidityLocker: await artifactAbi("RobynV4TestAssetLiquidityLocker"),
  launchDeployer: await artifactAbi("RobynNativeLaunchDeployerV4"),
  vaultDeployer: await artifactAbi("RobynNativeVaultDeployerV4"),
  launchFactory: await artifactAbi("RobynNativeLaunchFactoryV4"),
  feeRouter: await artifactAbi("RobynNativeProtocolFeeRouterV4"),
  hook: await artifactAbi("RobynV4FeeAndPhaseHook"),
  tokenSink: await artifactAbi("RobynTokenSink"),
  adapterDeployer: await artifactAbi("RobynV4AdapterDeployer"),
  lockerDeployer: await artifactAbi("RobynV4LockerDeployer"),
  marketDeployer: await artifactAbi("RobynV4MarketDeployer"),
  marketFactory: await artifactAbi("RobynV4MarketFactory"),
  coordinator: await artifactAbi("RobynV4LaunchCoordinatorV6"),
  market: await artifactAbi("RobynV4BondingCurveMarket"),
  adapter: await artifactAbi("RobynV4GraduationAdapter"),
  token: await artifactAbi("RobynLaunchToken"),
  vault: await artifactAbi("RobynNativeBasketVaultV2"),
};

async function read(address, abi, functionName, args = []) {
  return client.readContract({ address, abi, functionName, args });
}

const assetRoutes = manifest.assetRoutes ?? [];
const mockRoutes = assetRoutes.filter(
  (route) =>
    route.verification === "robyn-testnet-mock" ||
    route.verification === "robyn-controlled-testnet-dex",
);
const v4Routes = assetRoutes.filter(
  (route) => ["uniswap-v4", "canonical-v4-single-hop"].includes(route.routeKind ?? "uniswap-v4"),
);
const wrappedNativeRoutes = assetRoutes.filter(
  (route) => route.routeKind === "wrapped-native",
);
check(assetRoutes.length === 11, "all 11 schema-14 candidate routes are frozen");
check(mockRoutes.length === 11, "all schema-14 Testnet routes are explicitly synthetic");
check(v4Routes.length === 10, "ten Uniswap v4 Testnet routes are frozen");
check(wrappedNativeRoutes.length === 1, "the direct WETH route is frozen");
check(
  new Set(assetRoutes.map((route) => route.address.toLowerCase())).size === 11,
  "route assets are unique by address",
);
for (const route of assetRoutes) {
  const asset = getAddress(route.address);
  const execution = await read(
    contracts.assetRouter,
    abis.assetRouter,
    "executionRouteStatus",
    [asset],
  );
  check(execution.ready, `${route.symbol} execution route is ready`);
  check(execution.enabled, `${route.symbol} execution route is enabled`);
  check(execution.runtimeVerified, `${route.symbol} route runtime is verified`);

  if (["uniswap-v4", "canonical-v4-single-hop"].includes(route.routeKind ?? "uniswap-v4")) {
    const status = await read(contracts.assetRouter, abis.assetRouter, "routeStatus", [asset]);
    check(execution.kind === 1, `${route.symbol} is a canonical-v4 route`);
    check(status.ready, `${route.symbol} v4 route is ready`);
    check(status.fee === 10_000, `${route.symbol} route uses the 1% fee tier`);
    check(status.tickSpacing === 200, `${route.symbol} route uses tick spacing 200`);
    check(
      status.hooks === getAddress(route.hook ?? route.hooks),
      `${route.symbol} route hook matches manifest`,
    );
    check(status.poolId === route.poolId, `${route.symbol} pool ID matches frozen provenance`);
    check(
      route.enforceReferencePrice === false && status.enforceReferencePrice === false,
      `${route.symbol} synthetic v4 route disables fixed reference pricing`,
    );
    check(
      status.referenceTick === route.referenceTick,
      `${route.symbol} reference tick matches the manifest`,
    );
    check(
      status.maximumReferenceTickDeviation === route.maximumReferenceTickDeviation,
      `${route.symbol} reference deviation matches the manifest`,
    );
    check(
      route.maximumProtectedRouteSlippageBps === 100,
      `${route.symbol} freezes the 1% protected-route slippage ceiling`,
    );
  } else if (route.routeKind === "wrapped-native") {
    check(execution.kind === 2, `${route.symbol} is a direct wrapped-native route`);
    check(
      getAddress(route.address) === getAddress(manifest.contracts.wrappedNative),
      `${route.symbol} is the manifest WETH contract`,
    );
    check(
      route.runtimeCodeHash === keccak256(await client.getCode({ address: asset })),
      `${route.symbol} runtime hash matches the manifest`,
    );
  } else {
    check(false, `${route.symbol} has a recognized schema-14 route kind`);
  }
}
check(
  await read(
    contracts.assetRouter,
    abis.assetRouter,
    "MAX_PROTECTED_ROUTE_SLIPPAGE_BPS",
  ) === 100,
  "asset router enforces a 1% protected-route slippage ceiling",
);
check(
  await read(
    contracts.testAssetLiquidityLocker,
    abis.testAssetLiquidityLocker,
    "configurationSealed",
  ),
  "test-asset liquidity locker configuration is sealed",
);
for (const route of v4Routes) {
  check(
    getAddress(route.liquidityLocker) === contracts.testAssetLiquidityLocker,
    `${route.symbol} names the immutable test-asset liquidity locker`,
  );
  const position = await read(
    contracts.testAssetLiquidityLocker,
    abis.testAssetLiquidityLocker,
    "position",
    [route.poolId],
  );
  check(getAddress(position.asset) === getAddress(route.address), `${route.symbol} locked position asset matches`);
  check(position.liquidity > 0n, `${route.symbol} has nonzero permanently locked liquidity`);
  check(position.nativeAmount > 0n, `${route.symbol} locked native principal is nonzero`);
  check(position.tokenAmount > 0n, `${route.symbol} locked token principal is nonzero`);
}
const catalogAssets = manifest.assetCatalog?.assets ?? [];
check(catalogAssets.length === 11, "asset catalog contains 11 entries");
check(
  catalogAssets.filter((asset) => asset.verification === "robyn-testnet-mock").length === 10,
  "asset catalog distinguishes ten Robyn mocks",
);
check(
  catalogAssets.filter((asset) => asset.verification === "robyn-controlled-testnet-dex")
    .length === 1,
  "asset catalog distinguishes the direct WETH route",
);

check(
  getAddress(await read(contracts.stateView, abis.stateView, "poolManager")) === contracts.poolManager,
  "StateView references the shared PoolManager",
);
check(
  getAddress(await read(contracts.launchDeployer, abis.launchDeployer, "controller")) ===
    contracts.launchFactory,
  "launch deployer controller is the launch factory",
);
check(
  getAddress(await read(contracts.vaultDeployer, abis.vaultDeployer, "controller")) ===
    contracts.launchFactory,
  "vault deployer controller is the launch factory",
);
check(
  getAddress(await read(contracts.launchFactory, abis.launchFactory, "launchDeployer")) ===
    contracts.launchDeployer,
  "launch factory references the token deployer",
);
check(
  getAddress(await read(contracts.launchFactory, abis.launchFactory, "vaultDeployer")) ===
    contracts.vaultDeployer,
  "launch factory references the vault deployer",
);
check(
  getAddress(await read(contracts.launchFactory, abis.launchFactory, "coordinator")) ===
    contracts.atomicLaunchCoordinator,
  "launch factory coordinator is bound",
);
check(
  getAddress(await read(contracts.marketFactory, abis.marketFactory, "coordinator")) ===
    contracts.atomicLaunchCoordinator,
  "market factory coordinator is bound",
);
check(
  getAddress(await read(contracts.protocolFeeRouter, abis.feeRouter, "coordinator")) ===
    contracts.atomicLaunchCoordinator,
  "fee router coordinator is bound",
);
check(
  getAddress(await read(contracts.assetRouter, abis.assetRouter, "launchRegistrar")) ===
    contracts.marketFactory,
  "asset-router launch registrar is the market factory",
);
check(
  getAddress(await read(contracts.oracleHook, abis.hook, "registrar")) === contracts.marketFactory,
  "oracle-hook registrar is the market factory",
);
check(
  getAddress(await read(contracts.oracleHook, abis.hook, "feeRouter")) ===
    contracts.protocolFeeRouter,
  "phase-aware fee hook references the canonical fee router",
);
check(
  (await read(contracts.oracleHook, abis.hook, "PROTOCOL_FEE_BPS")) === 100,
  "fee-and-oracle hook charges an immutable one percent protocol fee",
);
check(
  (await read(contracts.marketFactory, abis.marketFactory, "maximumCurvePurchase")) ===
    BigInt(manifest.market.maximumCurvePurchase),
  "market factory enforces the manifest bonding purchase cap",
);
check(
  BigInt(manifest.market.maximumCurvePurchase) <=
    BigInt(manifest.market.graduationThresholdNative),
  "bonding purchase cap does not exceed the graduation threshold",
);
check(
  (await read(contracts.marketFactory, abis.marketFactory, "maximumNativeSwap")) ===
    BigInt(manifest.market.maximumNativeSwap),
  "market factory enforces the manifest graduated swap cap",
);
check(
  (await read(contracts.marketFactory, abis.marketFactory, "maximumNativeResidual")) ===
    BigInt(manifest.market.maximumNativeResidual),
  "market factory enforces the manifest native residual ceiling",
);
check(
  (await read(contracts.marketFactory, abis.marketFactory, "maximumTokenResidual")) ===
    BigInt(manifest.market.maximumTokenResidual),
  "market factory enforces the manifest token residual ceiling",
);
check(
  (await read(contracts.oracleHook, abis.hook, "deploymentDomain")) ===
    manifest.oracleHook.deploymentDomain,
  "oracle-hook deployment domain matches manifest",
);
for (const key of ["adapterDeployer", "lockerDeployer", "marketDeployer"]) {
  check(
    getAddress(await read(contracts[key], abis[key], "controller")) === contracts.marketFactory,
    `${key} controller is the market factory`,
  );
}
check(
  (BigInt(contracts.oracleHook) & 0x3fffn) === 0x18e4n,
  "oracle-hook address exposes only required permission bits",
);
check(
  manifest.oracleHook.permissionBits === "0x18e4" &&
    manifest.oracleHook.phases?.join(",") === "Bonding,Graduating,Trading",
  "manifest freezes the immutable phase-aware hook policy",
);

const fixedSupply = 1_000_000_000n * 10n ** 18n;
check(
  await read(contracts.daoToken, abis.daoToken, "totalSupply") === fixedSupply,
  "RDAO supply is exactly one billion",
);
check(
  BigInt(manifest.dao.fixedSupply) === fixedSupply &&
    manifest.dao.initialOwnerShareBps === 10_000,
  "manifest records the fixed 100% bootstrap RDAO allocation",
);
const launchRewardDuration = BigInt(manifest.rewardStreams?.launchTokenDurationSeconds ?? 0);
const daoRewardDuration = BigInt(manifest.rewardStreams?.daoDurationSeconds ?? 0);
const creatorRewardDuration = BigInt(manifest.rewardStreams?.creatorDurationSeconds ?? 0);
check(
  launchRewardDuration > 0n &&
    daoRewardDuration > 0n &&
    creatorRewardDuration > 0n &&
    launchRewardDuration === daoRewardDuration &&
    launchRewardDuration === creatorRewardDuration &&
    BigInt(manifest.dao.rewardStreamDurationSeconds) === daoRewardDuration,
  "manifest records one common holder, DAO, and creator reward release",
);
check(
  (await read(contracts.daoToken, abis.daoToken, "REWARD_STREAM_DURATION")) ===
    daoRewardDuration,
  "RDAO reward duration matches the manifest",
);
if (!isPausedSchema) {
  check(
    (await read(contracts.genesisToken, abis.token, "REWARD_STREAM_DURATION")) ===
      launchRewardDuration,
    "launch-token reward duration matches the manifest",
  );
}
check(
  (await read(
    contracts.protocolFeeRouter,
    abis.feeRouter,
    "CREATOR_REWARD_STREAM_DURATION",
  )) === creatorRewardDuration,
  "creator reward duration matches the manifest",
);
check(
  (await read(contracts.protocolFeeRouter, abis.feeRouter, "MAX_CREATOR_RECIPIENTS")) ===
    8,
  "creator reward splits support at most eight recipients",
);
if (!isPausedSchema) {
  const genesisCreatorSplit = await read(
  contracts.protocolFeeRouter,
  abis.feeRouter,
  "creatorFeeSplit",
  [contracts.genesisToken],
);
const genesisCreatorFeeAccount = await read(
  contracts.protocolFeeRouter,
  abis.feeRouter,
  "launchAccount",
  [contracts.genesisToken],
);
check(
  genesisCreatorSplit[0].length === 1 &&
    genesisCreatorSplit[0][0] === genesisCreatorFeeAccount.creator &&
    genesisCreatorSplit[1][0] === 10_000 &&
    genesisCreatorSplit[2] === false,
  "genesis creator rewards default to one editable 100% recipient",
);
}
check(
  getAddress(await read(contracts.daoToken, abis.daoToken, "rewardDepositor")) ===
    contracts.protocolFeeRouter,
  "RDAO reward depositor is the protocol fee router",
);
for (const key of [
  "timelock",
  "protocolFeeRouter",
  "governor",
  "atomicLaunchCoordinator",
  "marketFactory",
  "launchFactory",
  "launchDeployer",
  "vaultDeployer",
  "assetRouter",
  "oracleHook",
  "adapterDeployer",
  "lockerDeployer",
  "marketDeployer",
  "testAssetLiquidityLocker",
  "tokenSink",
]) {
  check(
    await read(contracts.daoToken, abis.daoToken, "isRewardExcluded", [contracts[key]]),
    `${key} is excluded from RDAO rewards`,
  );
}

const governanceManifest = manifest.dao?.governance;
check(
  await read(contracts.governor, abis.governor, "votingDelay") ===
    BigInt(governanceManifest?.votingDelaySeconds ?? 0),
  "testnet Governor voting delay matches the manifest",
);
check(
  await read(contracts.governor, abis.governor, "votingPeriod") ===
    BigInt(governanceManifest?.votingPeriodSeconds ?? 0),
  "testnet Governor voting period matches the manifest",
);
check(
  await read(contracts.governor, abis.governor, "proposalThreshold") ===
    10_000_000n * 10n ** 18n,
  "testnet Governor proposal threshold is one percent",
);
check(
  await read(contracts.timelock, abis.timelock, "getMinDelay") ===
    BigInt(governanceManifest?.timelockSeconds ?? 0),
  "testnet Timelock delay matches the manifest",
);
check(
  governanceManifest?.profile === "robinhood-testnet-short-assurance" &&
    governanceManifest.votingDelaySeconds > 0 &&
    governanceManifest.votingPeriodSeconds > 0 &&
    governanceManifest.timelockSeconds > 0,
  "manifest governance timing is explicit and positive",
);

const proposerRole = await read(contracts.timelock, abis.timelock, "PROPOSER_ROLE");
const cancellerRole = await read(contracts.timelock, abis.timelock, "CANCELLER_ROLE");
const executorRole = await read(contracts.timelock, abis.timelock, "EXECUTOR_ROLE");
const adminRole = await read(contracts.timelock, abis.timelock, "DEFAULT_ADMIN_ROLE");
check(
  await read(contracts.timelock, abis.timelock, "hasRole", [proposerRole, contracts.governor]),
  "Governor is the timelock proposer",
);
check(
  await read(contracts.timelock, abis.timelock, "hasRole", [
    cancellerRole,
    getAddress(manifest.guardian),
  ]),
  "guardian is the timelock canceller",
);
check(
  await read(contracts.timelock, abis.timelock, "hasRole", [
    executorRole,
    getAddress("0x0000000000000000000000000000000000000000"),
  ]),
  "timelock execution is permissionless",
);
check(
  !(await read(contracts.timelock, abis.timelock, "hasRole", [
    adminRole,
    getAddress(manifest.deployer),
  ])),
  "deployer renounced timelock administration",
);

if (!isPausedSchema) {
const genesis = manifest.genesis;
check(genesis.assets?.length === 3, "genesis freezes its three basket assets");
check(
  genesis.weightsBps?.reduce((total, weight) => total + weight, 0) === 10_000,
  "genesis freezes a 100 percent basket allocation",
);
const token = getAddress(genesis.token);
const vault = getAddress(genesis.vault);
const market = getAddress(genesis.market);
const adapter = getAddress(genesis.graduationAdapter);
const locker = getAddress(genesis.positionLocker);
check(
  getAddress(
    await read(contracts.launchFactory, abis.launchFactory, "launchTokenById", [
      BigInt(genesis.launchId),
    ]),
  ) === token,
  "receipt-derived token matches launch factory",
);
check(
  getAddress(await read(contracts.launchFactory, abis.launchFactory, "creatorByToken", [token])) ===
    getAddress(genesis.creator),
  "canonical creator matches the receipt",
);
for (const [index, asset] of (genesis.assets ?? []).entries()) {
  const leg = await read(vault, abis.vault, "leg", [BigInt(index)]);
  check(
    getAddress(leg.asset) === getAddress(asset),
    `genesis basket leg ${index + 1} address matches`,
  );
  check(
    leg.weightBps === genesis.weightsBps[index],
    `genesis basket leg ${index + 1} weight matches`,
  );
}
check(
  getAddress(await read(contracts.marketFactory, abis.marketFactory, "marketByToken", [token])) ===
    market,
  "receipt-derived market matches market factory",
);
check(
  getAddress(await read(contracts.marketFactory, abis.marketFactory, "adapterByToken", [token])) ===
    adapter,
  "receipt-derived adapter matches market factory",
);
check(
  await read(contracts.marketFactory, abis.marketFactory, "poolIdByToken", [token]) === genesis.poolId,
  "receipt-derived pool ID matches market factory",
);
check(await read(market, abis.market, "seeded"), "genesis bonding market is seeded");
const allowLifecycleProgress = process.env.ROBYN_VERIFY_ALLOW_LIFECYCLE_PROGRESS === "true";
const genesisGraduated = await read(market, abis.market, "graduated");
check(
  !genesisGraduated || allowLifecycleProgress,
  allowLifecycleProgress
    ? "genesis market lifecycle progression is permitted"
    : "genesis begins on the bonding curve",
);
check(
  getAddress(await read(adapter, abis.adapter, "locker")) === locker,
  "adapter is bound to the receipt-derived immutable locker",
);
check(
  await read(contracts.oracleHook, abis.hook, "registeredPool", [genesis.poolId]),
  "genesis pool is registered in the oracle hook",
);
const genesisPoolPhase = await read(
  contracts.oracleHook,
  abis.hook,
  "poolPhase",
  [genesis.poolId],
);
check(
  genesisPoolPhase === 1 || (allowLifecycleProgress && genesisGraduated && genesisPoolPhase === 3),
  allowLifecycleProgress
    ? "genesis pool lifecycle phase matches its market state"
    : "genesis pool begins in the immutable Bonding phase",
);
const genesisFeeAccount = await read(
  contracts.protocolFeeRouter,
  abis.feeRouter,
  "launchAccount",
  [token],
);
check(
  getAddress(genesisFeeAccount.hook) === contracts.oracleHook,
  "genesis fee account binds the canonical fee-and-oracle hook",
);
check(
  manifest.market?.protocolFeeBps === 100 &&
    manifest.market?.poolFeePips === 10_000 &&
    manifest.market?.nominalPostGraduationFeeBps === 200,
  "manifest freezes one percent LP plus one percent Sherwood fees",
);
const slot0 = await read(contracts.stateView, abis.stateView, "getSlot0", [genesis.poolId]);
check(slot0[0] > 0n, "genesis v4 pool is initialized", {
  sqrtPriceX96: slot0[0].toString(),
  tick: slot0[1],
});
check(
  await read(token, abis.token, "tokenURI") ===
    "ipfs://bafkreibys2cv4ijpoedcl7qdbi5u66wuwedwg3lsc6pios3wcyaoyz7cau",
  "genesis token exposes immutable ERC-1046 metadata",
);
} else {
  check(
    (await read(contracts.atomicLaunchCoordinator, abis.coordinator, "launchMode")) === 0,
    `${schemaLabel} launch coordinator is Paused`,
  );
  check(
    getAddress(await read(contracts.atomicLaunchCoordinator, abis.coordinator, "canaryLauncher")) ===
      getAddress("0x0000000000000000000000000000000000000000"),
    `${schemaLabel} canary launcher is unset while Paused`,
  );
  check(
    getAddress(await read(contracts.atomicLaunchCoordinator, abis.coordinator, "governor")) ===
      contracts.timelock,
    `${schemaLabel} launch mode authority is the Timelock`,
  );
  check(
    getAddress(await read(contracts.atomicLaunchCoordinator, abis.coordinator, "guardian")) ===
      getAddress(manifest.guardian),
    `${schemaLabel} guardian matches the manifest`,
  );
  const currentProfile = await read(
    contracts.marketFactory,
    abis.marketFactory,
    "currentGraduationProfile",
  );
  const frozenProfile = manifest.graduationProfiles?.current;
  check(
    currentProfile.version.toString() === frozenProfile?.version &&
      currentProfile.targetGraduationNative.toString() === frozenProfile?.targetGraduationNative &&
      currentProfile.actualGraduationNative.toString() === frozenProfile?.actualGraduationNative &&
      currentProfile.maximumCurvePurchase.toString() === frozenProfile?.maximumCurvePurchase &&
      currentProfile.initialVirtualNativeReserve.toString() === frozenProfile?.initialVirtualNativeReserve &&
      currentProfile.terminalNativePerTokenX18.toString() === frozenProfile?.terminalNativePerTokenX18 &&
      currentProfile.terminalSqrtPriceX96.toString() === frozenProfile?.terminalSqrtPriceX96,
    `${schemaLabel} current graduation profile matches the manifest`,
  );
  check(
    (await read(contracts.marketFactory, abis.marketFactory, "currentGraduationProfileHash")) ===
      frozenProfile?.hash,
    `${schemaLabel} current graduation profile hash matches the manifest`,
  );
}

console.log(
  JSON.stringify(
    {
      manifest: manifestPath,
      checkedAt: new Date().toISOString(),
      checks,
      failures,
    },
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ),
);
if (failures.length) process.exit(1);

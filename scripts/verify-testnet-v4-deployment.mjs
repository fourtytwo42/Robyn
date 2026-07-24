#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { createPublicClient, getAddress, http, keccak256 } from "viem";

const manifestPath = process.argv.find((argument) => argument.endsWith(".json")) ??
  "deployments/46630-v4.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const rpcUrl = process.env.ROBYN_TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const client = createPublicClient({ transport: http(rpcUrl) });
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
check(await client.getChainId() === 46630, "RPC chain ID is 46630");
check(manifest.chainId === 46630, "manifest chain ID is 46630");
check(manifest.liquidityVenue === "uniswap-v4", "manifest selects Uniswap v4");
check(
  manifest.venueProvenance === "shared-unlisted-robinhood-testnet-uniswap-v4-mirror",
  "unlisted venue disclosure is exact",
);
check(manifest.schemaVersion === 8, "deployment manifest schema is v8");
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
check(
  manifest.deploymentTransactions?.genesis === manifest.genesis.transactionHash,
  "genesis transaction is frozen consistently",
);

const abis = {
  stateView: await artifactAbi("StateView", true),
  daoToken: await artifactAbi("RobynDaoToken"),
  timelock: await artifactAbi("TimelockController"),
  governor: await artifactAbi("RobynTestnetGovernor"),
  assetRouter: await artifactAbi("RobynV4AssetRouter"),
  testAssetLiquidityLocker: await artifactAbi("RobynV4TestAssetLiquidityLocker"),
  launchDeployer: await artifactAbi("RobynNativeLaunchDeployerV4"),
  launchFactory: await artifactAbi("RobynNativeLaunchFactoryV4"),
  feeRouter: await artifactAbi("RobynNativeProtocolFeeRouterV3"),
  hook: await artifactAbi("RobynV4OracleHook"),
  adapterDeployer: await artifactAbi("RobynV4AdapterDeployer"),
  lockerDeployer: await artifactAbi("RobynV4LockerDeployer"),
  marketDeployer: await artifactAbi("RobynV4MarketDeployer"),
  marketFactory: await artifactAbi("RobynV4MarketFactory"),
  coordinator: await artifactAbi("RobynV4LaunchCoordinatorV5"),
  market: await artifactAbi("RobynV4BondingCurveMarket"),
  adapter: await artifactAbi("RobynV4GraduationAdapter"),
  token: await artifactAbi("RobynLaunchToken"),
  vault: await artifactAbi("RobynNativeBasketVaultV2"),
};

async function read(address, abi, functionName, args = []) {
  return client.readContract({ address, abi, functionName, args });
}

const assetRoutes = manifest.assetRoutes ?? [];
const faucetRoutes = assetRoutes.filter(
  (route) => route.verification === "robinhood-testnet-faucet-stock",
);
const mockRoutes = assetRoutes.filter(
  (route) =>
    route.verification === "robyn-testnet-mock" ||
    route.verification === "robyn-controlled-testnet-dex",
);
check(assetRoutes.length === 24, "all 24 catalog routes are frozen");
check(faucetRoutes.length === 5, "five exact faucet-stock routes are frozen");
check(mockRoutes.length === 19, "18 mock routes and WETH route are frozen");
check(
  new Set(assetRoutes.map((route) => route.address.toLowerCase())).size === 24,
  "route assets are unique by address",
);
for (const route of assetRoutes) {
  const asset = getAddress(route.address);
  const status = await read(contracts.assetRouter, abis.assetRouter, "routeStatus", [asset]);
  check(status.ready, `${route.symbol} route is ready`);
  check(status.fee === 10_000, `${route.symbol} route uses the 1% fee tier`);
  check(status.tickSpacing === 200, `${route.symbol} route uses tick spacing 200`);
  check(
    status.hooks === getAddress(route.hook ?? route.hooks),
    `${route.symbol} route hook matches manifest`,
  );
  check(status.poolId === route.poolId, `${route.symbol} pool ID matches frozen provenance`);
  check(status.enforceReferencePrice, `${route.symbol} enforces its frozen reference price`);
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
for (const route of mockRoutes) {
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
check(catalogAssets.length === 24, "asset catalog contains 24 entries");
check(
  catalogAssets.filter((asset) => asset.verification === "robinhood-testnet-faucet-stock")
    .length === 5,
  "asset catalog distinguishes the five faucet stocks",
);
check(
  catalogAssets.filter((asset) => asset.verification === "robyn-testnet-mock").length === 18,
  "asset catalog distinguishes 18 Robyn mocks",
);
check(
  catalogAssets.filter((asset) => asset.verification === "robyn-controlled-testnet-dex")
    .length === 1,
  "asset catalog distinguishes the Robyn-controlled WETH route",
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
  (BigInt(contracts.oracleHook) & 0x3fffn) === 0x1040n,
  "oracle-hook address exposes only required permission bits",
);

const fixedSupply = 1_000_000_000n * 10n ** 18n;
check(
  await read(contracts.daoToken, abis.daoToken, "totalSupply") === fixedSupply,
  "RDAO supply is exactly one billion",
);
check(
  await read(contracts.daoToken, abis.daoToken, "balanceOf", [getAddress(manifest.deployer)]) === fixedSupply,
  "initial deployer owns 100% of RDAO",
);
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
  "assetRouter",
  "oracleHook",
  "adapterDeployer",
  "lockerDeployer",
  "marketDeployer",
  "testAssetLiquidityLocker",
]) {
  check(
    await read(contracts.daoToken, abis.daoToken, "isRewardExcluded", [contracts[key]]),
    `${key} is excluded from RDAO rewards`,
  );
}

check(
  await read(contracts.governor, abis.governor, "votingDelay") === 600n,
  "testnet Governor voting delay is 10 minutes",
);
check(
  await read(contracts.governor, abis.governor, "votingPeriod") === 1_800n,
  "testnet Governor voting period is 30 minutes",
);
check(
  await read(contracts.governor, abis.governor, "proposalThreshold") ===
    10_000_000n * 10n ** 18n,
  "testnet Governor proposal threshold is one percent",
);
check(
  await read(contracts.timelock, abis.timelock, "getMinDelay") === 600n,
  "testnet Timelock delay is 10 minutes",
);
check(
  manifest.dao?.governance?.profile === "robinhood-testnet-short-assurance" &&
    manifest.dao.governance.votingDelaySeconds === 600 &&
    manifest.dao.governance.votingPeriodSeconds === 1_800 &&
    manifest.dao.governance.timelockSeconds === 600,
  "manifest governance timing matches live contracts",
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
check(!(await read(market, abis.market, "graduated")), "genesis begins on the bonding curve");
check(
  getAddress(await read(adapter, abis.adapter, "locker")) === locker,
  "adapter is bound to the receipt-derived immutable locker",
);
check(
  await read(contracts.oracleHook, abis.hook, "registeredPool", [genesis.poolId]),
  "genesis pool is registered in the oracle hook",
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

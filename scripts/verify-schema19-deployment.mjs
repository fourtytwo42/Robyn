#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
} from "viem";

const [preparedArgument, outputArgument] = process.argv.slice(2);
if (!preparedArgument || !outputArgument) {
  throw new Error("usage: verify-schema19-deployment.mjs <prepared.json> <output.json>");
}
const preparedPath = path.resolve(preparedArgument);
const outputPath = path.resolve(outputArgument);
if (preparedPath === outputPath) throw new Error("input and output paths must differ");
const preparedRaw = await readFile(preparedPath, "utf8");
const prepared = JSON.parse(preparedRaw);
if (prepared.schemaVersion !== 19 || ![46630, 4663].includes(prepared.chainId)) {
  throw new Error("verified Schema-19 input required");
}
const rpcUrl = process.env.ROBYN_SCHEMA19_RPC_URL;
if (!rpcUrl) throw new Error("ROBYN_SCHEMA19_RPC_URL is required");
const parsedRpc = new URL(rpcUrl);
if (!["127.0.0.1", "localhost"].includes(parsedRpc.hostname)) {
  throw new Error("Schema-19 verification requires the loopback LAN gateway or isolated fork");
}
const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0 }) });
const chainId = await client.getChainId();
if (chainId !== prepared.chainId) throw new Error("Schema-19 verification chain mismatch");

const artifactByLabel = {
  assetRouter: "RobynV4AssetRouter.sol/RobynV4AssetRouter.json",
  launchDeployer: "RobynNativeLaunchDeployerV4.sol/RobynNativeLaunchDeployerV4.json",
  vaultDeployer: "RobynNativeVaultDeployerV4.sol/RobynNativeVaultDeployerV4.json",
  launchFactory: "RobynNativeLaunchFactoryV4.sol/RobynNativeLaunchFactoryV4.json",
  feeRouter: "RobynNativeProtocolFeeRouterV4.sol/RobynNativeProtocolFeeRouterV4.json",
  daoRewards: "RobynDaoRewardDistributor.sol/RobynDaoRewardDistributor.json",
  maintenance: "RobynMaintenanceCoordinator.sol/RobynMaintenanceCoordinator.json",
  claimsRouter: "RobynClaimsRouter.sol/RobynClaimsRouter.json",
  tradeRouter: "RobynTradeRouter.sol/RobynTradeRouter.json",
  tokenSink: "RobynTokenSink.sol/RobynTokenSink.json",
  oracleHook: "RobynV4FeeAndPhaseHook.sol/RobynV4FeeAndPhaseHook.json",
  adapterDeployer: "RobynV4AdapterDeployer.sol/RobynV4AdapterDeployer.json",
  lockerDeployer: "RobynV4LockerDeployer.sol/RobynV4LockerDeployer.json",
  marketDeployer: "RobynV4MarketDeployer.sol/RobynV4MarketDeployer.json",
  marketFactory: "RobynV4MarketFactory.sol/RobynV4MarketFactory.json",
  coordinator: "RobynV4LaunchCoordinatorV7.sol/RobynV4LaunchCoordinatorV7.json",
};
const artifactRoot = path.resolve("packages/contracts/out");
const zeroRanges = (hex, ranges) => {
  const bytes = Buffer.from(hex.slice(2), "hex");
  for (const range of ranges) bytes.fill(0, range.start, range.start + range.length);
  return toHex(bytes);
};
const immutableRanges = (artifact) =>
  Object.values(artifact.deployedBytecode.immutableReferences ?? {}).flat();
const runtimeCodeHashes = {};
const normalizedRuntimeCodeHashes = {};
for (const [label, relative] of Object.entries(artifactByLabel)) {
  const address = getAddress(prepared.deployment.contracts[label]);
  const [code, artifactRaw] = await Promise.all([
    client.getCode({ address }),
    readFile(path.join(artifactRoot, relative), "utf8"),
  ]);
  if (!code || code === "0x") throw new Error(`${label} runtime missing`);
  const artifact = JSON.parse(artifactRaw);
  const expected = artifact.deployedBytecode.object;
  if (code.length !== expected.length) throw new Error(`${label} runtime length mismatch`);
  const ranges = immutableRanges(artifact);
  const actualNormalized = zeroRanges(code, ranges);
  const expectedNormalized = zeroRanges(expected, ranges);
  if (actualNormalized !== expectedNormalized) throw new Error(`${label} runtime mismatch`);
  runtimeCodeHashes[label] = keccak256(code);
  normalizedRuntimeCodeHashes[label] = keccak256(actualNormalized);
}

const reusedAddresses = {
  guardianSafe: prepared.governance.guardianSafe,
  daoToken: prepared.governance.daoToken,
  timelock: prepared.governance.timelock,
  governor: prepared.governance.governor,
  ...prepared.external,
};
const reusedRuntimeCodeHashes = {};
for (const [label, expectedHash] of Object.entries(prepared.reusedRuntimeCodeHashes)) {
  const address = getAddress(reusedAddresses[label]);
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error(`${label} reused runtime missing`);
  const actualHash = keccak256(code);
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(`${label} reused runtime changed`);
  }
  reusedRuntimeCodeHashes[label] = actualHash;
}

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getModulesPaginated(address,uint256) view returns (address[],address)",
]);
const daoAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const timelockAbi = parseAbi(["function getMinDelay() view returns (uint256)"]);
const governorAbi = parseAbi([
  "function token() view returns (address)",
  "function timelock() view returns (address)",
]);
const [owners, threshold, modulesResult, totalSupply, deployerDaoBalance, delay, governorToken, governorTimelock] =
  await Promise.all([
    client.readContract({ address: prepared.governance.guardianSafe, abi: safeAbi, functionName: "getOwners" }),
    client.readContract({ address: prepared.governance.guardianSafe, abi: safeAbi, functionName: "getThreshold" }),
    client.readContract({ address: prepared.governance.guardianSafe, abi: safeAbi, functionName: "getModulesPaginated", args: ["0x0000000000000000000000000000000000000001", 10n] }),
    client.readContract({ address: prepared.governance.daoToken, abi: daoAbi, functionName: "totalSupply" }),
    client.readContract({ address: prepared.governance.daoToken, abi: daoAbi, functionName: "balanceOf", args: [prepared.deployment.deployer] }),
    client.readContract({ address: prepared.governance.timelock, abi: timelockAbi, functionName: "getMinDelay" }),
    client.readContract({ address: prepared.governance.governor, abi: governorAbi, functionName: "token" }),
    client.readContract({ address: prepared.governance.governor, abi: governorAbi, functionName: "timelock" }),
  ]);
if (owners.length !== 1 || getAddress(owners[0]) !== getAddress(prepared.deployment.deployer)) throw new Error("Safe owner mismatch");
if (threshold !== 1n) throw new Error("Safe threshold mismatch");
if (modulesResult[0].length !== 0 || modulesResult[1] !== "0x0000000000000000000000000000000000000001") throw new Error("Safe modules changed");
if (totalSupply !== 1_000_000_000n * 10n ** 18n || deployerDaoBalance !== totalSupply) throw new Error("RDAO ownership changed");
if (delay !== 3600n) throw new Error("Timelock delay changed");
if (getAddress(governorToken) !== getAddress(prepared.governance.daoToken)) throw new Error("Governor token changed");
if (getAddress(governorTimelock) !== getAddress(prepared.governance.timelock)) throw new Error("Governor Timelock changed");

const coordinatorAbi = parseAbi([
  "function launchMode() view returns (uint8)",
  "function launchCount() view returns (uint256)",
]);
const assetRouterAbi = parseAbi([
  "function conversionsPaused() view returns (bool)",
  "function executionRouteStatus(address) view returns ((uint8 kind,uint128 maximumNativeInput,uint128 maximumAssetInput,bytes32 disabledReason,bool enabled,bool runtimeVerified,bool ready,bytes32 reason) status)",
]);
const feeRouterAbi = parseAbi([
  "function paused() view returns (bool)",
  "function maintenanceCoordinator() view returns (address)",
  "function daoRewardReceiver() view returns (address)",
  "function totalCreatorNativeLiability() view returns (uint256)",
  "function totalBasketNativeLiability() view returns (uint256)",
  "function totalDaoNativeLiability() view returns (uint256)",
  "function totalTreasuryNativeLiability() view returns (uint256)",
]);
const daoRewardsAbi = parseAbi([
  "function rewardDepositor() view returns (address)",
  "function epochCount() view returns (uint256)",
  "function totalRewardsDeposited() view returns (uint256)",
  "function totalRewardsClaimed() view returns (uint256)",
]);
const marketFactoryAbi = parseAbi([
  "function graduationThresholdNative() view returns (uint256)",
  "function maximumCurvePurchase() view returns (uint256)",
]);
const launchFactoryAbi = parseAbi([
  "function failureObservationSpacing() view returns (uint256)",
  "function fallbackDelay() view returns (uint256)",
  "function launchCount() view returns (uint256)",
]);
const c = prepared.deployment.contracts;
const [launchMode, coordinatorLaunchCount, conversionsPaused, feePaused, maintenanceBinding, daoReceiver, creatorLiability, basketLiability, daoLiability, treasuryLiability, rewardDepositor, epochCount, deposited, claimed, target, maximumPurchase, spacing, fallbackDelay, factoryLaunchCount] =
  await Promise.all([
    client.readContract({ address: c.coordinator, abi: coordinatorAbi, functionName: "launchMode" }),
    client.readContract({ address: c.coordinator, abi: coordinatorAbi, functionName: "launchCount" }),
    client.readContract({ address: c.assetRouter, abi: assetRouterAbi, functionName: "conversionsPaused" }),
    client.readContract({ address: c.feeRouter, abi: feeRouterAbi, functionName: "paused" }),
    client.readContract({ address: c.feeRouter, abi: feeRouterAbi, functionName: "maintenanceCoordinator" }),
    client.readContract({ address: c.feeRouter, abi: feeRouterAbi, functionName: "daoRewardReceiver" }),
    client.readContract({ address: c.feeRouter, abi: feeRouterAbi, functionName: "totalCreatorNativeLiability" }),
    client.readContract({ address: c.feeRouter, abi: feeRouterAbi, functionName: "totalBasketNativeLiability" }),
    client.readContract({ address: c.feeRouter, abi: feeRouterAbi, functionName: "totalDaoNativeLiability" }),
    client.readContract({ address: c.feeRouter, abi: feeRouterAbi, functionName: "totalTreasuryNativeLiability" }),
    client.readContract({ address: c.daoRewards, abi: daoRewardsAbi, functionName: "rewardDepositor" }),
    client.readContract({ address: c.daoRewards, abi: daoRewardsAbi, functionName: "epochCount" }),
    client.readContract({ address: c.daoRewards, abi: daoRewardsAbi, functionName: "totalRewardsDeposited" }),
    client.readContract({ address: c.daoRewards, abi: daoRewardsAbi, functionName: "totalRewardsClaimed" }),
    client.readContract({ address: c.marketFactory, abi: marketFactoryAbi, functionName: "graduationThresholdNative" }),
    client.readContract({ address: c.marketFactory, abi: marketFactoryAbi, functionName: "maximumCurvePurchase" }),
    client.readContract({ address: c.launchFactory, abi: launchFactoryAbi, functionName: "failureObservationSpacing" }),
    client.readContract({ address: c.launchFactory, abi: launchFactoryAbi, functionName: "fallbackDelay" }),
    client.readContract({ address: c.launchFactory, abi: launchFactoryAbi, functionName: "launchCount" }),
  ]);
if (Number(launchMode) !== 2 || conversionsPaused || feePaused) throw new Error("Schema-19 is not active Public");
if (getAddress(maintenanceBinding) !== getAddress(c.maintenance)) throw new Error("maintenance binding mismatch");
if (getAddress(daoReceiver) !== getAddress(c.daoRewards) || getAddress(rewardDepositor) !== getAddress(c.feeRouter)) throw new Error("DAO reward binding mismatch");
if (target !== BigInt(prepared.settings.targetGraduationNative) || maximumPurchase !== BigInt(prepared.settings.maximumCurvePurchase)) throw new Error("graduation profile mismatch");
if (spacing !== BigInt(prepared.settings.failureObservationSpacing) || fallbackDelay !== BigInt(prepared.settings.fallbackDelay)) throw new Error("fallback policy mismatch");
if ([coordinatorLaunchCount, factoryLaunchCount, creatorLiability, basketLiability, daoLiability, treasuryLiability, epochCount, deposited, claimed].some((value) => value !== 0n)) throw new Error("nonzero Schema-19 genesis accounting");
for (const asset of prepared.routes.assets) {
  const status = await client.readContract({ address: c.assetRouter, abi: assetRouterAbi, functionName: "executionRouteStatus", args: [asset] });
  if (!status.enabled || !status.runtimeVerified || !status.ready) throw new Error(`route not ready ${asset}: ${status.reason}`);
}
for (const label of ["feeRouter", "daoRewards", "maintenance", "coordinator"]) {
  if ((await client.getBalance({ address: c[label] })) !== 0n) throw new Error(`${label} has unexpected native balance`);
}
const result = {
  schemaVersion: 19,
  chainId,
  generatedAt: new Date().toISOString(),
  contractReleaseSha: prepared.contractReleaseSha,
  toolingSha: prepared.toolingSha,
  preparedManifestSha256: createHash("sha256").update(preparedRaw).digest("hex"),
  verificationBlock: Number(await client.getBlockNumber()),
  deployer: prepared.deployment.deployer,
  governance: prepared.governance,
  contracts: c,
  runtimeCodeHashes,
  normalizedRuntimeCodeHashes,
  reusedRuntimeCodeHashes,
  routes: prepared.routes,
  settings: prepared.settings,
  initialState: { launchMode: "Public", conversionsPaused: false, routesReady: prepared.routes.assets.length, launches: 0, liabilitiesWei: "0" },
  passed: true,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(outputPath, serialized, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ output: outputPath, sha256: createHash("sha256").update(serialized).digest("hex"), passed: true })}\n`);

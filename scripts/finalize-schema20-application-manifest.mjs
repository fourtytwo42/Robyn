#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAddress, http, keccak256, parseAbi, parseEther } from "viem";

const [preparedArgument, journalArgument, outputArgument] = process.argv.slice(2);
if (!preparedArgument || !journalArgument || !outputArgument) {
  throw new Error("usage: finalize-schema20-application-manifest.mjs <prepared.json> <deployment-journal.jsonl> <output.json>");
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preparedRaw = await readFile(path.resolve(preparedArgument), "utf8");
const journalRaw = await readFile(path.resolve(journalArgument), "utf8");
const prepared = JSON.parse(preparedRaw);
const records = journalRaw.trim().split("\n").filter(Boolean).map(JSON.parse);
const receipts = records.filter((record) => record.type === "receipt");
if (prepared.schemaVersion !== 20 || receipts.length !== prepared.transactions.length) throw new Error("complete Schema-20 deployment journal required");
if (new Set(receipts.map((record) => record.transactionHash)).size !== receipts.length) throw new Error("duplicate Schema-20 receipt hash");
for (let index = 0; index < receipts.length; index += 1) {
  if (receipts[index].label !== prepared.transactions[index].label || receipts[index].status !== "success") {
    throw new Error(`Schema-20 receipt mismatch at ${index}`);
  }
}
const rpcUrl = process.env.ROBYN_SCHEMA20_RPC_URL ?? (prepared.chainId === 4663 ? "http://127.0.0.1:18549" : "http://127.0.0.1:18548");
const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0, timeout: 30_000 }) });
if ((await client.getChainId()) !== prepared.chainId || (await client.request({ method: "eth_syncing", params: [] })) !== false) throw new Error("finalizer RPC wrong-chain or syncing");
for (const record of receipts) {
  const receipt = await client.getTransactionReceipt({ hash: record.transactionHash });
  if (receipt.status !== "success" || receipt.blockNumber.toString() !== record.blockNumber) throw new Error(`receipt changed ${record.label}`);
}
const artifact = async (name) => JSON.parse(await readFile(path.join(repoRoot, "packages/contracts/out", `${name}.sol`, `${name}.json`), "utf8"));
const [factoryArtifact, routerArtifact, stakingArtifact, saleArtifact, coordinatorArtifact] = await Promise.all([
  artifact("RobynNativeLaunchFactoryV4"), artifact("RobynV4AssetRouter"), artifact("RobynRdaoStaking"),
  artifact("RobynRdaoBondingSale"), artifact("RobynV4LaunchCoordinatorV7"),
]);
const c = prepared.deployment.contracts;
const erc20Abi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);
const [
  launchCount, launchMode, conversionsPaused, allocationFunded, saleBalance, totalSupply,
  deployerBalance, saleAllowance, stakingAllowance, totalPrincipal, totalEligibleStake,
  totalWarmingStake, stakingLiability,
] = await Promise.all([
  client.readContract({ address: c.launchFactory, abi: factoryArtifact.abi, functionName: "launchCount" }),
  client.readContract({ address: c.coordinator, abi: coordinatorArtifact.abi, functionName: "launchMode" }),
  client.readContract({ address: c.assetRouter, abi: routerArtifact.abi, functionName: "conversionsPaused" }),
  client.readContract({ address: c.rdaoSale, abi: saleArtifact.abi, functionName: "allocationFunded" }),
  client.readContract({ address: prepared.governance.daoToken, abi: erc20Abi, functionName: "balanceOf", args: [c.rdaoSale] }),
  client.readContract({ address: prepared.governance.daoToken, abi: erc20Abi, functionName: "totalSupply" }),
  client.readContract({ address: prepared.governance.daoToken, abi: erc20Abi, functionName: "balanceOf", args: [prepared.deployment.deployer] }),
  client.readContract({ address: prepared.governance.daoToken, abi: erc20Abi, functionName: "allowance", args: [prepared.deployment.deployer, c.rdaoSale] }),
  client.readContract({ address: prepared.governance.daoToken, abi: erc20Abi, functionName: "allowance", args: [prepared.deployment.deployer, c.staking] }),
  client.readContract({ address: c.staking, abi: stakingArtifact.abi, functionName: "totalPrincipal" }),
  client.readContract({ address: c.staking, abi: stakingArtifact.abi, functionName: "totalEligibleStake" }),
  client.readContract({ address: c.staking, abi: stakingArtifact.abi, functionName: "totalWarmingStake" }),
  client.readContract({ address: c.staking, abi: stakingArtifact.abi, functionName: "outstandingLiability" }),
]);
if (
  launchCount !== 0n || Number(launchMode) !== 2 || conversionsPaused !== false || allocationFunded !== true ||
  totalSupply !== parseEther("1000000000") || saleBalance !== parseEther("200000000") ||
  deployerBalance !== 0n || saleAllowance !== 0n || stakingAllowance !== 0n ||
  totalPrincipal !== parseEther("800000000") || totalEligibleStake !== 0n ||
  totalWarmingStake !== parseEther("800000000") || stakingLiability !== 0n
) throw new Error("Schema-20 zero-state accounting or activation mismatch");
const routeChecks = [];
for (const route of prepared.routes.definitions) {
  const status = await client.readContract({
    address: c.assetRouter,
    abi: routerArtifact.abi,
    functionName: "executionRouteStatus",
    args: [route.asset],
  });
  if (status.enabled !== true || status.ready !== true) throw new Error(`Schema-20 route is not ready: ${route.symbol}`);
  routeChecks.push({ symbol: route.symbol, asset: getAddress(route.asset), enabled: status.enabled, ready: status.ready, reason: status.reason });
}
const runtimeRoles = {
  assetRouter: c.assetRouter,
  launchDeployer: c.launchDeployer,
  vaultDeployer: c.vaultDeployer,
  factory: c.launchFactory,
  launchFactory: c.launchFactory,
  protocolFeeRouter: c.feeRouter,
  feeRouter: c.feeRouter,
  rdaoStaking: c.staking,
  rdaoLiquidityLocker: c.rdaoLiquidityLocker,
  rdaoSale: c.rdaoSale,
  maintenanceCoordinator: c.maintenanceCoordinator,
  claimsRouter: c.claimsRouter,
  tradeRouter: c.tradeRouter,
  oracleHook: c.oracleHook,
  adapterDeployer: c.adapterDeployer,
  lockerDeployer: c.lockerDeployer,
  marketDeployer: c.marketDeployer,
  tokenSink: c.tokenSink,
  marketFactory: c.marketFactory,
  atomicLaunchCoordinator: c.coordinator,
  coordinator: c.coordinator,
};
const runtimeCodeHashes = {};
for (const [role, address] of Object.entries(runtimeRoles)) {
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error(`missing Schema-20 runtime ${role}`);
  runtimeCodeHashes[role] = keccak256(code);
}
const contracts = {
  baseAsset: prepared.external.wrappedNative,
  wrappedNative: prepared.external.wrappedNative,
  rewardAssets: prepared.routes.assets,
  poolManager: prepared.external.poolManager,
  positionManager: prepared.external.positionManager,
  quoter: prepared.external.quoter,
  universalRouter: prepared.external.universalRouter,
  permit2: prepared.external.permit2,
  stateView: prepared.external.stateView,
  guardian: prepared.governance.guardianSafe,
  daoToken: prepared.governance.daoToken,
  timelock: prepared.governance.timelock,
  governor: prepared.governance.governor,
  ...runtimeRoles,
};
const protocolRootRoles = [
  "factory", "launchDeployer", "vaultDeployer", "marketFactory", "atomicLaunchCoordinator",
  "daoToken", "governor", "timelock", "protocolFeeRouter", "assetRouter", "oracleHook",
  "adapterDeployer", "lockerDeployer", "marketDeployer", "tokenSink", "maintenanceCoordinator",
  "claimsRouter", "tradeRouter", "rdaoSale", "rdaoStaking", "rdaoLiquidityLocker",
];
const protocolRoots = [...new Set(protocolRootRoles.map((role) => contracts[role].toLowerCase()))].sort();
const policyPayload = {
  version: 1,
  protocolRoots,
  launchCoordinator: c.coordinator.toLowerCase(),
  launchEventTopics: ["0xd74962c237728681433889a5419834cff77965f55668fb014ee28925e2cef5f1"],
  poolManager: prepared.external.poolManager.toLowerCase(),
  poolEventTopics: [
    "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438",
    "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec",
    "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
    "0x29ef05caaff9404b7cb6d1c0e9bbae9eaa7ab2541feba1a9c4248594c08156cb",
  ].sort(),
  addressBatchSize: 64,
  poolIdBatchSize: 32,
};
const policyHash = createHash("sha256").update(JSON.stringify(policyPayload)).digest("hex");
const manifest = {
  schemaVersion: 20,
  environment: prepared.environment,
  chainId: prepared.chainId,
  liquidityVenue: "uniswap-v4",
  deploymentBlock: Number(receipts[0].blockNumber),
  gitCommit: prepared.toolingSha,
  gitSha: prepared.toolingSha,
  contractReleaseSha: prepared.contractReleaseSha,
  toolingSha: prepared.toolingSha,
  deployer: prepared.deployment.deployer,
  guardianSafe: prepared.governance.guardianSafe,
  governance: prepared.governance,
  contracts,
  v4Venue: {
    poolManager: prepared.external.poolManager,
    positionManager: prepared.external.positionManager,
    quoter: prepared.external.quoter,
    universalRouter: prepared.external.universalRouter,
    permit2: prepared.external.permit2,
    stateView: prepared.external.stateView,
  },
  runtimeCodeHashes,
  reusedRuntimeCodeHashes: prepared.reusedRuntimeCodeHashes,
  settings: prepared.settings,
  sale: prepared.sale,
  saleOracleEvidence: prepared.saleOracleEvidence,
  assetCatalog: prepared.assetCatalog,
  assetRoutes: prepared.routes.definitions,
  routes: prepared.routes.definitions.map((route) => ({ symbol: route.symbol, asset: route.asset, enabled: true })),
  routeChecks,
  initialState: {
    launchMode: "Public",
    conversionsPaused: false,
    launchCount: "0",
    rdaoSupply: totalSupply.toString(),
    rdaoSaleBalance: saleBalance.toString(),
    retainedStakeWarming: totalWarmingStake.toString(),
    retainedStakeEligible: totalEligibleStake.toString(),
    outstandingStakingLiability: stakingLiability.toString(),
  },
  indexingPolicy: { ...policyPayload, policyHash },
  rpcPolicy: prepared.rpcPolicy,
  deploymentEvidence: {
    preparedManifestSha256: createHash("sha256").update(preparedRaw).digest("hex"),
    journalSha256: createHash("sha256").update(journalRaw).digest("hex"),
    transactionPlanSha256: prepared.transactionPlanSha256,
    transactionCount: receipts.length,
  },
};
await writeFile(path.resolve(outputArgument), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ output: path.resolve(outputArgument), schemaVersion: 20, chainId: prepared.chainId, policyHash, transactionCount: receipts.length, routeChecks })}\n`);

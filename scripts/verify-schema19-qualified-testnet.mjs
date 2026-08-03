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
} from "viem";

const [manifestArgument, outputArgument] = process.argv.slice(2);
if (!manifestArgument || !outputArgument) {
  throw new Error(
    "usage: verify-schema19-qualified-testnet.mjs <manifest.json> <output.json>",
  );
}
const manifestPath = path.resolve(manifestArgument);
const outputPath = path.resolve(outputArgument);
const manifestRaw = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);
if (
  manifest.schemaVersion !== 19 ||
  manifest.chainId !== 46630 ||
  manifest.deploymentEvidence?.qualificationPassed !== true
) {
  throw new Error("qualified Schema-19 chain-46630 manifest required");
}
const qualification = manifest.qualification;
for (const field of ["token", "vault", "market", "adapter", "locker"]) {
  if (!qualification?.[field]) throw new Error(`missing qualification ${field}`);
}
if (BigInt(qualification.recoveryBps ?? 0) < 7_500n) {
  throw new Error("qualification recovery threshold not met");
}

const rpcUrl = process.env.ROBYN_SCHEMA19_RPC_URL;
if (!rpcUrl) throw new Error("ROBYN_SCHEMA19_RPC_URL is required");
const parsedRpc = new URL(rpcUrl);
if (!["127.0.0.1", "localhost"].includes(parsedRpc.hostname)) {
  throw new Error("qualified Testnet verification requires the loopback LAN gateway");
}
const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0 }) });
if ((await client.getChainId()) !== 46630) throw new Error("chain mismatch");

const addressByRuntimeLabel = {
  guardianSafe: manifest.guardianSafe ?? manifest.contracts.guardian,
  daoToken: manifest.contracts.daoToken,
  timelock: manifest.contracts.timelock,
  governor: manifest.contracts.governor,
  poolManager: manifest.contracts.poolManager,
  positionManager: manifest.contracts.positionManager,
  quoter: manifest.contracts.quoter,
  stateView: manifest.contracts.stateView,
  permit2: manifest.contracts.permit2,
  universalRouter: manifest.contracts.universalRouter,
  wrappedNative: manifest.contracts.wrappedNative,
  assetRouter: manifest.contracts.assetRouter,
  launchDeployer: manifest.contracts.launchDeployer,
  vaultDeployer: manifest.contracts.vaultDeployer,
  launchFactory: manifest.contracts.launchFactory,
  feeRouter: manifest.contracts.feeRouter,
  daoRewards: manifest.contracts.daoRewardDistributor,
  maintenance: manifest.contracts.maintenanceCoordinator,
  claimsRouter: manifest.contracts.claimsRouter,
  tradeRouter: manifest.contracts.tradeRouter,
  tokenSink: manifest.contracts.tokenSink,
  oracleHook: manifest.contracts.oracleHook,
  adapterDeployer: manifest.contracts.adapterDeployer,
  lockerDeployer: manifest.contracts.lockerDeployer,
  marketDeployer: manifest.contracts.marketDeployer,
  marketFactory: manifest.contracts.marketFactory,
  coordinator: manifest.contracts.coordinator,
};
let contractsVerified = 0;
for (const [label, address] of Object.entries(addressByRuntimeLabel)) {
  if (!address) throw new Error(`missing runtime address ${label}`);
  const code = await client.getCode({ address: getAddress(address) });
  if (!code || code === "0x") throw new Error(`missing runtime ${label}`);
  const expected = manifest.runtimeCodeHashes?.[label];
  if (expected && keccak256(code).toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`runtime changed ${label}`);
  }
  contractsVerified += 1;
}
for (const label of ["token", "vault", "market", "adapter", "locker"]) {
  const code = await client.getCode({ address: getAddress(qualification[label]) });
  if (!code || code === "0x") throw new Error(`missing qualified launch runtime ${label}`);
  contractsVerified += 1;
}

const coordinatorAbi = parseAbi(["function launchMode() view returns (uint8)"]);
const assetRouterAbi = parseAbi([
  "function conversionsPaused() view returns (bool)",
  "function executionRouteStatus(address) view returns ((uint8 kind,uint128 maximumNativeInput,uint128 maximumAssetInput,bytes32 disabledReason,bool enabled,bool runtimeVerified,bool ready,bytes32 reason) status)",
]);
const feeRouterAbi = parseAbi([
  "function paused() view returns (bool)",
  "function totalCreatorNativeLiability() view returns (uint256)",
  "function totalBasketNativeLiability() view returns (uint256)",
  "function totalDaoNativeLiability() view returns (uint256)",
  "function totalTreasuryNativeLiability() view returns (uint256)",
]);
const launchFactoryAbi = parseAbi([
  "function launchCount() view returns (uint256)",
  "function launchTokenById(uint256) view returns (address)",
  "function vaultByToken(address) view returns (address)",
]);
const marketAbi = parseAbi(["function graduated() view returns (bool)"]);
const lockerAbi = parseAbi(["function principalLiquidity() view returns (uint128)"]);
const vaultAbi = parseAbi(["function totalPendingNative() view returns (uint256)"]);
const tokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function rewardAssetCount() view returns (uint256)",
  "function rewardAsset(uint256) view returns (address)",
  "function totalRewardsReceived(uint256) view returns (uint256)",
  "function totalRewardsClaimed(uint256) view returns (uint256)",
]);
const daoAbi = parseAbi([
  "function totalRewardsDeposited() view returns (uint256)",
  "function totalRewardsClaimed() view returns (uint256)",
]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const c = manifest.contracts;
const [
  launchMode,
  assetPaused,
  feePaused,
  launchCount,
  launchToken,
  launchVault,
  graduated,
  lockedPrincipal,
  pendingNative,
  totalSupply,
  creatorLiability,
  basketLiability,
  daoLiability,
  treasuryLiability,
  daoDeposited,
  daoClaimed,
] = await Promise.all([
  client.readContract({ address: c.coordinator, abi: coordinatorAbi, functionName: "launchMode" }),
  client.readContract({ address: c.assetRouter, abi: assetRouterAbi, functionName: "conversionsPaused" }),
  client.readContract({ address: c.feeRouter, abi: feeRouterAbi, functionName: "paused" }),
  client.readContract({ address: c.launchFactory, abi: launchFactoryAbi, functionName: "launchCount" }),
  client.readContract({ address: c.launchFactory, abi: launchFactoryAbi, functionName: "launchTokenById", args: [1n] }),
  client.readContract({ address: c.launchFactory, abi: launchFactoryAbi, functionName: "vaultByToken", args: [qualification.token] }),
  client.readContract({ address: qualification.market, abi: marketAbi, functionName: "graduated" }),
  client.readContract({ address: qualification.locker, abi: lockerAbi, functionName: "principalLiquidity" }),
  client.readContract({ address: qualification.vault, abi: vaultAbi, functionName: "totalPendingNative" }),
  client.readContract({ address: qualification.token, abi: tokenAbi, functionName: "totalSupply" }),
  client.readContract({ address: c.feeRouter, abi: feeRouterAbi, functionName: "totalCreatorNativeLiability" }),
  client.readContract({ address: c.feeRouter, abi: feeRouterAbi, functionName: "totalBasketNativeLiability" }),
  client.readContract({ address: c.feeRouter, abi: feeRouterAbi, functionName: "totalDaoNativeLiability" }),
  client.readContract({ address: c.feeRouter, abi: feeRouterAbi, functionName: "totalTreasuryNativeLiability" }),
  client.readContract({ address: c.daoRewardDistributor, abi: daoAbi, functionName: "totalRewardsDeposited" }),
  client.readContract({ address: c.daoRewardDistributor, abi: daoAbi, functionName: "totalRewardsClaimed" }),
]);
if (Number(launchMode) !== 0 || !assetPaused || !feePaused) {
  throw new Error("qualified Testnet stack is not guardian-Paused");
}
if (launchCount !== 1n || getAddress(launchToken) !== getAddress(qualification.token)) {
  throw new Error("qualified launch identity mismatch");
}
if (getAddress(launchVault) !== getAddress(qualification.vault) || !graduated) {
  throw new Error("qualified launch state mismatch");
}
if (lockedPrincipal !== BigInt(qualification.lockedPrincipal) || lockedPrincipal === 0n) {
  throw new Error("locked principal changed");
}
if ((await client.getBalance({ address: qualification.vault })) < pendingNative) {
  throw new Error("pending basket native value is underbacked");
}
if (totalSupply !== 1_000_000_000n * 10n ** 18n) throw new Error("launch supply changed");
for (const route of manifest.assetRoutes) {
  const status = await client.readContract({
    address: c.assetRouter,
    abi: assetRouterAbi,
    functionName: "executionRouteStatus",
    args: [route.address],
  });
  if (status.enabled) throw new Error(`route remains enabled: ${route.symbol}`);
}
const feeLiabilities =
  creatorLiability + basketLiability + daoLiability + treasuryLiability;
if ((await client.getBalance({ address: c.feeRouter })) < feeLiabilities) {
  throw new Error("fee-router liabilities are underbacked");
}
if (daoClaimed > daoDeposited) throw new Error("DAO rewards overclaimed");
if (
  (await client.getBalance({ address: c.daoRewardDistributor })) <
  daoDeposited - daoClaimed
) {
  throw new Error("DAO rewards are underbacked");
}
const rewardAssetCount = await client.readContract({
  address: qualification.token,
  abi: tokenAbi,
  functionName: "rewardAssetCount",
});
for (let index = 0n; index < rewardAssetCount; index += 1n) {
  const [asset, received, claimed] = await Promise.all([
    client.readContract({ address: qualification.token, abi: tokenAbi, functionName: "rewardAsset", args: [index] }),
    client.readContract({ address: qualification.token, abi: tokenAbi, functionName: "totalRewardsReceived", args: [index] }),
    client.readContract({ address: qualification.token, abi: tokenAbi, functionName: "totalRewardsClaimed", args: [index] }),
  ]);
  if (claimed > received) throw new Error(`reward ${index} overclaimed`);
  const backing = await client.readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [qualification.token],
  });
  if (backing < received - claimed) throw new Error(`reward ${index} underbacked`);
}

const result = {
  schemaVersion: 19,
  chainId: 46630,
  verifiedAt: new Date().toISOString(),
  manifestSha256: createHash("sha256").update(manifestRaw).digest("hex"),
  verificationBlock: Number(await client.getBlockNumber()),
  contractsVerified,
  launchCount: Number(launchCount),
  launch: qualification.token,
  graduated,
  lockedPrincipal: lockedPrincipal.toString(),
  pendingBasketNativeWei: pendingNative.toString(),
  feeLiabilitiesWei: feeLiabilities.toString(),
  daoOutstandingWei: (daoDeposited - daoClaimed).toString(),
  rewardAssetCount: Number(rewardAssetCount),
  state: "guardian-paused-after-focused-qualification",
  passed: true,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(outputPath, serialized, { flag: "wx", mode: 0o600 });
process.stdout.write(serialized);

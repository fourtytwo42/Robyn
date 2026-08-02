#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem";
import { resumeFundingRequirement } from "./lib/schema18-canary-resume.mjs";

const CONTRACT_SHA = "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
const APP_SHA = "8327b250122cd9050a7da6a44e12859e3cf521aa";
const CHAIN_ID = 4663;
const RESERVE = 20_000_000_000_000_000n;
const L1_FEE_RESERVE = 25_000_000_000_000n;
const WORKING_CAPITAL = 2_100_000_000_000n;
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(required("ROBYN_SCHEMA18_GATE1_LIFECYCLE_MANIFEST"));
const gate1Path = path.resolve(required("ROBYN_SCHEMA18_GATE1_AUTHORIZED_MANIFEST"));
const rehearsalRoot = path.resolve(required("ROBYN_SCHEMA18_MAINNET_POSTGRAD_REHEARSAL"));
const outputRoot = path.resolve(required("ROBYN_SCHEMA18_MAINNET_POSTGRAD_MANIFEST_DIRECTORY"));
const rpc = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(rpc)) {
  throw new Error("post-graduation preparation requires loopback LAN gateway");
}
const json = (value) =>
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const command = (name, args) =>
  execFileSync(name, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const git = (...args) => command("git", ["-C", repoRoot, ...args]);
if (git("status", "--porcelain") !== "") throw new Error("manifest sealing requires a clean checkout");
const toolingSha = git("rev-parse", "HEAD");
if (toolingSha !== git("rev-parse", "@{upstream}")) {
  throw new Error("tooling must be pushed before sealing");
}
const sourceRaw = await readFile(sourcePath, "utf8");
const source = JSON.parse(sourceRaw);
const gate1Raw = await readFile(gate1Path, "utf8");
const gate1 = JSON.parse(gate1Raw);
const postdeployment = JSON.parse(
  await readFile(path.join(path.dirname(gate1Path), "live/postdeployment-verification.json"), "utf8"),
);
const stateRaw = await readFile(path.join(rehearsalRoot, "state.json"), "utf8");
const rehearsalState = JSON.parse(stateRaw);
const journalRaw = await readFile(path.join(rehearsalRoot, "transactions.jsonl"), "utf8");
const rehearsalInputRaw = await readFile(
  path.join(rehearsalRoot, "rehearsal-input-manifest.json"),
  "utf8",
);
const rehearsalInput = JSON.parse(rehearsalInputRaw);
const records = journalRaw.trim().split("\n").map(JSON.parse);
if (
  source.schemaVersion !== 18 ||
  source.chainId !== CHAIN_ID ||
  source.releaseSha !== CONTRACT_SHA ||
  source.applicationReleaseSha !== APP_SHA
) {
  throw new Error("Gate 1 lifecycle identity mismatch");
}
if (
  gate1.contractReleaseSha !== CONTRACT_SHA ||
  gate1.applicationReleaseSha !== APP_SHA ||
  gate1.bootstrapStepOneAuthorized !== false ||
  gate1.publicActivationAuthorized !== false
) {
  throw new Error("Gate 1 authorization boundary mismatch");
}
for (const stage of [
  "schedule-reactivation",
  "execute-reactivation",
  "settle",
  "claims",
  "unwind",
  "post-settle",
  "shutdown",
  "reconcile",
]) {
  if (!rehearsalState.completedStages?.includes(stage)) {
    throw new Error(`rehearsal missing stage ${stage}`);
  }
}
if (BigInt(rehearsalState.recoveryBps) < 7_500n) throw new Error("rehearsal recovery below 75%");
const intents = records.filter((record) => record.type === "intent");
const receipts = records.filter((record) => record.type === "receipt");
if (intents.length === 0 || receipts.length !== intents.length) {
  throw new Error("rehearsal receipt ledger incomplete");
}
const keys = new Set();
const hashes = new Set();
for (const receipt of receipts) {
  if (
    receipt.status !== "success" ||
    !receipt.balanceBeforeWei ||
    !receipt.balanceAfterWei ||
    keys.has(receipt.idempotencyKey) ||
    hashes.has(receipt.transactionHash)
  ) {
    throw new Error("failed, incomplete, or duplicate rehearsal receipt");
  }
  keys.add(receipt.idempotencyKey);
  hashes.add(receipt.transactionHash);
}
const phaseCeilings = {};
for (const phase of [
  "recovery",
  "settle",
  "claims",
  "unwind",
  "post-settle",
  "shutdown",
]) {
  const maximum = intents
    .filter((record) => record.phase === phase)
    .reduce(
      (value, record) => (BigInt(record.gasLimit) > value ? BigInt(record.gasLimit) : value),
      0n,
    );
  if (maximum === 0n) throw new Error(`missing rehearsal gas for ${phase}`);
  phaseCeilings[phase] = ((maximum * 3n + 1n) / 2n).toString();
}
const client = createPublicClient({ transport: http(rpc, { timeout: 30_000, retryCount: 0 }) });
if (
  (await client.getChainId()) !== CHAIN_ID ||
  (await client.request({ method: "eth_syncing", params: [] })) !== false
) {
  throw new Error("LAN gateway wrong-chain or syncing");
}
const gateway = await fetch(new URL("/health", rpc)).then(async (response) => {
  if (!response.ok) throw new Error(`gateway health ${response.status}`);
  return response.json();
});
if (
  gateway.status !== "ok" ||
  gateway.activeProvider !== "primary" ||
  gateway.providerSelection !== "operator" ||
  gateway.fallbackTrafficAuthorized !== false
) {
  throw new Error("LAN-only policy is not healthy");
}
const artifact = async (name, sourceName = `${name}.sol`) =>
  JSON.parse(
    await readFile(
      path.join(repoRoot, "packages/contracts/out", sourceName, `${name}.json`),
      "utf8",
    ),
  );
const timelockAbi = parseAbi([
  "function bootstrapFinalized() view returns (bool)",
  "function bootstrapFinalizationReason() view returns (bytes32)",
  "function bootstrapPlanHash(uint8) view returns (bytes32)",
  "function getMinDelay() view returns (uint256)",
]);
const governorAbi = parseAbi(["function unanimousNonce() view returns (uint256)"]);
const coordinatorAbi = parseAbi(["function launchMode() view returns (uint8)"]);
const assetAbi = parseAbi(["function conversionsPaused() view returns (bool)"]);
const feeAbi = parseAbi(["function paused() view returns (bool)"]);
const daoAbi = (await artifact("RobynDaoTokenV3")).abi;
const assetRouterAbi = (await artifact("RobynV4AssetRouter")).abi;
const marketAbi = (await artifact("RobynV4BondingCurveMarket")).abi;
const launchFactoryAbi = (await artifact("RobynNativeLaunchFactoryV4")).abi;
const marketFactoryAbi = (await artifact("RobynV4MarketFactory")).abi;
const c = source.contracts;
const read = (address, abi, functionName, args = []) =>
  client.readContract({ address: getAddress(address), abi, functionName, args });
if (!(await read(c.timelock, timelockAbi, "bootstrapFinalized"))) {
  throw new Error("bootstrap is not irreversibly finalized");
}
if (
  (await read(c.timelock, timelockAbi, "bootstrapPlanHash", [0])).toLowerCase() !==
  source.bootstrap.steps[0].planHash.toLowerCase()
) {
  throw new Error("immutable bootstrap step one hash changed");
}
if (
  Number(await read(c.atomicLaunchCoordinator, coordinatorAbi, "launchMode")) !== 0 ||
  !(await read(c.assetRouter, assetAbi, "conversionsPaused")) ||
  !(await read(c.protocolFeeRouter, feeAbi, "paused"))
) {
  throw new Error("Mainnet is not fully Paused");
}
for (const route of source.routes) {
  const configured = await read(c.assetRouter, assetRouterAbi, "executionRoute", [route.asset]);
  if (configured.enabled) throw new Error(`${route.symbol} is not disabled before resume`);
}
const supply = await read(c.daoToken, daoAbi, "totalSupply");
const ownerBalance = await read(c.daoToken, daoAbi, "balanceOf", [source.deployer]);
const daoClock = BigInt(await read(c.daoToken, daoAbi, "clock"));
if (
  supply === 0n ||
  ownerBalance !== supply ||
  daoClock === 0n ||
  (await read(c.daoToken, daoAbi, "getPastVotes", [source.deployer, daoClock - 1n])) !== supply
) {
  throw new Error("deployer is not the checkpointed unanimous RDAO owner");
}
const unanimousNonce = await read(c.governor, governorAbi, "unanimousNonce");
if (unanimousNonce.toString() !== rehearsalInput.recovery.expectedUnanimousNonce) {
  throw new Error("unanimous nonce changed after rehearsal");
}
const canary = rehearsalInput.canary;
const [
  mappedMarket,
  mappedVault,
  graduated,
  nativeRaised,
  threshold,
  maximumPurchase,
  tokenBalance,
] = await Promise.all([
  read(c.marketFactory, marketFactoryAbi, "marketByToken", [canary.token]),
  read(c.launchFactory, launchFactoryAbi, "vaultByToken", [canary.token]),
  read(canary.market, marketAbi, "graduated"),
  read(canary.market, marketAbi, "nativeRaised"),
  read(canary.market, marketAbi, "graduationThresholdNative"),
  read(canary.market, marketAbi, "maximumCurvePurchase"),
  read(canary.token, daoAbi, "balanceOf", [source.deployer]),
]);
const adapterAbi = (await artifact("RobynV4GraduationAdapter")).abi;
const lockerAbi = (await artifact("RobynV4FeePositionLocker")).abi;
const mappedAdapter = await read(canary.market, marketAbi, "graduationAdapter");
const mappedLocker = await read(mappedAdapter, adapterAbi, "locker");
const lockedPrincipal = await read(mappedLocker, lockerAbi, "principalLiquidity");
const profile = await read(
  c.marketFactory,
  marketFactoryAbi,
  "graduationProfileByToken",
  [canary.token],
);
if (
  getAddress(mappedMarket).toLowerCase() !== canary.market.toLowerCase() ||
  getAddress(mappedVault).toLowerCase() !== canary.vault.toLowerCase() ||
  getAddress(mappedAdapter).toLowerCase() !== canary.adapter.toLowerCase() ||
  getAddress(mappedLocker).toLowerCase() !== canary.locker.toLowerCase() ||
  !graduated ||
  nativeRaised.toString() !== canary.nativeRaisedWei ||
  threshold.toString() !== canary.graduationThresholdWei ||
  maximumPurchase.toString() !== canary.maximumCurvePurchaseWei ||
  tokenBalance.toString() !== canary.projectTokenBalance ||
  lockedPrincipal.toString() !== canary.lockedPrincipal ||
  profile.version.toString() !== canary.profileVersion ||
  profile.targetGraduationNative.toString() !== canary.targetGraduationNativeWei ||
  profile.actualGraduationNative.toString() !== canary.actualGraduationNativeWei
) {
  throw new Error("live graduated Canary changed after rehearsal");
}
if (!rehearsalInput.sourceGate2) {
  throw new Error("rehearsal is missing consumed Gate-2 evidence identity");
}
const sourceGate2StateRaw = await readFile(rehearsalInput.sourceGate2.statePath, "utf8");
const sourceGate2JournalRaw = await readFile(rehearsalInput.sourceGate2.journalPath, "utf8");
if (
  sha256(sourceGate2StateRaw) !== rehearsalInput.sourceGate2.stateSha256 ||
  sha256(sourceGate2JournalRaw) !== rehearsalInput.sourceGate2.journalSha256
) {
  throw new Error("consumed Gate-2 evidence changed after rehearsal");
}
const runtimeIdentities = [];
for (const identity of gate1.runtimeIdentities) {
  const code = await client.getCode({ address: getAddress(identity.address) });
  const actual = code && code !== "0x" ? keccak256(code).toLowerCase() : "0x";
  const expected =
    identity.name === "timelock"
      ? postdeployment.timelock.rawLiveHash.toLowerCase()
      : identity.runtimeCodeHash.toLowerCase();
  if (actual !== expected) throw new Error(`${identity.name} runtime changed`);
  runtimeIdentities.push({
    ...identity,
    qualifiedRuntimeCodeHash: identity.runtimeCodeHash,
    runtimeCodeHash: actual,
  });
}
const fees = await client.estimateFeesPerGas();
const sampledMaxFee = fees.maxFeePerGas ?? fees.gasPrice;
const maxFeePerGas = (sampledMaxFee * 3n + 1n) / 2n;
const measuredGas = receipts.reduce((sum, receipt) => sum + BigInt(receipt.gasUsed), 0n);
const funding = resumeFundingRequirement({
  operationalReserveWei: RESERVE,
  exactFinalPurchaseWei: WORKING_CAPITAL + L1_FEE_RESERVE,
  measuredGas,
  maxFeePerGasWei: maxFeePerGas,
});
const balance = await client.getBalance({ address: getAddress(source.deployer) });
if (balance < funding.requiredBalanceWei) {
  throw new Error(`Gate 2 post-graduation funding shortfall ${funding.requiredBalanceWei - balance} wei`);
}
const manifest = {
  schemaVersion: 18,
  chainId: CHAIN_ID,
  generatedAt: new Date().toISOString(),
  authorizationEligible: true,
  contractReleaseSha: CONTRACT_SHA,
  applicationReleaseSha: APP_SHA,
  operationalToolingSha: toolingSha,
  deployer: getAddress(source.deployer),
  guardianSafe: getAddress(source.guardianSafe),
  contracts: source.contracts,
  bootstrap: source.bootstrap,
  recovery: rehearsalInput.recovery,
  canary,
  sourceGate2: rehearsalInput.sourceGate2,
  routes: source.routes,
  runtimeIdentities,
  sourceGate1: {
    manifestPath: gate1Path,
    manifestSha256: sha256(gate1Raw),
    lifecyclePath: sourcePath,
    lifecycleSha256: sha256(sourceRaw),
  },
  liveState: {
    bootstrapFinalized: true,
    bootstrapFinalizationReason: await read(
      c.timelock,
      timelockAbi,
      "bootstrapFinalizationReason",
    ),
    unanimousNonce: unanimousNonce.toString(),
    observedAt: (await client.getBlock()).timestamp.toString(),
  },
  rehearsal: {
    forkBlock: rehearsalState.forkBlock,
    receiptCount: receipts.length,
    journalSha256: sha256(journalRaw),
    stateSha256: sha256(stateRaw),
    inputSha256: sha256(rehearsalInputRaw),
    recoveryBps: rehearsalState.recoveryBps,
    initialBalanceWei: rehearsalState.initialBalanceWei,
    minimumBalanceWei: rehearsalState.minimumBalanceWei,
    finalBalanceWei: rehearsalState.finalBalanceWei,
  },
  rpcPolicy: {
    applicationAndTransactionUpstream: "lan",
    lan: "192.168.50.173:8547",
    alchemyProbeOnly: true,
    automaticFallback: false,
    degradedLanDisablesFinancialSubmission: true,
    gatewayBlock: (await client.getBlockNumber()).toString(),
  },
  gas: {
    phaseCeilings,
    maxFeePerGasWei: maxFeePerGas.toString(),
    measuredGas: measuredGas.toString(),
    gasWithHeadroom: funding.gasWithHeadroom.toString(),
    allowanceWei: funding.gasAllowanceWei.toString(),
  },
  funding: {
    liveBalanceWei: balance.toString(),
    operationalReserveWei: RESERVE.toString(),
    boundedWorkingCapitalWei: WORKING_CAPITAL.toString(),
    perTransactionL1FeeReserveWei: L1_FEE_RESERVE.toString(),
    requiredBalanceWei: funding.requiredBalanceWei.toString(),
    projectedMarginWei: (balance - funding.requiredBalanceWei).toString(),
  },
  constraints: {
    minimumOutputBps: 9_900,
    deadlineSeconds: 120,
    minimumRecoveryBps: 7_500,
    rewardWaitSeconds: 3_600,
    postUnwindWaitSeconds: 300,
    unanimousTimelockSeconds: 3_600,
  },
  authorization: {
    additionalBridgeAuthorized: false,
    bootstrapFinalizationAuthorized: false,
    unanimousRecoveryAuthorized: false,
    canaryTransactionsAuthorized: false,
    publicActivationAuthorized: false,
    applicationWritesAuthorized: false,
  },
};
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const output = path.join(outputRoot, "schema18-mainnet-gate2-postgrad-recovery-manifest.json");
const raw = `${json(manifest)}\n`;
await writeFile(output, raw, { mode: 0o600, flag: "wx" });
await writeFile(
  path.join(outputRoot, "SHA256SUMS"),
  `${sha256(raw)}  schema18-mainnet-gate2-postgrad-recovery-manifest.json\n`,
  { mode: 0o600, flag: "wx" },
);
process.stdout.write(
  `${json({
    passed: true,
    authorizationEligible: true,
    authorization: manifest.authorization,
    output,
    sha256: sha256(raw),
    funding: manifest.funding,
  })}\n`,
);

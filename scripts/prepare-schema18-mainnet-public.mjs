#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";

const CONTRACT_SHA = "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
const APP_SHA = "8327b250122cd9050a7da6a44e12859e3cf521aa";
const CHAIN_ID = 4663;
const RESERVE = 20_000_000_000_000_000n;
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(required("ROBYN_SCHEMA18_GATE1_LIFECYCLE_MANIFEST"));
const gate1Path = path.resolve(required("ROBYN_SCHEMA18_GATE1_AUTHORIZED_MANIFEST"));
const gate2Root = path.resolve(required("ROBYN_SCHEMA18_GATE2_RECOVERY_EVIDENCE"));
const rehearsalRoot = path.resolve(required("ROBYN_SCHEMA18_MAINNET_PUBLIC_REHEARSAL"));
const applicationEvidencePath = path.resolve(required("ROBYN_SCHEMA18_MAINNET_APPLICATION_EVIDENCE"));
const outputRoot = path.resolve(required("ROBYN_SCHEMA18_MAINNET_PUBLIC_MANIFEST_DIRECTORY"));
const rpc = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(rpc)) {
  throw new Error("Public preparation requires the loopback LAN gateway");
}
const json = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const command = (name, args) => execFileSync(name, args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const git = (...args) => command("git", ["-C", repoRoot, ...args]);
if (git("status", "--porcelain") !== "") throw new Error("Public manifest sealing requires a clean checkout");
const toolingSha = git("rev-parse", "HEAD");
if (toolingSha !== git("rev-parse", "@{upstream}")) throw new Error("Public tooling must be pushed before sealing");

const sourceRaw = await readFile(sourcePath, "utf8");
const source = JSON.parse(sourceRaw);
const gate1Raw = await readFile(gate1Path, "utf8");
const gate1 = JSON.parse(gate1Raw);
const postdeployment = JSON.parse(
  await readFile(
    path.join(path.dirname(gate1Path), "live/postdeployment-verification.json"),
    "utf8",
  ),
);
const gate2StateRaw = await readFile(path.join(gate2Root, "state.json"), "utf8");
const gate2State = JSON.parse(gate2StateRaw);
const gate2JournalRaw = await readFile(path.join(gate2Root, "transactions.jsonl"), "utf8");
const rehearsalStateRaw = await readFile(path.join(rehearsalRoot, "state.json"), "utf8");
const rehearsalState = JSON.parse(rehearsalStateRaw);
const rehearsalJournalRaw = await readFile(path.join(rehearsalRoot, "transactions.jsonl"), "utf8");
const applicationRaw = await readFile(applicationEvidencePath, "utf8");
const applicationEvidence = JSON.parse(applicationRaw);
if (source.schemaVersion !== 18 || source.chainId !== CHAIN_ID || source.releaseSha !== CONTRACT_SHA || source.applicationReleaseSha !== APP_SHA) {
  throw new Error("Schema-18 source identity mismatch");
}
if (gate1.contractReleaseSha !== CONTRACT_SHA || gate1.applicationReleaseSha !== APP_SHA) {
  throw new Error("Gate-1 identity mismatch");
}
for (const stage of ["schedule-reactivation", "execute-reactivation", "settle", "claims", "unwind", "post-settle", "shutdown", "reconcile"]) {
  if (!gate2State.completedStages?.includes(stage)) throw new Error(`Gate 2 missing ${stage}`);
}
if (gate2State.failedRun || BigInt(gate2State.recoveryBps) < 7500n || !gate2State.token) {
  throw new Error("post-graduation Gate-2 recovery did not finish cleanly");
}
const gate2Records = gate2JournalRaw.trim().split("\n").map(JSON.parse);
const gate2Intents = gate2Records.filter((record) => record.type === "intent");
const gate2Receipts = gate2Records.filter((record) => record.type === "receipt");
if (gate2Intents.length === 0 || gate2Receipts.length !== gate2Intents.length) throw new Error("Gate-2 journal is incomplete");
const receiptKeys = new Set();
const receiptHashes = new Set();
for (const receipt of gate2Receipts) {
  const hash = receipt.transactionHash?.toLowerCase();
  if (
    receipt.status !== "success" ||
    !hash ||
    receiptKeys.has(receipt.idempotencyKey) ||
    receiptHashes.has(hash)
  ) throw new Error("Gate-2 receipt failure, duplicate key, or reused hash");
  receiptKeys.add(receipt.idempotencyKey);
  receiptHashes.add(hash);
}
const evidenceHash = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
if (
  applicationEvidence.releaseSha !== APP_SHA ||
  applicationEvidence.contractSha !== CONTRACT_SHA ||
  applicationEvidence.chainId !== CHAIN_ID ||
  applicationEvidence.releasePath !== "/opt/robyn/mainnet-releases/" + APP_SHA ||
  applicationEvidence.immutable !== true ||
  applicationEvidence.reproducible !== true ||
  applicationEvidence.transactionSubmissionInitiallyDisabled !== true ||
  applicationEvidence.productionProcessesStarted !== false ||
  applicationEvidence.alchemyCredentialOrHostPresent !== false ||
  !evidenceHash(applicationEvidence.releaseRootSha256) ||
  !evidenceHash(applicationEvidence.buildValidationSha256) ||
  !evidenceHash(applicationEvidence.reproducibilitySummarySha256) ||
  !evidenceHash(applicationEvidence.serveValidationSha256)
) {
  throw new Error("exact Mainnet application evidence is incomplete");
}

const routerArtifact = JSON.parse(await readFile(path.join(repoRoot, "packages/contracts/out/RobynV4AssetRouter.sol/RobynV4AssetRouter.json"), "utf8"));
const marketArtifact = JSON.parse(await readFile(path.join(repoRoot, "packages/contracts/out/RobynV4MarketFactory.sol/RobynV4MarketFactory.json"), "utf8"));
const daoArtifact = JSON.parse(await readFile(path.join(repoRoot, "packages/contracts/out/RobynDaoTokenV3.sol/RobynDaoTokenV3.json"), "utf8"));
const resumeCalls = source.bootstrap.steps[0].calls.filter((call) => ["resume-asset-conversions", "resume-fee-conversions"].includes(call.label));
const qualifiedStepTwo = source.bootstrap.steps[1];
if (resumeCalls.length !== 2 || qualifiedStepTwo.planHash !== source.bootstrap.steps[1].planHash) throw new Error("qualified Public plan source is incomplete");
const calls = [...resumeCalls, ...qualifiedStepTwo.calls];
const batch = {
  calls,
  targets: calls.map((call) => getAddress(call.target)),
  valuesWei: calls.map((call) => String(call.valueWei)),
  payloads: calls.map((call) => call.data),
  descriptionHash: keccak256(stringToHex("SCHEMA18_GATE3_PUBLIC_ACTIVATION")),
};
const batchHash = keccak256(encodeAbiParameters(
  [{ type: "address[]" }, { type: "uint256[]" }, { type: "bytes[]" }, { type: "bytes32" }],
  [batch.targets, batch.valuesWei.map(BigInt), batch.payloads, batch.descriptionHash],
));
const expectedRoutes = [];
for (const call of qualifiedStepTwo.calls.filter((item) => item.label.includes("public-cap"))) {
  const decoded = decodeFunctionData({ abi: routerArtifact.abi, data: call.data });
  const symbol = call.label.replace("install-", "").replace("-public-cap", "");
  if (decoded.functionName === "configureRoute") {
    const [asset, route] = decoded.args;
    expectedRoutes.push({ symbol, asset:getAddress(asset), kind:"v4", fee:route.fee, tickSpacing:route.tickSpacing, hooks:getAddress(route.hooks), minimumLiquidity:route.minimumLiquidity.toString(), maximumNativeInput:route.maximumNativeInput.toString(), referenceTick:route.referenceTick, maximumReferenceTickDeviation:route.maximumReferenceTickDeviation, enforceReferencePrice:route.enforceReferencePrice, verificationClass:route.verificationClass, enabled:route.enabled });
  } else if (decoded.functionName === "configureWrappedNativeRoute") {
    expectedRoutes.push({ symbol, asset:getAddress(source.contracts.wrappedNative), kind:"wrapped-native", maximumNativeInput:decoded.args[0].toString(), enabled:decoded.args[1] });
  } else {
    throw new Error(`unexpected Public route function ${decoded.functionName}`);
  }
}
if (expectedRoutes.length !== 6 || expectedRoutes.some((route) => !route.enabled)) throw new Error("Public route plan is incomplete");

const rehearsalRecords = rehearsalJournalRaw.trim().split("\n").map(JSON.parse);
const rehearsalIntents = rehearsalRecords.filter((record) => record.type === "intent");
const rehearsalReceipts = rehearsalRecords.filter((record) => record.type === "receipt");
if (!rehearsalState.completedStages?.includes("execute-public") || !rehearsalState.completedStages?.includes("shutdown") || rehearsalIntents.length === 0 || rehearsalReceipts.length !== rehearsalIntents.length) {
  throw new Error("Public rehearsal receipt ledger is incomplete");
}
const phaseCeilings = {};
for (const phase of ["public", "shutdown"]) {
  const maximum = rehearsalIntents.filter((record) => record.phase === phase).reduce((value, record) => BigInt(record.gasLimit) > value ? BigInt(record.gasLimit) : value, 0n);
  if (maximum === 0n) throw new Error(`Public rehearsal missing ${phase} gas`);
  phaseCeilings[phase] = ((maximum * 3n + 1n) / 2n).toString();
}

const client = createPublicClient({ transport:http(rpc,{timeout:30_000,retryCount:0}) });
if ((await client.getChainId()) !== CHAIN_ID || (await client.request({method:"eth_syncing",params:[]})) !== false) throw new Error("LAN gateway is wrong-chain or syncing");
const gateway = await fetch(new URL("/health",rpc)).then(async (response) => { if (!response.ok) throw new Error(`gateway health ${response.status}`); return response.json(); });
if (gateway.status !== "ok" || gateway.activeProvider !== "primary" || gateway.providerSelection !== "operator" || gateway.fallbackTrafficAuthorized !== false) throw new Error("LAN-only policy is not healthy");
const c = source.contracts;
const read = (address,abi,functionName,args=[]) => client.readContract({address:getAddress(address),abi,functionName,args});
const timelockAbi = parseAbi(["function bootstrapFinalized() view returns (bool)","function bootstrapFinalizationReason() view returns (bytes32)","function getMinDelay() view returns (uint256)"]);
const governorAbi = parseAbi(["function unanimousNonce() view returns (uint256)"]);
const coordinatorAbi = parseAbi(["function launchMode() view returns (uint8)"]);
const feeAbi = parseAbi(["function paused() view returns (bool)","function totalNativeLiabilities() view returns (uint256)"]);
if (!(await read(c.timelock,timelockAbi,"bootstrapFinalized")) || Number(await read(c.atomicLaunchCoordinator,coordinatorAbi,"launchMode")) !== 0 || !(await read(c.assetRouter,routerArtifact.abi,"conversionsPaused")) || !(await read(c.protocolFeeRouter,feeAbi,"paused"))) {
  throw new Error("Mainnet is not reconciled Paused after Gate 2");
}
for (const route of source.routes) if ((await read(c.assetRouter,routerArtifact.abi,"executionRoute",[route.asset])).enabled) throw new Error(`${route.symbol} is not disabled after Gate 2`);
const liabilities = await read(c.protocolFeeRouter,feeAbi,"totalNativeLiabilities");
if ((await client.getBalance({address:getAddress(c.protocolFeeRouter)})) < liabilities) throw new Error("fee-router backing deficit");
const supply = await read(c.daoToken,daoArtifact.abi,"totalSupply");
const ownerBalance = await read(c.daoToken,daoArtifact.abi,"balanceOf",[source.deployer]);
const clock = BigInt(await read(c.daoToken,daoArtifact.abi,"clock"));
if (supply === 0n || ownerBalance !== supply || clock === 0n || (await read(c.daoToken,daoArtifact.abi,"getPastVotes",[source.deployer,clock-1n])) !== supply) throw new Error("deployer is not checkpointed unanimous owner");
const unanimousNonce = await read(c.governor,governorAbi,"unanimousNonce");
const canaryProfile = await read(c.marketFactory,marketArtifact.abi,"graduationProfileByToken",[gate2State.token]);
if (canaryProfile.targetGraduationNative !== 10_000_000_000_000_000n || canaryProfile.maximumCurvePurchase !== 1_000_000_000_000_000n) throw new Error("Canary profile snapshot changed");
const currentProfile = await read(c.marketFactory,marketArtifact.abi,"currentGraduationProfile");
if (currentProfile.targetGraduationNative !== 10_000_000_000_000_000n) throw new Error("production profile was installed before authorization");

const runtimeIdentities=[];
for (const identity of gate1.runtimeIdentities) {
  const code=await client.getCode({address:getAddress(identity.address)});
  const actual=code&&code!=="0x"?keccak256(code).toLowerCase():"0x";
  const expected = identity.name === "timelock"
    ? postdeployment.timelock.rawLiveHash.toLowerCase()
    : identity.runtimeCodeHash.toLowerCase();
  if (actual!==expected) throw new Error(`${identity.name} runtime changed`);
  runtimeIdentities.push({
    ...identity,
    qualifiedRuntimeCodeHash:identity.runtimeCodeHash,
    runtimeCodeHash:actual,
  });
}
const fees=await client.estimateFeesPerGas();
const sampledMaxFee=fees.maxFeePerGas??fees.gasPrice;
const maxFeePerGas=(sampledMaxFee*3n+1n)/2n;
const measuredGas=rehearsalReceipts.reduce((sum,receipt)=>sum+BigInt(receipt.gasUsed),0n);
const gasAllowance=measuredGas*maxFeePerGas;
const balance=await client.getBalance({address:getAddress(source.deployer)});
const requiredBalance=RESERVE+gasAllowance;
if (balance<requiredBalance) throw new Error(`Public funding shortfall ${requiredBalance-balance} wei`);
const manifest={
  schemaVersion:18,chainId:CHAIN_ID,generatedAt:new Date().toISOString(),authorizationEligible:true,
  contractReleaseSha:CONTRACT_SHA,applicationReleaseSha:APP_SHA,operationalToolingSha:toolingSha,
  deployer:getAddress(source.deployer),guardianSafe:getAddress(source.guardianSafe),contracts:source.contracts,routes:source.routes,runtimeIdentities,
  canary:{launchToken:getAddress(gate2State.token),profileVersion:canaryProfile.version.toString(),targetGraduationNativeWei:canaryProfile.targetGraduationNative.toString(),maximumCurvePurchaseWei:canaryProfile.maximumCurvePurchase.toString(),recoveryBps:gate2State.recoveryBps,reconciledAt:gate2State.reconciledAt},
  publicActivation:{expectedUnanimousNonce:unanimousNonce.toString(),batch,batchHash,profile:{version:(currentProfile.version+1n).toString(),targetGraduationNativeWei:"6000000000000000000",maximumCurvePurchaseWei:"500000000000000000"},routes:expectedRoutes},
  sourceGate1:{manifestPath:gate1Path,manifestSha256:sha256(gate1Raw),lifecyclePath:sourcePath,lifecycleSha256:sha256(sourceRaw)},
  gate2:{evidenceRoot:gate2Root,stateSha256:sha256(gate2StateRaw),journalSha256:sha256(gate2JournalRaw),receiptCount:gate2Receipts.length},
  rehearsal:{evidenceRoot:rehearsalRoot,stateSha256:sha256(rehearsalStateRaw),journalSha256:sha256(rehearsalJournalRaw),receiptCount:rehearsalReceipts.length},
  application:{...applicationEvidence,evidencePath:applicationEvidencePath,evidenceSha256:sha256(applicationRaw),domain:"https://sherwoodforest.trade",transactionSubmissionInitiallyDisabled:true},
  rpcPolicy:{applicationAndTransactionUpstream:"lan",lan:"192.168.50.173:8547",alchemyProbeOnly:true,automaticFallback:false,degradedLanDisablesFinancialSubmission:true,gatewayBlock:(await client.getBlockNumber()).toString()},
  gas:{phaseCeilings,maxFeePerGasWei:maxFeePerGas.toString(),measuredGas:measuredGas.toString(),allowanceWei:gasAllowance.toString()},
  funding:{liveBalanceWei:balance.toString(),operationalReserveWei:RESERVE.toString(),requiredBalanceWei:requiredBalance.toString(),projectedMarginWei:(balance-requiredBalance).toString()},
  emergencyControls:{guardianPauseLaunches:true,guardianPauseConversions:true,guardianDisableRoutes:true,applicationTransactionDisable:true},
  monitoring:{continuousFirstHours:24,lanOnly:true,tenMinuteAccountingSamples:true},
  authorization:{additionalBridgeAuthorized:false,publicActivationAuthorized:false,applicationWritesAuthorized:false},
};
await mkdir(outputRoot,{recursive:true,mode:0o700});
const output=path.join(outputRoot,"schema18-mainnet-gate3-public-activation-manifest.json");
const raw=`${json(manifest)}\n`;
await writeFile(output,raw,{mode:0o600,flag:"wx"});
await writeFile(path.join(outputRoot,"SHA256SUMS"),`${sha256(raw)}  schema18-mainnet-gate3-public-activation-manifest.json\n`,{mode:0o600,flag:"wx"});
process.stdout.write(`${json({passed:true,authorizationEligible:true,output,sha256:sha256(raw),funding:manifest.funding,authorization:manifest.authorization})}\n`);

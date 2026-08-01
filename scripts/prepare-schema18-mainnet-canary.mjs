#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem";

const CONTRACT_SHA = "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
const APP_SHA = "8327b250122cd9050a7da6a44e12859e3cf521aa";
const CHAIN_ID = 4663;
const RESERVE = 20_000_000_000_000_000n;
const PRINCIPAL = 10_101_010_101_010_102n;
const ROUTE_CAPITAL = 10_000_000_000_000n;
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(required("ROBYN_SCHEMA18_GATE1_LIFECYCLE_MANIFEST"));
const gate1Path = path.resolve(required("ROBYN_SCHEMA18_GATE1_AUTHORIZED_MANIFEST"));
const rehearsalRoot = path.resolve(required("ROBYN_SCHEMA18_MAINNET_CANARY_REHEARSAL"));
const outputRoot = path.resolve(required("ROBYN_SCHEMA18_MAINNET_CANARY_MANIFEST_DIRECTORY"));
const rpc = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(rpc)) throw new Error("preparation requires loopback LAN gateway");
const json = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const command = (name, args) => execFileSync(name, args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const git = (...args) => command("git", ["-C", repoRoot, ...args]);
if (git("status", "--porcelain") !== "") throw new Error("manifest sealing requires a clean checkout");
const toolingSha = git("rev-parse", "HEAD");
if (toolingSha !== git("rev-parse", "@{upstream}")) throw new Error("tooling must be pushed before sealing");
const sourceRaw = await readFile(sourcePath, "utf8"); const source = JSON.parse(sourceRaw);
const gate1Raw = await readFile(gate1Path, "utf8"); const gate1 = JSON.parse(gate1Raw);
const postdeployment = JSON.parse(await readFile(path.join(path.dirname(gate1Path), "live/postdeployment-verification.json"), "utf8"));
const stateRaw = await readFile(path.join(rehearsalRoot, "state.json"), "utf8"); const rehearsalState = JSON.parse(stateRaw);
const journalRaw = await readFile(path.join(rehearsalRoot, "transactions.jsonl"), "utf8");
const records = journalRaw.trim().split("\n").map(JSON.parse);
if (source.schemaVersion !== 18 || source.chainId !== CHAIN_ID || source.releaseSha !== CONTRACT_SHA || source.applicationReleaseSha !== APP_SHA) throw new Error("Gate 1 lifecycle identity mismatch");
if (gate1.contractReleaseSha !== CONTRACT_SHA || gate1.applicationReleaseSha !== APP_SHA || gate1.bootstrapStepOneAuthorized !== false || gate1.publicActivationAuthorized !== false) throw new Error("Gate 1 authorization boundary mismatch");
for (const stage of ["bootstrap1","routes","launch","settle","claims","unwind","post-settle","shutdown","reconcile"]) if (!rehearsalState.completedStages?.includes(stage)) throw new Error(`rehearsal missing stage ${stage}`);
if (BigInt(rehearsalState.recoveryBps) < 7500n) throw new Error("rehearsal recovery below 75%");
const intents = records.filter((record) => record.type === "intent");
const receipts = records.filter((record) => record.type === "receipt");
if (intents.length === 0 || receipts.length !== intents.length) throw new Error("rehearsal receipt ledger incomplete");
const keys = new Set();
for (const receipt of receipts) { if (receipt.status !== "success" || keys.has(receipt.idempotencyKey)) throw new Error("failed or duplicate rehearsal receipt"); keys.add(receipt.idempotencyKey); }
const phaseCeilings = {};
for (const phase of ["bootstrap","routes","launch","settle","claims","unwind","post-settle","shutdown"]) {
  const max = intents.filter((record) => record.phase === phase).reduce((value, record) => BigInt(record.gasLimit) > value ? BigInt(record.gasLimit) : value, 0n);
  if (max === 0n) throw new Error(`missing rehearsal gas for ${phase}`);
  phaseCeilings[phase] = ((max * 3n + 1n) / 2n).toString();
}
const client = createPublicClient({ transport: http(rpc, { timeout: 30_000, retryCount: 0 }) });
if ((await client.getChainId()) !== CHAIN_ID || (await client.request({ method: "eth_syncing", params: [] })) !== false) throw new Error("LAN gateway wrong-chain or syncing");
const gateway = await fetch(new URL("/health", rpc)).then(async (response) => { if (!response.ok) throw new Error(`gateway health ${response.status}`); return response.json(); });
if (gateway.status !== "ok" || gateway.activeProvider !== "primary" || gateway.providerSelection !== "operator" || gateway.fallbackTrafficAuthorized !== false) throw new Error("LAN-only policy is not healthy");
const timelockAbi = parseAbi(["function bootstrapActive() view returns (bool)","function bootstrapDeadline() view returns (uint48)","function nextBootstrapStep() view returns (uint8)","function bootstrapPlanHash(uint8) view returns (bytes32)"]);
const coordinatorAbi = parseAbi(["function launchMode() view returns (uint8)"]);
const assetAbi = parseAbi(["function conversionsPaused() view returns (bool)"]);
const feeAbi = parseAbi(["function paused() view returns (bool)","function totalNativeLiabilities() view returns (uint256)"]);
const c = source.contracts; const read = (address, abi, functionName, args=[]) => client.readContract({ address:getAddress(address), abi, functionName, args });
const now = (await client.getBlock()).timestamp;
const bootstrapDeadline = BigInt(await read(c.timelock,timelockAbi,"bootstrapDeadline"));
if (!(await read(c.timelock,timelockAbi,"bootstrapActive")) || Number(await read(c.timelock,timelockAbi,"nextBootstrapStep")) !== 0 || bootstrapDeadline < now + 21600n) throw new Error("bootstrap is not Gate-2 ready with six hours remaining");
if ((await read(c.timelock,timelockAbi,"bootstrapPlanHash",[0])).toLowerCase() !== source.bootstrap.steps[0].planHash.toLowerCase()) throw new Error("immutable bootstrap step one hash changed");
if (Number(await read(c.atomicLaunchCoordinator,coordinatorAbi,"launchMode")) !== 0 || !(await read(c.assetRouter,assetAbi,"conversionsPaused")) || !(await read(c.protocolFeeRouter,feeAbi,"paused")) || (await read(c.protocolFeeRouter,feeAbi,"totalNativeLiabilities")) !== 0n) throw new Error("Mainnet is not zero-liability Paused");
const runtimeIdentities=[];
for (const identity of gate1.runtimeIdentities) {
  const code = await client.getCode({address:getAddress(identity.address)}); const actual = code && code !== "0x" ? keccak256(code).toLowerCase() : "0x";
  const expected = identity.name === "timelock" ? postdeployment.timelock.rawLiveHash.toLowerCase() : identity.runtimeCodeHash.toLowerCase();
  if (actual !== expected) throw new Error(`${identity.name} runtime changed`);
  runtimeIdentities.push({...identity,qualifiedRuntimeCodeHash:identity.runtimeCodeHash,runtimeCodeHash:actual});
}
const fees = await client.estimateFeesPerGas(); const sampledMaxFee = fees.maxFeePerGas ?? fees.gasPrice; const maxFeePerGas = (sampledMaxFee * 3n + 1n) / 2n;
const measuredGas = receipts.reduce((sum, receipt) => sum + BigInt(receipt.gasUsed), 0n);
const gasAllowance = measuredGas * maxFeePerGas;
const balance = await client.getBalance({address:getAddress(source.deployer)});
const requiredBalance = RESERVE + PRINCIPAL + ROUTE_CAPITAL + gasAllowance;
if (balance < requiredBalance) throw new Error(`Gate 2 funding shortfall ${requiredBalance-balance} wei`);
const manifest = {
  schemaVersion:18, chainId:CHAIN_ID, generatedAt:new Date().toISOString(), contractReleaseSha:CONTRACT_SHA, applicationReleaseSha:APP_SHA, operationalToolingSha:toolingSha,
  deployer:getAddress(source.deployer), guardianSafe:getAddress(source.guardianSafe), contracts:source.contracts, bootstrap:source.bootstrap, routes:source.routes, runtimeIdentities,
  sourceGate1:{manifestPath:gate1Path,manifestSha256:sha256(gate1Raw),lifecyclePath:sourcePath,lifecycleSha256:sha256(sourceRaw)},
  rehearsal:{forkBlock:rehearsalState.forkBlock,receiptCount:receipts.length,journalSha256:sha256(journalRaw),stateSha256:sha256(stateRaw),recoveryBps:rehearsalState.recoveryBps},
  rpcPolicy:{applicationAndTransactionUpstream:"lan",lan:"192.168.50.173:8547",alchemyProbeOnly:true,automaticFallback:false,degradedLanDisablesFinancialSubmission:true,gatewayBlock:(await client.getBlockNumber()).toString()},
  gas:{phaseCeilings,maxFeePerGasWei:maxFeePerGas.toString(),measuredGas:measuredGas.toString(),allowanceWei:gasAllowance.toString()},
  funding:{liveBalanceWei:balance.toString(),operationalReserveWei:RESERVE.toString(),canaryPrincipalWei:PRINCIPAL.toString(),routeWorkingCapitalWei:ROUTE_CAPITAL.toString(),requiredBalanceWei:requiredBalance.toString(),projectedMarginWei:(balance-requiredBalance).toString()},
  constraints:{minimumOutputBps:9900,deadlineSeconds:120,minimumRecoveryBps:7500,rewardWaitSeconds:3600,postUnwindWaitSeconds:300,minimumBootstrapSecondsRemaining:21600},
  authorization:{additionalBridgeAuthorized:false,bootstrapStepOneAuthorized:false,canaryTransactionsAuthorized:false,publicActivationAuthorized:false,applicationWritesAuthorized:false}
};
await mkdir(outputRoot,{recursive:true,mode:0o700});
const output=path.join(outputRoot,"schema18-mainnet-gate2-canary-manifest.json"); const raw=`${json(manifest)}\n`;
await writeFile(output,raw,{mode:0o600,flag:"wx"}); await writeFile(path.join(outputRoot,"SHA256SUMS"),`${sha256(raw)}  schema18-mainnet-gate2-canary-manifest.json\n`,{mode:0o600,flag:"wx"});
process.stdout.write(`${json({passed:true,authorizationEligible:true,authorization:manifest.authorization,output,sha256:sha256(raw),funding:manifest.funding})}\n`);

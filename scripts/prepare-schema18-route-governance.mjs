#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";

const CHAIN_ID = 4663;
const CONTRACT_SHA = "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
const APPLICATION_SHA = "19e207c1d1ef1defd55d2ff8cf73c01a306a4a3b";
const POLICY_HASH = "ec5c8f9c444623f2303504416bf5192c951bc17d6af191c3bf08a2c52cc483c0";
const QUALIFICATION = "/home/hendo420/robyn-evidence/schema18-asset-route-remediation/final-qualification-de5d61f/qualification-summary.json";
const POLICY = "config/protocol/robinhood-mainnet-support-policy.json";
const DEPLOYMENT = process.env.ROBYN_SCHEMA18_DEPLOYMENT_MANIFEST ?? "/home/hendo420/robyn-evidence/schema18-asset-route-remediation/application-19e207c/deployments-4663-mainnet.json";
const RPC = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
const OUTPUT = path.resolve(process.env.ROBYN_SCHEMA18_ROUTE_GOVERNANCE_OUTPUT ?? "/home/hendo420/robyn-evidence/schema18-asset-route-remediation/governance-current-state");
const ANVIL_PORT = Number(process.env.ROBYN_SCHEMA18_ROUTE_REHEARSAL_PORT ?? "28547");
const RESERVE = 20_000_000_000_000_000n;
const json = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2) + "\n";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(RPC)) throw new Error("LAN loopback gateway is required");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (git("status", "--porcelain") !== "") throw new Error("route manifest preparation requires a clean checkout");
const toolingSha = git("rev-parse", "HEAD");
if (toolingSha !== git("rev-parse", "@{upstream}")) throw new Error("route manifest tooling must be pushed before rehearsal");

const [policyRaw, qualificationRaw, deploymentRaw] = await Promise.all([
  readFile(POLICY, "utf8"),
  readFile(QUALIFICATION, "utf8"),
  readFile(DEPLOYMENT, "utf8"),
]);
const policy = JSON.parse(policyRaw);
const qualification = JSON.parse(qualificationRaw);
const deployment = JSON.parse(deploymentRaw);
const routerAbi = parseAbi([
  "function configureRoute(address asset,(uint24 fee,int24 tickSpacing,address hooks,uint128 minimumLiquidity,uint128 maximumNativeInput,int24 referenceTick,uint24 maximumReferenceTickDeviation,bool enforceReferencePrice,bytes32 verificationClass,bool enabled) route)",
  "function route(address asset) view returns ((uint24 fee,int24 tickSpacing,address hooks,uint128 minimumLiquidity,uint128 maximumNativeInput,int24 referenceTick,uint24 maximumReferenceTickDeviation,bool enforceReferencePrice,bytes32 verificationClass,bool enabled) route)",
  "function executionRoute(address asset) view returns ((uint8 kind,uint128 maximumNativeInput,uint128 maximumAssetInput,bytes32 disabledReason,bool enabled) route)",
  "function disableRoute(address asset,bytes32 reason)",
]);
if (policy.policyHash !== POLICY_HASH || qualification.policyHash !== POLICY_HASH || qualification.status !== "passed") throw new Error("qualified policy identity mismatch");
if (deployment.schemaVersion !== 18 || deployment.chainId !== CHAIN_ID || deployment.releaseSha !== CONTRACT_SHA) throw new Error("Schema-18 deployment identity mismatch");
const router = getAddress(deployment.contracts.assetRouter);
const governor = getAddress(deployment.contracts.governor);
const timelock = getAddress(deployment.contracts.timelock);
const guardian = getAddress(deployment.contracts.guardian);
const deployer = getAddress(deployment.deployer);
const qualified = qualification.routes.filter((route) => route.kind !== "wrapped-native");
if (qualified.length !== 12) throw new Error("expected 12 qualified v4 routes");

const routeTuple = qualified.map((route) => ({
  symbol: route.symbol,
  asset: getAddress(route.asset),
  poolId: route.poolId,
  route: {
    fee: route.fee,
    tickSpacing: route.tickSpacing,
    hooks: getAddress(route.hooks),
    minimumLiquidity: BigInt(route.minimumLiquidity),
    maximumNativeInput: BigInt(route.capWei),
    referenceTick: route.referenceTick,
    maximumReferenceTickDeviation: route.maximumReferenceTickDeviation,
    enforceReferencePrice: route.enforceReferencePrice,
    verificationClass: route.verificationClass,
    enabled: true,
  },
}));
const calls = routeTuple.map((entry) => ({
  label: `configure-${entry.symbol.toLowerCase()}`,
  target: router,
  valueWei: "0",
  data: encodeFunctionData({ abi: routerAbi, functionName: "configureRoute", args: [entry.asset, entry.route] }),
}));
const targets = calls.map((call) => call.target);
const values = calls.map(() => 0n);
const payloads = calls.map((call) => call.data);
const descriptionHash = keccak256(stringToHex("SCHEMA18_ASSET_ROUTE_REMEDIATION_V1"));
const governorAbi = parseAbi([
  "function unanimousNonce() view returns (uint256)",
  "function scheduleUnanimous(address[] targets,uint256[] values,bytes[] calldatas,bytes32 descriptionHash) returns (bytes32)",
]);
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function executeBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt) payable",
  "function hashOperationBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt) view returns (bytes32)",
]);
const live = createPublicClient({ transport: http(RPC, { timeout: 30_000, retryCount: 0 }) });
if (await live.getChainId() !== CHAIN_ID || await live.request({ method: "eth_syncing", params: [] }) !== false) throw new Error("LAN RPC wrong-chain or syncing");
const gateway = await fetch(new URL("/health", RPC)).then((response) => response.json());
if (gateway.status !== "ok" || gateway.activeProvider !== "primary" || gateway.fallbackTrafficAuthorized !== false) throw new Error("LAN-only gateway policy is not healthy");
const forkBlock = await live.getBlockNumber();
const unanimousNonce = await live.readContract({ address: governor, abi: governorAbi, functionName: "unanimousNonce" });
const delaySeconds = await live.readContract({ address: timelock, abi: timelockAbi, functionName: "getMinDelay" });
if (delaySeconds !== 3600n) throw new Error("unexpected Timelock delay");
const balanceWei = await live.getBalance({ address: deployer });
if (balanceWei <= RESERVE) throw new Error("deployer reserve is not positive");
const runtimeIdentities = [];
for (const [name, address] of Object.entries({ router, governor, timelock, guardian })) {
  const code = await live.getCode({ address });
  if (!code || code === "0x") throw new Error(`${name} runtime missing`);
  runtimeIdentities.push({ name, address, runtimeCodeHash: keccak256(code) });
}
const salt = keccak256(encodeAbiParameters(
  [{type:"string"},{type:"uint256"},{type:"address"},{type:"uint256"},{type:"address"},{type:"address[]"},{type:"uint256[]"},{type:"bytes[]"},{type:"bytes32"}],
  ["ROBYN_SCHEMA17_UNANIMOUS_OPERATION", BigInt(CHAIN_ID), governor, unanimousNonce, deployer, targets, values, payloads, descriptionHash],
));
const operationId = await live.readContract({ address: timelock, abi: timelockAbi, functionName: "hashOperationBatch", args: [targets, values, payloads, `0x${"00".repeat(32)}`, salt] });

await mkdir(OUTPUT, { recursive: true });
const anvilLog = [];
const child = spawn("anvil", ["--fork-url", RPC, "--fork-block-number", forkBlock.toString(), "--chain-id", String(CHAIN_ID), "--port", String(ANVIL_PORT), "--host", "127.0.0.1", "--silent"], { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (chunk) => anvilLog.push(chunk.toString()));
child.stderr.on("data", (chunk) => anvilLog.push(chunk.toString()));
const forkRpc = `http://127.0.0.1:${ANVIL_PORT}`;
const fork = createPublicClient({ transport: http(forkRpc, { timeout: 30_000, retryCount: 0 }) });
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if (await fork.getChainId() === CHAIN_ID) break; } catch {}
    if (attempt === 59) throw new Error("Anvil fork did not start");
    await sleep(250);
  }
  const rpc = (method, params = []) => fork.request({ method, params });
  for (const account of [deployer, guardian]) {
    await rpc("anvil_impersonateAccount", [account]);
    await rpc("anvil_setBalance", [account, "0x8ac7230489e80000"]);
  }
  const receipts = [];
  const send = async (phase, from, to, data) => {
    const hash = await rpc("eth_sendTransaction", [{ from, to, data, value: "0x0" }]);
    const receipt = await fork.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${phase} failed`);
    receipts.push({ phase, transactionHash: hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice, status: receipt.status });
    return receipt;
  };
  await send("schedule", deployer, governor, encodeFunctionData({ abi: governorAbi, functionName: "scheduleUnanimous", args: [targets, values, payloads, descriptionHash] }));
  await rpc("evm_increaseTime", [Number(delaySeconds) + 1]);
  await rpc("evm_mine");
  await send("execute", deployer, timelock, encodeFunctionData({ abi: timelockAbi, functionName: "executeBatch", args: [targets, values, payloads, `0x${"00".repeat(32)}`, salt] }));
  for (const entry of routeTuple) {
    const actual = await fork.readContract({ address: router, abi: routerAbi, functionName: "route", args: [entry.asset] });
    if (!actual.enabled || actual.maximumNativeInput !== entry.route.maximumNativeInput || actual.minimumLiquidity !== entry.route.minimumLiquidity || actual.fee !== entry.route.fee || actual.tickSpacing !== entry.route.tickSpacing || getAddress(actual.hooks) !== entry.route.hooks) throw new Error(`${entry.symbol} route mismatch after execution`);
  }
  const reason = keccak256(stringToHex("SCHEMA18_ROUTE_REHEARSAL_ROLLBACK"));
  for (const entry of routeTuple) await send(`disable-${entry.symbol}`, guardian, router, encodeFunctionData({ abi: routerAbi, functionName: "disableRoute", args: [entry.asset, reason] }));
  for (const entry of routeTuple) {
    const actual = await fork.readContract({ address: router, abi: routerAbi, functionName: "executionRoute", args: [entry.asset] });
    if (actual.enabled) throw new Error(`${entry.symbol} guardian rollback failed`);
  }
  const rehearsal = { schemaVersion: 18, executionMode: "local-fork-broadcast", chainId: CHAIN_ID, forkBlock, operationId, receiptCount: receipts.length, phases: [...new Set(receipts.map((receipt) => receipt.phase.startsWith("disable-") ? "rollback" : receipt.phase))], receipts, qualifiedEvidence: qualification.evidenceHash, passed: true };
  const rehearsalRaw = json(rehearsal);
  await writeFile(path.join(OUTPUT, "rehearsal.json"), rehearsalRaw);
  const manifest = {
    schemaVersion: 18,
    kind: "schema18-asset-route-governance",
    authorizationState: "not-authorized",
    chainId: CHAIN_ID,
    contractSha: CONTRACT_SHA,
    applicationQualificationSha: APPLICATION_SHA,
    toolingSha,
    policyHash: POLICY_HASH,
    qualificationEvidenceHash: qualification.evidenceHash,
    qualificationSummarySha256: sha256(qualificationRaw),
    rehearsalSha256: sha256(rehearsalRaw),
    forkBlock: forkBlock.toString(),
    rpcPolicy: { primary: "lan-only", probeOnly: true, automaticFallback: false },
    governance: { governor, timelock, guardian, deployer, unanimousNonce: unanimousNonce.toString(), delaySeconds: delaySeconds.toString(), descriptionHash, salt, operationId },
    operation: { calls, batchCalldataHash: keccak256(encodeAbiParameters([{type:"address[]"},{type:"uint256[]"},{type:"bytes[]"},{type:"bytes32"}], [targets, values, payloads, descriptionHash])) },
    routes: routeTuple.map((entry) => ({ ...entry, route: { ...entry.route, minimumLiquidity: entry.route.minimumLiquidity.toString(), maximumNativeInput: entry.route.maximumNativeInput.toString() } })),
    runtimeIdentities,
    funding: { balanceWei: balanceWei.toString(), protectedReserveWei: RESERVE.toString(), positiveMarginWei: (balanceWei - RESERVE).toString(), additionalBridgeAuthorized: false },
    rollback: { guardian, action: "disable all configured routes", reason },
    prohibitions: ["no automatic replay", "no Alchemy application traffic", "no contract redeployment", "no multihop routing"],
  };
  const manifestRaw = json(manifest);
  await writeFile(path.join(OUTPUT, "schema18-route-governance-manifest.json"), manifestRaw);
  await writeFile(path.join(OUTPUT, "SHA256SUMS"), `${sha256(rehearsalRaw)}  rehearsal.json\n${sha256(manifestRaw)}  schema18-route-governance-manifest.json\n`);
  console.log(json({ output: OUTPUT, manifestSha256: sha256(manifestRaw), operationId, receiptCount: receipts.length, forkBlock, passed: true }));
} finally {
  child.kill("SIGTERM");
  await writeFile(path.join(OUTPUT, "anvil.log"), anvilLog.join(""));
}

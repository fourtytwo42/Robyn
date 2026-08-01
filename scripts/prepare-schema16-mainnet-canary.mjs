#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAddress, http, keccak256, parseAbi, stringToHex } from "viem";
import { validateMainnetReceiptLedger } from "./lib/mainnet-receipt-ledger.mjs";

const RELEASE_SHA = "a8d54bb125d091be0cea010262a68a2baaceda30";
const CHAIN_ID = 4663;
const OPERATIONAL_RESERVE_WEI = 20_000_000_000_000_000n;
const ROUTE_WORKING_CAPITAL_WEI = 10_000_000_000_000n;
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rehearsalRoot = path.resolve(required("ROBYN_MAINNET_CANARY_REHEARSAL"));
const deploymentManifestPath = path.resolve(required("ROBYN_MAINNET_DEPLOYMENT_MANIFEST"));
const postdeploymentPath = path.resolve(required("ROBYN_MAINNET_POSTDEPLOYMENT_VERIFICATION"));
const outputRoot = path.resolve(required("ROBYN_MAINNET_CANARY_MANIFEST_DIRECTORY"));
const rpc = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(rpc)) throw new Error("canary preparation requires the loopback LAN gateway");

const json = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const command = (name, args) => execFileSync(name, args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const git = (...args) => command("git", ["-C", repoRoot, ...args]);
if (git("status", "--porcelain") !== "") throw new Error("canary manifest preparation requires a clean checkout");
const toolingSha = git("rev-parse", "HEAD");
if (toolingSha !== git("rev-parse", "@{upstream}")) throw new Error("canary tooling must be pushed before sealing");

const deploymentRaw = await readFile(deploymentManifestPath, "utf8");
const deployment = JSON.parse(deploymentRaw);
const postdeploymentRaw = await readFile(postdeploymentPath, "utf8");
const postdeployment = JSON.parse(postdeploymentRaw);
const evidenceRaw = await readFile(path.join(rehearsalRoot, "gas-evidence.json"), "utf8");
const evidence = JSON.parse(evidenceRaw);
const planRaw = await readFile(path.join(rehearsalRoot, "canary-plan.json"), "utf8");
const plan = JSON.parse(planRaw);
const capitalRaw = await readFile(path.join(rehearsalRoot, "capital-ledger.json"), "utf8");
const capital = JSON.parse(capitalRaw);
const localDeployment = JSON.parse(await readFile(path.join(rehearsalRoot, "local-deployment.json"), "utf8"));
const productionConfig = JSON.parse(await readFile(path.join(repoRoot, "config/protocol/robinhood-mainnet-rehearsal.json"), "utf8"));
if (
  deployment.releaseSha !== RELEASE_SHA ||
  deployment.chainId !== CHAIN_ID ||
  deployment.canaryAuthorized !== false ||
  deployment.publicActivationAuthorized !== false ||
  postdeployment.status !== "passed" ||
  postdeployment.releaseSha !== RELEASE_SHA ||
  plan.releaseSha !== RELEASE_SHA ||
  capital.passed !== true
) throw new Error("Paused deployment or rehearsal identity mismatch");

const canaryPhases = [
  "canary-activation", "canary-launch", "bonding-graduation", "post-graduation-trades",
  "fee-settlement", "reward-claims", "canary-unwind", "post-unwind-settlement",
];
const validation = validateMainnetReceiptLedger(evidence, {
  releaseSha: RELEASE_SHA,
  productionConfigHash: deployment.productionConfigHash,
  requiredPhases: canaryPhases,
});
const client = createPublicClient({ transport: http(rpc, { timeout: 30_000, retryCount: 0 }) });
if ((await client.getChainId()) !== CHAIN_ID) throw new Error("LAN gateway returned the wrong chain");
const syncing = await client.request({ method: "eth_syncing", params: [] });
if (syncing !== false) throw new Error("LAN gateway is syncing");
const gatewayHealth = await fetch(new URL("/health", rpc)).then(async (response) => {
  if (!response.ok) throw new Error(`gateway health returned ${response.status}`);
  return response.json();
});
if (
  gatewayHealth.status !== "ok" || gatewayHealth.activeProvider !== "primary" ||
  gatewayHealth.providerSelection !== "operator" || gatewayHealth.fallbackTrafficAuthorized !== false
) throw new Error("LAN-only RPC policy is not healthy");

const contracts = Object.fromEntries(Object.entries(deployment.predictedContracts).map(([name, address]) => [name, getAddress(address)]));
const codeHash = async (address) => {
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error(`missing runtime at ${address}`);
  return keccak256(code).toLowerCase();
};
for (const identity of deployment.runtimeIdentities) {
  if ((await codeHash(getAddress(identity.address))) !== identity.runtimeCodeHash.toLowerCase()) throw new Error(`${identity.name} runtime changed`);
}
const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
const coordinatorAbi = parseAbi(["function launchMode() view returns (uint8)"]);
const assetRouterAbi = parseAbi(["function conversionsPaused() view returns (bool)"]);
const feeRouterAbi = parseAbi(["function paused() view returns (bool)", "function totalNativeLiabilities() view returns (uint256)"]);
if (
  Number(await read(contracts.coordinator, coordinatorAbi, "launchMode")) !== 0 ||
  !(await read(contracts.assetRouter, assetRouterAbi, "conversionsPaused")) ||
  !(await read(contracts.feeRouter, feeRouterAbi, "paused")) ||
  (await read(contracts.feeRouter, feeRouterAbi, "totalNativeLiabilities")) !== 0n
) throw new Error("live protocol is not in the sealed zero-liability Paused state");

const governorAbi = parseAbi(["function hashProposal(address[] targets,uint256[] values,bytes[] calldatas,bytes32 descriptionHash) view returns (uint256)"]);
const descriptionHash = keccak256(stringToHex(plan.activation.description));
const proposalId = await read(contracts.governor, governorAbi, "hashProposal", [
  plan.activation.targets, plan.activation.values.map(BigInt), plan.activation.calldatas, descriptionHash,
]);
const budgetPhases = [...canaryPhases, "routes", "shutdown"];
const phaseGas = Object.fromEntries(budgetPhases.map((phase) => {
  const measured = evidence.transactions.filter((transaction) => {
    if (phase === "shutdown") return transaction.phase === "post-unwind-settlement" && transaction.label.startsWith("guardian-");
    if (phase === "post-unwind-settlement") return transaction.phase === phase && !transaction.label.startsWith("guardian-");
    if (phase === "routes") return transaction.phase === "post-graduation-trades" && transaction.label.startsWith("route-");
    if (phase === "post-graduation-trades") return transaction.phase === phase && !transaction.label.startsWith("route-");
    return transaction.phase === phase;
  }).reduce((sum, transaction) => sum + BigInt(transaction.gasUsed), 0n);
  return [phase, { measuredGas: measured.toString(), ceilingGas: ((measured * 3n + 1n) / 2n).toString() }];
}));
const measuredGas = evidence.transactions.reduce((sum, transaction) => sum + BigInt(transaction.gasUsed), 0n);
const liveGasPrice = await client.getGasPrice();
const gasAllowance = (measuredGas * liveGasPrice * 3n + 1n) / 2n;
const canaryPrincipal = BigInt(capital.bondingSpendWei);
const requiredBalance = OPERATIONAL_RESERVE_WEI + canaryPrincipal + ROUTE_WORKING_CAPITAL_WEI + gasAllowance;
const deployer = getAddress(postdeployment.state.owners[0]);
const balance = await client.getBalance({ address: deployer });
if (balance < requiredBalance) throw new Error(`canary funding shortfall: ${requiredBalance - balance} wei`);

const manifest = {
  schemaVersion: 16,
  chainId: CHAIN_ID,
  generatedAt: new Date().toISOString(),
  releaseSha: RELEASE_SHA,
  canaryToolingSha: toolingSha,
  productionRunnerSha: toolingSha,
  deployer,
  sourceDeploymentManifest: { path: deploymentManifestPath, sha256: sha256(deploymentRaw) },
  sourcePostdeploymentVerification: { path: postdeploymentPath, sha256: sha256(postdeploymentRaw) },
  rehearsal: {
    executionMode: "local-fork-broadcast",
    forkBlock: evidence.forkBlock,
    transactionCount: validation.transactionCount,
    phaseCount: validation.phaseCount,
    gasEvidenceSha256: sha256(evidenceRaw),
    planSha256: sha256(planRaw),
    capitalLedgerSha256: sha256(capitalRaw),
    recoveryBps: capital.recoveryBps,
  },
  rpcPolicy: {
    activeApplicationProvider: "lan",
    lanRpc: "192.168.50.173:8547",
    automaticAlchemyFallback: false,
    alchemyProbeOnly: true,
    degradedLanDisablesFinancialSubmission: true,
    gatewayStatus: gatewayHealth.status,
    gatewayBlock: (await client.getBlockNumber()).toString(),
  },
  contracts,
  externalContracts: Object.fromEntries(Object.entries(productionConfig.venue).map(([name, entry]) => [name, entry.address])),
  runtimeIdentities: deployment.runtimeIdentities,
  qualifiedRoutes: localDeployment.routes,
  canaryLaunchRequest: plan.launch.request,
  activationProposal: { ...plan.activation, descriptionHash, proposalId: proposalId.toString() },
  constraints: {
    stockRouteInputWei: plan.routeInputs.stockRoundTripInputWei,
    wethRouteInputWei: plan.routeInputs.wethRoundTripInputWei,
    minimumOutputBps: 9900,
    deadlineSeconds: 120,
    canaryProfileVersion: plan.launch.profileVersion,
    targetGraduationNativeWei: plan.launch.targetGraduationNativeWei,
    maximumCurvePurchaseWei: plan.launch.maximumCurvePurchaseWei,
    minimumRecoveryBps: plan.unwind.minimumRecoveryBps,
    shutdown: plan.shutdown,
  },
  funding: {
    liveBalanceWei: balance.toString(),
    operationalReserveWei: OPERATIONAL_RESERVE_WEI.toString(),
    canaryPrincipalWei: canaryPrincipal.toString(),
    routeWorkingCapitalWei: ROUTE_WORKING_CAPITAL_WEI.toString(),
    measuredGas: measuredGas.toString(),
    sampledGasPriceWei: liveGasPrice.toString(),
    maxFeePerGasWei: liveGasPrice.toString(),
    gasAllowanceWei: gasAllowance.toString(),
    requiredBalanceWei: requiredBalance.toString(),
    projectedMarginWei: (balance - requiredBalance).toString(),
    phaseGas,
  },
  authorization: {
    canaryProposalAuthorized: false,
    canaryTransactionsAuthorized: false,
    publicModeAuthorized: false,
    applicationWritesAuthorized: false,
    furtherBridgeAuthorized: false,
  },
  acceptedResidualRisks: ["sole-owner Safe", "sole-holder RDAO", "internal assurance only"],
};
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const output = path.join(outputRoot, "schema16-mainnet-canary-manifest.json");
const manifestRaw = `${json(manifest)}\n`;
await writeFile(output, manifestRaw, { mode: 0o600, flag: "wx" });
await writeFile(path.join(outputRoot, "SHA256SUMS"), `${sha256(manifestRaw)}  schema16-mainnet-canary-manifest.json\n`, { mode: 0o600, flag: "wx" });
process.stdout.write(`${json({ passed: true, authorizationEligible: true, authorization: manifest.authorization, output, sha256: sha256(manifestRaw), funding: manifest.funding })}\n`);

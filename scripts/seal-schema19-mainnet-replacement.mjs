#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem";

const args = process.argv.slice(2);
if (args.length !== 9) throw new Error("usage: seal-schema19-mainnet-replacement.mjs <protected-input> <prepared> <deployment-ledger> <schema19-manifest> <rehearsal-report> <funding-report> <retirement-report> <schema18-manifest> <output>");
const [inputPath, preparedPath, ledgerPath, deploymentManifestPath, rehearsalPath, fundingPath, retirementPath, schema18Path, outputPath] = args.map((file) => path.resolve(file));
const load = async (file) => { const raw = await readFile(file, "utf8"); return { raw, value: JSON.parse(raw) }; };
const [input, prepared, ledger, deploymentManifest, rehearsal, funding, retirement, schema18] = await Promise.all([inputPath, preparedPath, ledgerPath, deploymentManifestPath, rehearsalPath, fundingPath, retirementPath, schema18Path].map(load));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const git = (...gitArgs) => execFileSync("git", ["-C", repo, ...gitArgs], { encoding: "utf8" }).trim();
const toolingSha = git("rev-parse", "HEAD");
if (git("status", "--porcelain") || git("rev-parse", "@{u}") !== toolingSha) throw new Error("replacement manifest requires clean pushed tooling");
const contractReleaseSha = "a67288133f09bce68b7386009d702c14dfb8bbab";
const applicationReleaseSha = "0873abd4332c6283b374c92de3ce244bc60f291c";
if (prepared.value.schemaVersion !== 19 || prepared.value.chainId !== 4663 || prepared.value.contractReleaseSha !== contractReleaseSha) throw new Error("exact Schema-19 prepared deployment required");
if (!rehearsal.value.passed || rehearsal.value.contractReleaseSha !== contractReleaseSha || rehearsal.value.applicationReleaseSha !== applicationReleaseSha || rehearsal.value.deploymentReceiptCount !== 36 || rehearsal.value.lifecycleReceiptCount !== 246) throw new Error("qualified exact Mainnet rehearsal required");
if (!funding.value.passed || BigInt(funding.value.bridgeShortfall) !== 0n || BigInt(funding.value.reserveWei) !== 20_000_000_000_000_000n) throw new Error("passing no-bridge funding evidence required");
if (!retirement.value.eligibleForArchivedReplacement || retirement.value.disposition !== "owner-accepted-test-canary-archive" || retirement.value.launchCount !== 1 || retirement.value.canaryToken.toLowerCase() !== schema18.value.canary.launchToken.toLowerCase() || retirement.value.liabilitiesExactlyBacked !== true) throw new Error("exact owner-accepted Schema-18 test canary archive required");
if (schema18.value.contractReleaseSha !== "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4") throw new Error("unexpected legacy deployment");
const rpc = process.env.ROBYN_SCHEMA19_MAINNET_RPC_URL ?? "http://127.0.0.1:18549";
const parsed = new URL(rpc);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("replacement sealing requires loopback LAN RPC");
const client = createPublicClient({ transport: http(rpc, { retryCount: 0, timeout: 30_000 }) });
if ((await client.getChainId()) !== 4663 || (await client.request({ method: "eth_syncing" })) !== false) throw new Error("replacement RPC wrong-chain or syncing");
const gateway = await fetch(new URL("/health", rpc)).then(async (response) => response.ok ? response.json() : Promise.reject(new Error(`gateway health ${response.status}`)));
if (gateway.status !== "ok" || gateway.activeProvider !== "primary" || gateway.providerSelection !== "operator" || gateway.fallbackTrafficAuthorized !== false) throw new Error("replacement sealing requires healthy LAN-only gateway");
const deployer = getAddress(prepared.value.deployment.deployer);
const [latestNonce, pendingNonce, balanceWei, block] = await Promise.all([
  client.getTransactionCount({ address: deployer, blockTag: "latest" }),
  client.getTransactionCount({ address: deployer, blockTag: "pending" }),
  client.getBalance({ address: deployer }), client.getBlock(),
]);
if (latestNonce !== prepared.value.deployment.startingNonce || pendingNonce !== latestNonce) throw new Error("live nonce differs from rehearsed predicted addresses");
if (balanceWei < BigInt(funding.value.requiredBalance)) throw new Error("live balance fell below sealed requirement");
for (const address of Object.values(prepared.value.deployment.contracts)) {
  if ((await client.getCode({ address: getAddress(address) })) !== undefined) {
    const code = await client.getCode({ address: getAddress(address) });
    if (code && code !== "0x") throw new Error(`predicted Schema-19 address already contains code: ${address}`);
  }
}
const liveReusedHashes = {};
for (const [label, address] of Object.entries({ guardianSafe: prepared.value.governance.guardianSafe, daoToken: prepared.value.governance.daoToken, timelock: prepared.value.governance.timelock, governor: prepared.value.governance.governor, ...prepared.value.external })) {
  const code = await client.getCode({ address: getAddress(address) });
  if (!code || code === "0x") throw new Error(`${label} runtime missing`);
  liveReusedHashes[label] = keccak256(code);
  if (prepared.value.reusedRuntimeCodeHashes[label]?.toLowerCase() !== liveReusedHashes[label].toLowerCase()) throw new Error(`${label} runtime changed since rehearsal`);
}
const launchAbi = parseAbi(["function launchCount() view returns (uint256)", "function launchTokenById(uint256) view returns (address)"]);
const legacyLaunchCount = await client.readContract({ address: schema18.value.contracts.launchFactory, abi: launchAbi, functionName: "launchCount" });
const legacyToken = await client.readContract({ address: schema18.value.contracts.launchFactory, abi: launchAbi, functionName: "launchTokenById", args: [1n] });
if (legacyLaunchCount !== 1n || getAddress(legacyToken) !== getAddress(schema18.value.canary.launchToken)) throw new Error("legacy Schema-18 launch set changed");
const transactionGasCeilings = Object.fromEntries(ledger.value.transactions.map((entry) => [String(BigInt(entry.transaction.nonce)), String(BigInt(entry.transaction.gas) * 2n)]));
const result = {
  schemaVersion: 19, chainId: 4663, gate: "schema19-mainnet-public-replacement", sealedAt: new Date().toISOString(),
  authorizationEligible: true,
  authorization: { schema19DeploymentAuthorized: false, schema18RetirementAuthorized: false, applicationWritesAuthorized: false, additionalBridgeAuthorized: false },
  identities: {
    contractReleaseSha, applicationReleaseSha, operationalToolingSha: toolingSha,
    qualifiedTestnetManifestSha256: "cdc880d1fc78f1937d6b190bbeca35b7d03032b9ebd56ba728d11cf98ea7e33f",
    protectedInputSha256: sha256(input.raw), preparedDeploymentSha256: sha256(prepared.raw), deploymentLedgerSha256: sha256(ledger.raw),
    deploymentManifestSha256: sha256(deploymentManifest.raw), rehearsalReportSha256: sha256(rehearsal.raw), fundingReportSha256: sha256(funding.raw), retirementReportSha256: sha256(retirement.raw), schema18ManifestSha256: sha256(schema18.raw),
  },
  execution: { expectedStartingNonce: latestNonce, expectedEndingNonceExclusive: prepared.value.deployment.fullEndingNonceExclusive, measurementBlock: block.number.toString(), liveBalanceWei: balanceWei.toString(), predictedContracts: prepared.value.deployment.contracts, transactionGasCeilings, maxFeePerGasWei: funding.value.pinnedMaxFeePerGas, l1DataFeeReservePerTransaction: funding.value.l1DataFeeReservePerTransaction },
  funding: { requiredBalanceWei: funding.value.requiredBalance, operationalReserveWei: funding.value.reserveWei, projectedMarginWei: (balanceWei - BigInt(funding.value.requiredBalance)).toString(), bridgeAmountWei: "0", bridgeAuthorized: false },
  production: { launchMode: "Public", targetGraduationNativeWei: "6000000000000000000", maximumCurvePurchaseWei: "500000000000000000", rewardDurationSeconds: 3600, failureObservationSpacingSeconds: 86400, fallbackDelaySeconds: 259200, routineKeeperRequired: false, routes: deploymentManifest.value.routes, maintenancePolicy: deploymentManifest.value.maintenancePolicy },
  governance: { reused: true, ...prepared.value.governance, runtimeCodeHashes: liveReusedHashes },
  legacySchema18: { disposition: "owner-accepted-test-canary-archive", launchCount: 1, canaryToken: getAddress(legacyToken), externalHolders: retirement.value.externalHolders, liabilitiesWei: retirement.value.totalNativeLiabilities, liabilitiesExactlyBacked: true, actions: ["pause-launches", "pause-asset-conversions", "pause-fee-conversions", "disable-six-routes", "stop-keeper", "remove-from-active-catalog", "retain-read-only-archive"] },
  application: { releaseSha: applicationReleaseSha, database: "robyn_mainnet_schema19", rebuildFrom: "first-schema19-deployment-receipt-block", scopedIndexer: true, writesInitiallyDisabled: true, enableWritesOnlyAfterVerification: true, keeperStarted: false },
  rpcPolicy: { applicationUpstream: "LAN-only", transactionUpstream: "LAN-only", gateway: "http://127.0.0.1:18549", alchemyProbeOnly: true, fallbackTrafficAuthorized: false, degradedLanBlocksSubmission: true },
  emergencyControls: ["application-write-disable", "safe-launch-pause", "safe-conversion-pause", "safe-route-disable"],
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(outputPath, serialized, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ authorizationEligible: true, toolingSha, manifestSha256: sha256(serialized), requiredBalanceWei: result.funding.requiredBalanceWei, liveBalanceWei: result.execution.liveBalanceWei, bridgeAmountWei: "0" })}\n`);

#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  decryptCampaignRoot,
  deriveCampaignAccounts,
} from "./lib/campaign-wallets.mjs";
import { parseCastDecryptedPrivateKey } from "./lib/campaign-keystore.mjs";

const releaseSha = "a8d54bb125d091be0cea010262a68a2baaceda30";
const rpcUrl = "http://127.0.0.1:18548";
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const manifestPath = join(repoRoot, "deployments", "46630-v4-schema16.json");
const runStatePath = "/var/lib/robyn/testnet-endurance/schema16-30m-812b914-07/state.json";
const runJournalPath = "/var/lib/robyn/testnet-endurance/schema16-30m-812b914-07/transactions.jsonl";
const campaignStateDir = "/home/hendo420/.local/state/robyn-testnet-campaigns/schema16-30m-812b914-07";
const campaignPassphrasePath = "/home/hendo420/.local/state/robyn-testnet-endurance-runs/schema16-30m-812b914-07/campaign-passphrase";
const outputDir = resolve(process.argv[2] ?? "/home/hendo420/robyn-evidence/testnet/schema16-focused-a8d54bb-01");
const transactionJournalPath = join(outputDir, "transactions.jsonl");
const summaryPath = join(outputDir, "summary.json");

const json = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const artifactAbi = (name) => readJson(join(repoRoot, "packages", "contracts", "out", `${name}.sol`, `${name}.json`)).abi;
const appendJournal = (entry) => appendFileSync(transactionJournalPath, `${json({ recordedAt: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
const ceilDiv = (value, divisor) => (value + divisor - 1n) / divisor;

mkdirSync(outputDir, { recursive: false, mode: 0o700 });
writeFileSync(transactionJournalPath, "", { mode: 0o600 });

const manifest = readJson(manifestPath);
if (manifest.schemaVersion !== 16 || manifest.chainId !== 46630) throw new Error("Focused acceptance requires Schema-16 chain 46630");
const client = createPublicClient({ transport: http(rpcUrl) });
if (await client.getChainId() !== 46630) throw new Error("RPC chain mismatch");

const publicStatus = await fetch("https://testnet.sherwoodforest.trade/api/status").then((response) => {
  if (!response.ok) throw new Error(`Public status returned ${response.status}`);
  return response.json();
});
if (publicStatus.chainId !== 46630 || publicStatus.ingestionStatus !== "ok" || publicStatus.projectionStatus !== "ok") {
  throw new Error("Public Testnet status is unhealthy");
}
if (publicStatus.protocol?.routerSolvent !== true || publicStatus.protocol?.phaseMismatchCount !== 0 || publicStatus.protocol?.lockerMismatchCount !== 0 || publicStatus.protocol?.rewardStreamMismatchCount !== 0) {
  throw new Error("Protocol accounting health is not exact");
}
if (publicStatus.rpcGateway?.status !== "ok") throw new Error("RPC gateway is unhealthy");

const servedHealth = await fetch("https://testnet.sherwoodforest.trade/admin/health/status").then((response) => {
  if (!response.ok) throw new Error(`Admin health returned ${response.status}`);
  return response.json();
});
if (servedHealth.releaseSha !== releaseSha || servedHealth.overall !== "ok") throw new Error("Served release identity is not exact");

const runState = readJson(runStatePath);
if (runState.coverage?.coveredRewardAssetCount !== 11 || runState.coverage?.launchCount !== 8 || runState.coverage?.graduatedLaunchCount !== 3) {
  throw new Error("Preserved Testnet campaign lacks required route or lifecycle coverage");
}
if (runState.advancedCoverage?.universalComplete !== true || runState.advancedCoverage?.externalLiquidity?.length < 2) {
  throw new Error("Preserved Testnet campaign lacks v4 advanced coverage");
}
const priorTransactions = readFileSync(runJournalPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const priorHashes = priorTransactions.map((entry) => entry.hash).filter(Boolean);
if (priorHashes.length !== 284 || new Set(priorHashes).size !== priorHashes.length) {
  throw new Error(`Expected 284 unique confirmed prior hashes, found ${priorHashes.length}`);
}
for (let offset = 0; offset < priorHashes.length; offset += 16) {
  const receipts = await Promise.all(priorHashes.slice(offset, offset + 16).map((hash) => client.getTransactionReceipt({ hash })));
  if (receipts.some((receipt) => receipt.status !== "success")) throw new Error("A preserved Testnet receipt is not successful");
}

const assetRouterAbi = artifactAbi("RobynV4AssetRouter");
const routeResults = [];
for (const route of manifest.assetRoutes) {
  const status = await client.readContract({ address: manifest.contracts.assetRouter, abi: assetRouterAbi, functionName: "executionRouteStatus", args: [route.address] });
  if ((status.ready ?? status[6]) !== true) throw new Error(`${route.symbol} route is not ready`);
  const nativeInput = 1_000_000_000n;
  const [assetOutput] = await client.readContract({ address: manifest.contracts.assetRouter, abi: assetRouterAbi, functionName: "quoteNativeToAsset", args: [route.address, nativeInput] });
  if (assetOutput <= 0n) throw new Error(`${route.symbol} native-to-asset quote is zero`);
  const [nativeOutput] = await client.readContract({ address: manifest.contracts.assetRouter, abi: assetRouterAbi, functionName: "quoteAssetToNative", args: [route.address, assetOutput] });
  if (nativeOutput <= 0n) throw new Error(`${route.symbol} asset-to-native quote is zero`);
  routeResults.push({ symbol: route.symbol, address: route.address, ready: true, nativeInput, assetOutput, nativeOutput });
}

const campaignState = readJson(join(campaignStateDir, "state.json"));
const encryptedRoot = readJson(join(campaignStateDir, "encrypted-root.json"));
const campaignRoot = decryptCampaignRoot(encryptedRoot, readFileSync(campaignPassphrasePath, "utf8").trim());
const accounts = deriveCampaignAccounts(campaignRoot, campaignState.campaignId, 100).map(({ privateKey }) => privateKeyToAccount(privateKey));
const holder = accounts[0];
const creator = accounts[41];
if (holder.address.toLowerCase() !== "0xc7221b516758c17471bca0bb684c8ef9d0ac06b5" || creator.address.toLowerCase() !== "0xbf36a44de786fa22dc74c730707039e2b2daacc1") {
  throw new Error("Preserved campaign identity mismatch");
}

const keystore = resolve(process.env.ROBYN_TESTNET_KEYSTORE ?? "");
const passwordPath = resolve(process.env.ROBYN_TESTNET_PASSWORD_FILE ?? "");
const password = readFileSync(passwordPath, "utf8").trim();
const decrypted = execFileSync(join(process.env.HOME, ".foundry", "bin", "cast"), ["wallet", "decrypt-keystore", basename(keystore), "--keystore-dir", dirname(keystore)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CAST_UNSAFE_PASSWORD: password } });
const project = privateKeyToAccount(parseCastDecryptedPrivateKey(decrypted));
if (project.address.toLowerCase() !== manifest.deployer.toLowerCase()) throw new Error("Project keystore mismatch");

const wallets = new Map([
  [project.address.toLowerCase(), createWalletClient({ account: project, transport: http(rpcUrl) })],
  [holder.address.toLowerCase(), createWalletClient({ account: holder, transport: http(rpcUrl) })],
  [creator.address.toLowerCase(), createWalletClient({ account: creator, transport: http(rpcUrl) })],
]);
const reserveWei = 1_500_000_000_000_000n;
const l1ReserveWei = 25_000_000_000_000n;

async function feeEnvelope() {
  const fees = await client.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas && fees.maxPriorityFeePerGas <= maxFeePerGas ? fees.maxPriorityFeePerGas : maxFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

async function sendTransfer(label, to, value) {
  const envelope = await feeEnvelope();
  const gas = 42_000n;
  const balance = await client.getBalance({ address: project.address });
  const maximumCost = value + gas * envelope.maxFeePerGas;
  if (balance - maximumCost < reserveWei) throw new Error("Project reserve would be breached by acceptance funding");
  const nonce = await client.getTransactionCount({ address: project.address, blockTag: "pending" });
  const idempotencyKey = keccak256(stringToHex(`schema16-focused:${label}`));
  appendJournal({ state: "prepared", label, idempotencyKey, from: project.address, to, nonce, value, expectedEffect: "acceptance actor gas funding" });
  const hash = await wallets.get(project.address.toLowerCase()).sendTransaction({ to, value, gas, nonce, ...envelope });
  appendJournal({ state: "submitted", label, idempotencyKey, hash });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} funding failed`);
  appendJournal({ state: "confirmed", label, idempotencyKey, hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed });
  return hash;
}

async function ensureActorFunding(account, targetWei, label) {
  const balance = await client.getBalance({ address: account.address });
  if (balance >= targetWei) return undefined;
  return sendTransfer(`fund-${label}`, account.address, targetWei - balance);
}

async function sendContract(label, account, address, abi, functionName, args = []) {
  const data = encodeFunctionData({ abi, functionName, args });
  const estimate = await client.estimateGas({ account: account.address, to: address, data });
  const gas = estimate * 2n;
  const envelope = await feeEnvelope();
  const target = ceilDiv(gas * envelope.maxFeePerGas * 12_500n, 10_000n) + l1ReserveWei;
  await ensureActorFunding(account, target, label);
  const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
  const idempotencyKey = keccak256(stringToHex(`schema16-focused:${label}`));
  appendJournal({ state: "prepared", label, idempotencyKey, from: account.address, to: address, nonce, calldataHash: keccak256(data), expectedEffect: functionName });
  const hash = await wallets.get(account.address.toLowerCase()).writeContract({ address, abi, functionName, args, gas, nonce, ...envelope });
  appendJournal({ state: "submitted", label, idempotencyKey, hash });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} failed`);
  appendJournal({ state: "confirmed", label, idempotencyKey, hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed });
  return hash;
}

const tokenAbi = artifactAbi("RobynLaunchToken");
const daoAbi = artifactAbi("RobynDaoToken");
const feeRouterAbi = artifactAbi("RobynNativeProtocolFeeRouterV4");
const holderToken = getAddress(runState.enduranceLaunches[0].token);
const creatorToken = getAddress(runState.enduranceLaunches[1].token);
const holderBefore = [];
const holderAssetBalancesBefore = [];
for (let index = 0n; index < 3n; index += 1n) {
  const asset = await client.readContract({ address: holderToken, abi: tokenAbi, functionName: "rewardAsset", args: [index] });
  holderBefore.push(await client.readContract({ address: holderToken, abi: tokenAbi, functionName: "withdrawableRewardOf", args: [holder.address, index] }));
  holderAssetBalancesBefore.push(await client.readContract({ address: asset, abi: tokenAbi, functionName: "balanceOf", args: [holder.address] }));
}
if (holderBefore.reduce((sum, value) => sum + value, 0n) <= 0n) throw new Error("No completed holder claim is available");
const holderClaimHash = await sendContract("completed-holder-claim", holder, holderToken, tokenAbi, "claimAll");
const holderAfter = [];
const holderAssetBalancesAfter = [];
for (let index = 0n; index < 3n; index += 1n) {
  const asset = await client.readContract({ address: holderToken, abi: tokenAbi, functionName: "rewardAsset", args: [index] });
  holderAfter.push(await client.readContract({ address: holderToken, abi: tokenAbi, functionName: "withdrawableRewardOf", args: [holder.address, index] }));
  holderAssetBalancesAfter.push(await client.readContract({ address: asset, abi: tokenAbi, functionName: "balanceOf", args: [holder.address] }));
}
if (!holderAssetBalancesAfter.some((value, index) => value > holderAssetBalancesBefore[index])) throw new Error("Holder claim transferred no basket asset");

const creatorBefore = await client.readContract({ address: manifest.contracts.protocolFeeRouter, abi: feeRouterAbi, functionName: "claimableCreatorNativeByRecipient", args: [creatorToken, creator.address] });
if (creatorBefore <= 0n) throw new Error("No completed creator claim is available");
const creatorClaimHash = await sendContract("completed-creator-claim", creator, manifest.contracts.protocolFeeRouter, feeRouterAbi, "claimCreatorFees", [creatorToken]);
const creatorAfter = await client.readContract({ address: manifest.contracts.protocolFeeRouter, abi: feeRouterAbi, functionName: "claimableCreatorNativeByRecipient", args: [creatorToken, creator.address] });
if (creatorAfter >= creatorBefore) throw new Error("Creator claimable did not decrease");

const daoBefore = await client.readContract({ address: manifest.contracts.daoToken, abi: daoAbi, functionName: "claimableRewardOf", args: [holder.address] });
if (daoBefore <= 0n) throw new Error("No completed DAO claim is available");
const daoClaimHash = await sendContract("completed-dao-claim", holder, manifest.contracts.daoToken, daoAbi, "claimRewards");
const daoAfter = await client.readContract({ address: manifest.contracts.daoToken, abi: daoAbi, functionName: "claimableRewardOf", args: [holder.address] });
if (daoAfter >= daoBefore) throw new Error("DAO claimable did not decrease");

const finalStatus = await fetch("https://testnet.sherwoodforest.trade/api/status").then((response) => response.json());
if (finalStatus.protocol?.routerSolvent !== true || finalStatus.keeperQueueCounts?.failed !== 0) throw new Error("Final protocol or queue state is unhealthy");
const projectBalance = await client.getBalance({ address: project.address });
if (projectBalance < reserveWei) throw new Error("Focused acceptance breached the project reserve");

const summary = {
  schemaVersion: 1,
  testedAt: new Date().toISOString(),
  status: "passed",
  releaseSha,
  chainId: 46630,
  priorEvidence: { runId: runState.runId, successfulUniqueReceipts: priorHashes.length, launches: 8, graduations: 3, coveredRoutes: 11, partialStreamClaimsMinutes: runState.streamProbe?.claims },
  liveRoutes: routeResults,
  freshClaims: {
    holder: { hash: holderClaimHash, claimableBefore: holderBefore, claimableAfter: holderAfter },
    creator: { hash: creatorClaimHash, claimableBefore: creatorBefore, claimableAfter: creatorAfter },
    dao: { hash: daoClaimHash, claimableBefore: daoBefore, claimableAfter: daoAfter },
  },
  health: {
    overall: servedHealth.overall,
    ingestion: finalStatus.ingestionStatus,
    projection: finalStatus.projectionStatus,
    rpcGateway: finalStatus.rpcGateway?.status,
    routerSolvent: finalStatus.protocol?.routerSolvent,
    phaseMismatchCount: finalStatus.protocol?.phaseMismatchCount,
    lockerMismatchCount: finalStatus.protocol?.lockerMismatchCount,
    rewardStreamMismatchCount: finalStatus.protocol?.rewardStreamMismatchCount,
  },
  projectBalanceWei: projectBalance,
  reserveWei,
};
writeFileSync(summaryPath, `${json(summary)}\n`, { mode: 0o600 });
chmodSync(summaryPath, 0o600);
process.stdout.write(`${json(summary)}\n`);

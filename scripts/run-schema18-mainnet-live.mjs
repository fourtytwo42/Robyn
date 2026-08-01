#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { parseCastDecryptedPrivateKey } from "./lib/campaign-keystore.mjs";
import { validateMainnetReceiptLedger } from "./lib/mainnet-receipt-ledger.mjs";

const CONTRACT_SHA = "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
const APPLICATION_SHA = "8327b250122cd9050a7da6a44e12859e3cf521aa";
const stage = process.argv[2];
if (!new Set(["verify", "bridge", "deploy"]).has(stage)) {
  throw new Error("usage: run-schema18-mainnet-live.mjs verify|bridge|deploy");
}
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.resolve(required("ROBYN_MAINNET_AUTHORIZED_MANIFEST"));
const expectedManifestHash = required("ROBYN_MAINNET_AUTHORIZED_MANIFEST_SHA256").toLowerCase();
const evidenceRoot = path.resolve(required("ROBYN_MAINNET_LIVE_EVIDENCE_DIRECTORY"));
const keystorePath = path.resolve(required("ROBYN_MAINNET_KEYSTORE"));
const passwordPath = path.resolve(required("ROBYN_MAINNET_PASSWORD_FILE"));
const l1Rpc = required("ROBYN_ETHEREUM_MAINNET_RPC_URL");
const l2Rpc = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(l2Rpc)) {
  throw new Error("Mainnet transactions require the loopback LAN gateway");
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifestRaw = await readFile(manifestPath, "utf8");
if (sha256(manifestRaw) !== expectedManifestHash) throw new Error("authorized manifest checksum mismatch");
const manifest = JSON.parse(manifestRaw);
if (
  manifest.schemaVersion !== 18 ||
  manifest.contractReleaseSha !== CONTRACT_SHA ||
  manifest.applicationReleaseSha !== APPLICATION_SHA ||
  manifest.chainId !== 4663 ||
  manifest.rpcPolicy?.automaticFallbackAuthorized !== false
) throw new Error("authorized Schema-18 manifest identity mismatch");
if (stage === "bridge" && manifest.bridgeAuthorized !== true) throw new Error("bridge is not authorized");
if (stage === "deploy" && manifest.pausedDeploymentAuthorized !== true) throw new Error("Paused deployment is not authorized");
if (manifest.bootstrapStepOneAuthorized || manifest.bootstrapStepTwoAuthorized || manifest.publicActivationAuthorized) {
  throw new Error("bridge/Paused-deployment runner refuses canary or Public authorization");
}
const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
if (
  git("status", "--porcelain") !== "" ||
  git("rev-parse", "HEAD") !== git("rev-parse", "@{upstream}") ||
  git("rev-parse", "HEAD") !== manifest.operationalToolingSha
) throw new Error("live execution requires exact clean pushed tooling");
const gasPath = path.resolve(path.dirname(manifestPath), manifest.evidence.gasEvidence.sealedFile);
const gasRaw = await readFile(gasPath, "utf8");
if (sha256(gasRaw) !== manifest.evidence.gasEvidence.sha256) throw new Error("sealed receipt ledger checksum mismatch");
const gasEvidence = JSON.parse(gasRaw);
validateMainnetReceiptLedger(gasEvidence, { releaseSha: CONTRACT_SHA });

const password = (await readFile(passwordPath, "utf8")).trimEnd();
const cast = path.join(process.env.HOME ?? "/home/hendo420", ".foundry", "bin", "cast");
const decrypted = execFileSync(
  cast,
  ["wallet", "decrypt-keystore", path.basename(keystorePath), "--keystore-dir", path.dirname(keystorePath)],
  { encoding: "utf8", env: { ...process.env, CAST_UNSAFE_PASSWORD: password }, stdio: ["ignore", "pipe", "pipe"] },
).trim();
const account = privateKeyToAccount(parseCastDecryptedPrivateKey(decrypted));
if (getAddress(account.address) !== getAddress(manifest.existingSafe.owner)) throw new Error("keystore does not match manifest deployer");
const l2Chain = { id: 4663, name: "Robinhood Mainnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [l2Rpc] } } };
const l1 = createPublicClient({ chain: mainnet, transport: http(l1Rpc, { retryCount: 0, timeout: 30_000 }) });
const l1Wallet = createWalletClient({ account, chain: mainnet, transport: http(l1Rpc, { retryCount: 0, timeout: 30_000 }) });
const l2 = createPublicClient({ chain: l2Chain, transport: http(l2Rpc, { retryCount: 0, timeout: 30_000 }) });
const l2Wallet = createWalletClient({ account, chain: l2Chain, transport: http(l2Rpc, { retryCount: 0, timeout: 30_000 }) });
if ((await l1.getChainId()) !== 1 || (await l2.getChainId()) !== 4663 || (await l2.request({ method: "eth_syncing", params: [] })) !== false) {
  throw new Error("live RPC identity or synchronization check failed");
}
const health = await fetch(new URL("/health", l2Rpc)).then(async (response) => {
  if (!response.ok) throw new Error(`gateway health ${response.status}`);
  return response.json();
});
if (health.status !== "ok" || health.activeProvider !== "primary" || health.providerSelection !== "operator" || health.fallbackTrafficAuthorized !== false) {
  throw new Error("LAN-only Mainnet gateway is not healthy");
}
await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const journalPath = path.join(evidenceRoot, "transactions.jsonl");
const statePath = path.join(evidenceRoot, "state.json");
const loadRecords = async () => {
  try {
    const raw = (await readFile(journalPath, "utf8")).trim();
    return raw ? raw.split("\n").map(JSON.parse) : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
};
const append = async (record) => {
  const handle = await open(journalPath, "a", 0o600);
  try { await handle.write(`${JSON.stringify(record)}\n`); await handle.sync(); } finally { await handle.close(); }
};
const submit = async ({ client, wallet, chain, chainId, phase, key, to, data, value, gasCeiling }) => {
  const records = await loadRecords();
  const existingReceipt = records.find((item) => item.type === "receipt" && item.idempotencyKey === key);
  if (existingReceipt) {
    const receipt = await client.getTransactionReceipt({ hash: existingReceipt.transactionHash });
    if (receipt.status !== "success") throw new Error(`${key} confirmed receipt changed`);
    return receipt;
  }
  const unresolved = records.find((item) => item.type === "intent" && item.idempotencyKey === key && !records.some((other) => other.type === "receipt" && other.idempotencyKey === key));
  if (unresolved) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: unresolved.transactionHash });
      if (receipt.status !== "success") throw new Error(`${key} reverted`);
      await append({ type: "receipt", idempotencyKey: key, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString() });
      return receipt;
    } catch {
      throw new Error(`${key} is ambiguous; automatic replacement is prohibited`);
    }
  }
  const [latest, pending, fees] = await Promise.all([
    client.getTransactionCount({ address: account.address, blockTag: "latest" }),
    client.getTransactionCount({ address: account.address, blockTag: "pending" }),
    client.estimateFeesPerGas(),
  ]);
  if (latest !== pending) throw new Error(`${key} has a pending nonce`);
  const estimate = await client.estimateGas({ account: account.address, to, data, value });
  if (estimate > gasCeiling) throw new Error(`${key} exceeds sealed gas ceiling`);
  const maxFeePerGas = (fees.maxFeePerGas ?? fees.gasPrice) * 125n / 100n;
  const request = { account, chain, to, data, value, nonce: latest, gas: gasCeiling, maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n, type: "eip1559" };
  const serialized = await wallet.signTransaction(request);
  const transactionHash = keccak256(serialized);
  await append({ type: "intent", recordedAt: new Date().toISOString(), idempotencyKey: key, phase, chainId, nonce: latest.toString(), to: to ?? null, valueWei: value.toString(), calldataHash: keccak256(data), gasCeiling: gasCeiling.toString(), transactionHash });
  const published = await client.sendRawTransaction({ serializedTransaction: serialized });
  if (published !== transactionHash) throw new Error(`${key} returned a different hash`);
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, timeout: 300_000 });
  if (receipt.status !== "success") throw new Error(`${key} reverted`);
  await append({ type: "receipt", idempotencyKey: key, transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString() });
  return receipt;
};

if (stage === "verify") {
  const report = {
    schemaVersion: 18,
    stage,
    verifiedAt: new Date().toISOString(),
    manifestSha256: expectedManifestHash,
    l1BalanceWei: (await l1.getBalance({ address: account.address })).toString(),
    l2BalanceWei: (await l2.getBalance({ address: account.address })).toString(),
    l2Nonce: await l2.getTransactionCount({ address: account.address }),
    gateway: { status: health.status, activeProvider: health.activeProvider, fallbackTrafficAuthorized: health.fallbackTrafficAuthorized },
    transactionsSubmitted: 0,
  };
  await writeFile(path.join(evidenceRoot, "preflight.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}
if (stage === "bridge") {
  const amount = BigInt(manifest.funding.bridgeAmountWei);
  if (amount === 0n) throw new Error("manifest does not require a bridge");
  const inbox = getAddress("0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D");
  const data = encodeFunctionData({ abi: [{ type: "function", name: "depositEth", stateMutability: "payable", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "depositEth" });
  const l1Before = await l1.getBalance({ address: account.address });
  const ceiling = BigInt(manifest.evidence.bridgeEstimate ? JSON.parse(await readFile(path.resolve(path.dirname(manifestPath), manifest.evidence.bridgeEstimate.sealedFile), "utf8")).gasEstimate : 0);
  const receipt = await submit({ client: l1, wallet: l1Wallet, chain: mainnet, chainId: 1, phase: "bridge", key: "schema18-live:bridge:canonical-deposit", to: inbox, data, value: amount, gasCeiling: ceiling * 2n });
  const l1After = await l1.getBalance({ address: account.address });
  if (l1After < BigInt(manifest.funding.l1EmergencyReserveWei)) throw new Error("bridge breached L1 reserve");
  await writeFile(path.join(evidenceRoot, "bridge-result.json"), `${JSON.stringify({ status: "passed", transactionHash: receipt.transactionHash, amountWei: amount.toString(), l1BeforeWei: l1Before.toString(), l1AfterWei: l1After.toString() }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  process.exit(0);
}

const deploymentTransactions = gasEvidence.transactions.filter((transaction) => ["deployment", "bindings"].includes(transaction.phase));
for (const transaction of deploymentTransactions) {
  const transactionCeiling =
    (BigInt(transaction.gasUsed) * 15_000n + 9_999n) / 10_000n;
  await submit({
    client: l2,
    wallet: l2Wallet,
    chain: l2Chain,
    chainId: 4663,
    phase: transaction.phase,
    key: `schema18-live:${transaction.idempotencyKey}`,
    to: transaction.to ? getAddress(transaction.to) : undefined,
    data: transaction.data,
    value: BigInt(transaction.valueWei),
    gasCeiling: transactionCeiling,
  });
}
for (const [name, address] of Object.entries(manifest.predictedContracts)) {
  const code = await l2.getCode({ address: getAddress(address) });
  if (!code || code === "0x") throw new Error(`deployed runtime missing for ${name}`);
}
const coordinatorAbi = parseAbi(["function launchMode() view returns (uint8)"]);
const assetAbi = parseAbi(["function conversionsPaused() view returns (bool)"]);
const feeAbi = parseAbi(["function paused() view returns (bool)"]);
const [launchMode, assetPaused, feePaused, l2Balance] = await Promise.all([
  l2.readContract({ address: getAddress(manifest.predictedContracts.coordinator), abi: coordinatorAbi, functionName: "launchMode" }),
  l2.readContract({ address: getAddress(manifest.predictedContracts.assetRouter), abi: assetAbi, functionName: "conversionsPaused" }),
  l2.readContract({ address: getAddress(manifest.predictedContracts.feeRouter), abi: feeAbi, functionName: "paused" }),
  l2.getBalance({ address: account.address }),
]);
if (Number(launchMode) !== 0 || !assetPaused || !feePaused) throw new Error("Schema-18 deployment is not fully Paused");
if (l2Balance < 30_000_000_000_000_000n) throw new Error("Paused deployment breached operational plus canary reserve");
const result = { schemaVersion: 18, status: "passed", stage: "deploy", deployedAt: new Date().toISOString(), manifestSha256: expectedManifestHash, contracts: manifest.predictedContracts, l2BalanceWei: l2Balance.toString(), launchMode: "Paused", conversionsPaused: true, applicationWritesEnabled: false };
const temporary = `${statePath}.tmp`;
await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
await rename(temporary, statePath);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

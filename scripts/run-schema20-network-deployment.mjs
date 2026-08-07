#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseCastDecryptedPrivateKey } from "./lib/campaign-keystore.mjs";
import { classifyCanaryJournal } from "./lib/mainnet-canary-journal.mjs";

const [stage, preparedArgument, fundingArgument, evidenceArgument] = process.argv.slice(2);
if (!new Set(["verify", "deploy", "status"]).has(stage) || !preparedArgument || !fundingArgument || !evidenceArgument) {
  throw new Error("usage: run-schema20-network-deployment.mjs verify|deploy|status <prepared.json> <funding.json|-> <evidence-dir>");
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = (name, args, options = {}) =>
  execFileSync(name, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const git = (...args) => command("git", ["-C", repoRoot, ...args]);
const toolingSha = git("rev-parse", "HEAD");
if (git("status", "--porcelain") !== "" || git("rev-parse", "@{upstream}") !== toolingSha) {
  throw new Error("Schema-20 deployment requires exact clean pushed tooling");
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const preparedRaw = await readFile(path.resolve(preparedArgument), "utf8");
const prepared = JSON.parse(preparedRaw);
if (prepared.schemaVersion !== 20 || ![46630, 4663].includes(prepared.chainId) || prepared.toolingSha !== toolingSha) {
  throw new Error("Schema-20 prepared deployment identity mismatch");
}
const rehearsal = process.env.ROBYN_SCHEMA20_REHEARSAL === "true";
let funding = null;
let fundingRaw = "";
if (fundingArgument !== "-") {
  fundingRaw = await readFile(path.resolve(fundingArgument), "utf8");
  funding = JSON.parse(fundingRaw);
}
if (!rehearsal && (
  funding?.schemaVersion !== 20 ||
  funding.chainId !== prepared.chainId ||
  funding.passed !== true ||
  funding.preparedManifestSha256 !== sha256(preparedRaw) ||
  funding.transactionPlanSha256 !== prepared.transactionPlanSha256
)) {
  throw new Error("passing exact Schema-20 funding report required");
}
const defaultRpc = prepared.chainId === 4663 ? "http://127.0.0.1:18549" : "http://127.0.0.1:18548";
const rpcUrl = process.env.ROBYN_SCHEMA20_RPC_URL ?? defaultRpc;
const parsedRpc = new URL(rpcUrl);
if (!rehearsal && !["127.0.0.1", "localhost"].includes(parsedRpc.hostname)) {
  throw new Error("Schema-20 transactions require the loopback LAN gateway");
}
const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0, timeout: 30_000 }) });
const verifyRpc = async () => {
  if (
    (await client.getChainId()) !== prepared.chainId ||
    (await client.request({ method: "eth_syncing", params: [] })) !== false
  ) throw new Error("Schema-20 RPC is wrong-chain or syncing");
  if (rehearsal) return { status: "ok", activeProvider: "rehearsal", providerSelection: "operator", fallbackTrafficAuthorized: false };
  const gateway = await fetch(new URL("/health", rpcUrl)).then(async (response) => {
    if (!response.ok) throw new Error(`gateway health ${response.status}`);
    return response.json();
  });
  if (
    gateway.status !== "ok" || gateway.activeProvider !== "primary" ||
    gateway.providerSelection !== "operator" || gateway.fallbackTrafficAuthorized !== false
  ) throw new Error("Schema-20 gateway is not healthy LAN-only");
  return gateway;
};
const verifyReusedRuntime = async () => {
  const addresses = {
    guardianSafe: prepared.governance.guardianSafe,
    daoToken: prepared.governance.daoToken,
    timelock: prepared.governance.timelock,
    governor: prepared.governance.governor,
    ...prepared.external,
  };
  for (const [role, expected] of Object.entries(prepared.reusedRuntimeCodeHashes ?? {})) {
    const address = addresses[role];
    if (!address) throw new Error(`missing reused address ${role}`);
    const code = await client.getCode({ address });
    if (!code || code === "0x" || keccak256(code).toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`reused runtime mismatch ${role}`);
    }
  }
};
const gateway = await verifyRpc();
await verifyReusedRuntime();

const evidenceRoot = path.resolve(evidenceArgument);
await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const journalPath = path.join(evidenceRoot, "deployment-transactions.jsonl");
const deploymentIdentity = {
  schemaVersion: 20,
  chainId: prepared.chainId,
  toolingSha,
  contractReleaseSha: prepared.contractReleaseSha,
  preparedManifestSha256: sha256(preparedRaw),
  transactionPlanSha256: prepared.transactionPlanSha256,
  fundingReportSha256: fundingRaw ? sha256(fundingRaw) : null,
  rehearsal,
};
const identityPath = path.join(evidenceRoot, "deployment-identity.json");
try {
  const current = JSON.parse(await readFile(identityPath, "utf8"));
  if (JSON.stringify(current) !== JSON.stringify(deploymentIdentity)) {
    throw new Error("deployment evidence belongs to another Schema-20 plan");
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  await writeFile(identityPath, `${JSON.stringify(deploymentIdentity, null, 2)}\n`, { mode: 0o600, flag: "wx" });
}
const loadJournal = async () => {
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
  try {
    await handle.write(`${JSON.stringify(record)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
};
const receiptDigest = (receipt) => sha256(JSON.stringify({
  transactionHash: receipt.transactionHash,
  blockNumber: receipt.blockNumber.toString(),
  status: receipt.status,
  gasUsed: receipt.gasUsed.toString(),
  effectiveGasPrice: receipt.effectiveGasPrice.toString(),
  contractAddress: receipt.contractAddress,
  logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })),
}));
const missing = (error) => /not found|could not be found/i.test(String(error?.shortMessage ?? error?.message ?? error));
const deployer = getAddress(prepared.deployment.deployer);
const records = await loadJournal();
const confirmed = records.filter((record) => record.type === "receipt").length;
const [latestNonce, pendingNonce, balance] = await Promise.all([
  client.getTransactionCount({ address: deployer, blockTag: "latest" }),
  client.getTransactionCount({ address: deployer, blockTag: "pending" }),
  client.getBalance({ address: deployer }),
]);
const statusResult = {
  ...deploymentIdentity,
  expectedTransactions: prepared.transactions.length,
  confirmedTransactions: confirmed,
  latestNonce,
  pendingNonce,
  balanceWei: balance.toString(),
  gateway: { status: gateway.status, activeProvider: gateway.activeProvider, fallbackTrafficAuthorized: gateway.fallbackTrafficAuthorized },
};
if (stage === "status") {
  process.stdout.write(`${JSON.stringify(statusResult)}\n`);
  process.exit(0);
}
const expectedNonce = prepared.deployment.startingNonce + confirmed;
if (latestNonce !== expectedNonce || pendingNonce !== expectedNonce) {
  throw new Error("Schema-20 deployer nonce does not match confirmed journal");
}
for (let index = 0; index < prepared.transactions.length; index += 1) {
  const transaction = prepared.transactions[index];
  if (transaction.nonce !== prepared.deployment.startingNonce + index) throw new Error("non-contiguous transaction plan");
  if (transaction.expectedContractAddress) {
    const code = await client.getCode({ address: transaction.expectedContractAddress });
    if (index < confirmed && (!code || code === "0x")) throw new Error(`confirmed runtime missing ${transaction.label}`);
    if (index >= confirmed && code && code !== "0x") throw new Error(`future Schema-20 address already contains code ${transaction.label}`);
  }
}
if (stage === "verify") {
  if (!rehearsal) {
    const remainingExecutionCeiling = funding.transactionGasCeilings
      .slice(confirmed)
      .reduce(
        (sum, transaction) =>
          sum + BigInt(transaction.gasCeiling) * BigInt(funding.maxFeePerGasWei)
            + BigInt(funding.l1FeePerTransactionWei),
        0n,
      );
    const requiredRemainingBalance = BigInt(funding.reserveWei) + remainingExecutionCeiling;
    if (balance < requiredRemainingBalance) {
      throw new Error("Schema-20 funding fell below the sealed remaining-work requirement");
    }
  }
  process.stdout.write(`${JSON.stringify({ ...statusResult, passed: true })}\n`);
  process.exit(0);
}

const defaultKeystore = prepared.chainId === 4663
  ? "/home/hendo420/.config/robyn/wallets/robinhood-mainnet-deployer/keystore/robyn-mainnet-deployer"
  : "/home/hendo420/.config/robyn/wallets/robinhood-testnet-deployer/keystore/robyn-testnet-deployer";
const defaultPassword = prepared.chainId === 4663
  ? "/home/hendo420/.config/robyn/wallets/robinhood-mainnet-deployer/password"
  : "/home/hendo420/.config/robyn/wallets/robinhood-testnet-deployer/password";
const keystore = path.resolve(process.env.ROBYN_SCHEMA20_KEYSTORE ?? defaultKeystore);
const passwordFile = path.resolve(process.env.ROBYN_SCHEMA20_PASSWORD_FILE ?? defaultPassword);
const password = (await readFile(passwordFile, "utf8")).trimEnd();
const cast = path.join(process.env.HOME ?? "/home/hendo420", ".foundry", "bin", "cast");
const decrypted = command(cast, ["wallet", "decrypt-keystore", path.basename(keystore), "--keystore-dir", path.dirname(keystore)], {
  env: { ...process.env, CAST_UNSAFE_PASSWORD: password },
});
const account = privateKeyToAccount(parseCastDecryptedPrivateKey(decrypted));
if (getAddress(account.address) !== deployer) throw new Error("Schema-20 keystore address mismatch");
const chain = defineChain({
  id: prepared.chainId,
  name: prepared.environment,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl, { retryCount: 0, timeout: 30_000 }) });
const reserve = rehearsal ? 0n : BigInt(funding.reserveWei);
const l1FeePerTransaction = rehearsal ? 0n : BigInt(funding.l1FeePerTransactionWei);
if (!rehearsal && (
  !Array.isArray(funding.transactionGasCeilings) ||
  funding.transactionGasCeilings.length !== prepared.transactions.length
)) throw new Error("complete funding gas ceilings required");

for (let index = 0; index < prepared.transactions.length; index += 1) {
  const template = prepared.transactions[index];
  const nonce = template.nonce;
  const logicalKey = `schema20-${prepared.chainId}-deployment:${deploymentIdentity.preparedManifestSha256}:${nonce}`;
  const classified = classifyCanaryJournal(await loadJournal(), logicalKey);
  if (classified.receipt) {
    const receipt = await client.getTransactionReceipt({ hash: classified.receipt.transactionHash });
    if (receipt.status !== "success" || receiptDigest(receipt) !== classified.receipt.receiptDigest) throw new Error(`${logicalKey} confirmed receipt changed`);
    continue;
  }
  if (classified.activeIntent) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: classified.activeIntent.transactionHash });
      if (receipt.status !== "success") throw new Error(`${logicalKey} reverted`);
      await append({
        type: "receipt", recordedAt: new Date().toISOString(), logicalKey,
        idempotencyKey: classified.activeIntent.idempotencyKey,
        transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(),
        status: receipt.status, gasUsed: receipt.gasUsed.toString(),
        effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), contractAddress: receipt.contractAddress,
        receiptDigest: receiptDigest(receipt), label: template.label,
      });
      continue;
    } catch (error) {
      if (!missing(error)) throw error;
      throw new Error(`${logicalKey} has an unresolved signed intent; replay is prohibited`);
    }
  }
  await verifyRpc();
  await verifyReusedRuntime();
  const [latest, pending, fees, currentBalance] = await Promise.all([
    client.getTransactionCount({ address: deployer, blockTag: "latest" }),
    client.getTransactionCount({ address: deployer, blockTag: "pending" }),
    client.estimateFeesPerGas(),
    client.getBalance({ address: deployer }),
  ]);
  if (latest !== nonce || pending !== nonce) throw new Error(`${logicalKey} nonce is ambiguous`);
  const to = template.to ? getAddress(template.to) : undefined;
  const data = template.data;
  const value = BigInt(template.value);
  const estimate = await client.estimateGas({ account: deployer, to, data, value });
  const gas = (estimate * 13n + 9n) / 10n;
  const baseMaxFee = fees.maxFeePerGas ?? fees.gasPrice;
  const maxFeePerGas = (baseMaxFee * 12_500n + 9_999n) / 10_000n;
  const maxPriorityFeePerGas = (fees.maxPriorityFeePerGas ?? 0n) <= maxFeePerGas ? (fees.maxPriorityFeePerGas ?? 0n) : maxFeePerGas;
  if (!rehearsal) {
    const sealed = funding.transactionGasCeilings[index];
    if (sealed.label !== template.label || gas > BigInt(sealed.gasCeiling)) {
      throw new Error(`${logicalKey} exceeds the rehearsed gas ceiling`);
    }
    if (maxFeePerGas > BigInt(funding.maxFeePerGasWei)) {
      throw new Error(`${logicalKey} exceeds the sealed fee ceiling`);
    }
    const remainingCost = funding.transactionGasCeilings.slice(index).reduce(
      (sum, item) => sum + BigInt(item.gasCeiling) * BigInt(funding.maxFeePerGasWei) + l1FeePerTransaction,
      0n,
    );
    if (currentBalance < reserve + remainingCost) {
      throw new Error(`${logicalKey} would breach the sealed reserve or remaining deployment funding`);
    }
  }
  const request = { account, to, data, value, nonce, gas, maxFeePerGas, maxPriorityFeePerGas, type: "eip1559" };
  const serialized = await wallet.signTransaction(request);
  const transactionHash = keccak256(serialized);
  const idempotencyKey = keccak256(`0x${Buffer.from(logicalKey).toString("hex")}`);
  await append({
    type: "intent", recordedAt: new Date().toISOString(), logicalKey, idempotencyKey,
    chainId: prepared.chainId, nonce: String(nonce), label: template.label,
    to: to ?? null, valueWei: value.toString(), calldataHash: keccak256(data),
    gasEstimate: estimate.toString(), gasLimit: gas.toString(), maxFeePerGasWei: maxFeePerGas.toString(),
    maxPriorityFeePerGasWei: maxPriorityFeePerGas.toString(), transactionHash,
  });
  let published;
  try {
    published = await client.sendRawTransaction({ serializedTransaction: serialized });
  } catch (error) {
    const [afterLatest, afterPending] = await Promise.all([
      client.getTransactionCount({ address: deployer, blockTag: "latest" }),
      client.getTransactionCount({ address: deployer, blockTag: "pending" }),
    ]);
    if (afterLatest !== nonce || afterPending !== nonce) throw new Error(`${logicalKey} submission is ambiguous; manual reconciliation required`);
    await append({ type: "submission-rejected", recordedAt: new Date().toISOString(), logicalKey, idempotencyKey, transactionHash, error: String(error?.shortMessage ?? error?.message ?? error).slice(0, 500) });
    throw new Error(`${logicalKey} was rejected before admission`);
  }
  if (published !== transactionHash) throw new Error(`${logicalKey} transaction hash changed`);
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${logicalKey} reverted`);
  if (template.expectedContractAddress) {
    const code = await client.getCode({ address: template.expectedContractAddress });
    if (!code || code === "0x") throw new Error(`${logicalKey} expected runtime missing`);
  }
  await append({
    type: "receipt", recordedAt: new Date().toISOString(), logicalKey, idempotencyKey,
    transactionHash, blockNumber: receipt.blockNumber.toString(), status: receipt.status,
    gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    contractAddress: receipt.contractAddress, receiptDigest: receiptDigest(receipt), label: template.label,
  });
}
process.stdout.write(`${JSON.stringify({ passed: true, confirmedTransactions: (await loadJournal()).filter((record) => record.type === "receipt").length, expectedTransactions: prepared.transactions.length })}\n`);

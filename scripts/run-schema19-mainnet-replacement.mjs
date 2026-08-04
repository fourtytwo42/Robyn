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

const stage = process.argv[2];
const [replacementArgument, preparedArgument, forgeLedgerArgument, fundingArgument, evidenceArgument] =
  process.argv.slice(3);
if (
  !new Set(["verify", "deploy", "status"]).has(stage) ||
  !replacementArgument ||
  !preparedArgument ||
  !forgeLedgerArgument ||
  !fundingArgument ||
  !evidenceArgument
) {
  throw new Error(
    "usage: run-schema19-mainnet-replacement.mjs verify|deploy|status <replacement-manifest> <prepared> <forge-ledger> <funding> <evidence-dir>",
  );
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
  throw new Error("Schema-19 Mainnet deployment requires exact clean pushed tooling");
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const [replacementRaw, preparedRaw, forgeLedgerRaw, fundingRaw] = await Promise.all([
  readFile(path.resolve(replacementArgument), "utf8"),
  readFile(path.resolve(preparedArgument), "utf8"),
  readFile(path.resolve(forgeLedgerArgument), "utf8"),
  readFile(path.resolve(fundingArgument), "utf8"),
]);
const replacement = JSON.parse(replacementRaw);
const replacementSha = sha256(replacementRaw);
const prepared = JSON.parse(preparedRaw);
const forgeLedger = JSON.parse(forgeLedgerRaw);
const funding = JSON.parse(fundingRaw);
if (
  prepared.schemaVersion !== 19 ||
  prepared.chainId !== 4663 ||
  replacement.schemaVersion !== 19 ||
  replacement.chainId !== 4663 ||
  replacement.gate !== "schema19-mainnet-public-replacement" ||
  replacement.identities.operationalToolingSha !== toolingSha ||
  replacement.identities.preparedDeploymentSha256 !== sha256(preparedRaw) ||
  replacement.identities.deploymentLedgerSha256 !== sha256(forgeLedgerRaw) ||
  replacement.identities.fundingReportSha256 !== sha256(fundingRaw)
) {
  throw new Error("Schema-19 replacement manifest identity mismatch");
}
const expectedTransactions = Number(prepared.deployment.fullEndingNonceExclusive) - Number(prepared.deployment.startingNonce);
if (forgeLedger.transactions?.length !== expectedTransactions || forgeLedger.receipts?.length !== expectedTransactions || forgeLedger.receipts.some((receipt) => receipt.status !== "0x1")) {
  throw new Error("exact successful 36-receipt deployment ledger required");
}
const validatedLedger = { transactionCount: expectedTransactions };
if (
  funding.schemaVersion !== 19 ||
  funding.chainId !== 4663 ||
  funding.passed !== true ||
  funding.deploymentLedgerSha256 !== sha256(forgeLedgerRaw) ||
  funding.bridgeShortfall !== "0"
) {
  throw new Error("passing exact Schema-19 funding report required");
}
if (stage === "deploy") {
  const authorizationRaw = await readFile(path.resolve(process.env.ROBYN_SCHEMA19_MAINNET_REPLACEMENT_AUTHORIZATION_RECEIPT ?? ""), "utf8");
  const authorization = JSON.parse(authorizationRaw);
  if (process.env.ROBYN_SCHEMA19_MAINNET_REPLACEMENT_AUTHORIZED !== replacementSha || authorization.authorized !== true || authorization.manifestSha256 !== replacementSha || authorization.scope !== "schema19-deployment-schema18-archive-and-application-cutover" || authorization.schema19DeploymentAuthorized !== true || authorization.schema18RetirementAuthorized !== true || authorization.applicationWritesAuthorized !== true || authorization.additionalBridgeAuthorized !== false) {
    throw new Error("exact replacement manifest lacks matching authorization");
  }
}
const rpcUrl = process.env.ROBYN_SCHEMA19_MAINNET_RPC_URL ?? "http://127.0.0.1:18549";
const parsedRpc = new URL(rpcUrl);
if (!["127.0.0.1", "localhost"].includes(parsedRpc.hostname)) {
  throw new Error("Schema-19 Mainnet transactions require the loopback LAN gateway");
}
const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0, timeout: 30_000 }) });
if (
  (await client.getChainId()) !== 4663 ||
  (await client.request({ method: "eth_syncing", params: [] })) !== false
) {
  throw new Error("Schema-19 Mainnet RPC is wrong-chain or syncing");
}
const gateway = await fetch(new URL("/health", rpcUrl)).then(async (response) => {
  if (!response.ok) throw new Error(`gateway health ${response.status}`);
  return response.json();
});
if (
  gateway.status !== "ok" ||
  gateway.activeProvider !== "primary" ||
  gateway.providerSelection !== "operator" ||
  gateway.fallbackTrafficAuthorized !== false
) {
  throw new Error("Schema-19 Mainnet gateway is not healthy LAN-only");
}

const evidenceRoot = path.resolve(evidenceArgument);
await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const journalPath = path.join(evidenceRoot, "deployment-transactions.jsonl");
const deploymentIdentity = {
  schemaVersion: 19,
  chainId: 4663,
  toolingSha,
  contractReleaseSha: prepared.contractReleaseSha,
  preparedManifestSha256: sha256(preparedRaw),
  forgeLedgerSha256: sha256(forgeLedgerRaw),
  fundingReportSha256: sha256(fundingRaw),
  replacementManifestSha256: replacementSha,
};
const identityPath = path.join(evidenceRoot, "deployment-identity.json");
try {
  const current = JSON.parse(await readFile(identityPath, "utf8"));
  if (JSON.stringify(current) !== JSON.stringify(deploymentIdentity)) {
    throw new Error("deployment evidence belongs to another Schema-19 manifest");
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  await writeFile(identityPath, `${JSON.stringify(deploymentIdentity, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
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
const receiptDigest = (receipt) =>
  sha256(
    JSON.stringify({
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber.toString(),
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      contractAddress: receipt.contractAddress,
      logs: receipt.logs.map((log) => ({
        address: log.address,
        topics: log.topics,
        data: log.data,
      })),
    }),
  );
const missing = (error) =>
  /not found|could not be found/i.test(
    String(error?.shortMessage ?? error?.message ?? error),
  );

const deployer = getAddress(prepared.deployment.deployer);
const expectedStart = Number(prepared.deployment.startingNonce);
const records = await loadJournal();
const confirmed = records.filter((record) => record.type === "receipt").length;
const statusResult = {
  ...deploymentIdentity,
  expectedTransactions: validatedLedger.transactionCount,
  confirmedTransactions: confirmed,
  latestNonce: await client.getTransactionCount({ address: deployer, blockTag: "latest" }),
  pendingNonce: await client.getTransactionCount({ address: deployer, blockTag: "pending" }),
  balanceWei: (await client.getBalance({ address: deployer })).toString(),
  gateway: {
    status: gateway.status,
    activeProvider: gateway.activeProvider,
    fallbackTrafficAuthorized: gateway.fallbackTrafficAuthorized,
  },
};
if (stage === "status") {
  process.stdout.write(`${JSON.stringify(statusResult)}\n`);
  process.exit(0);
}

for (const address of Object.values(prepared.deployment.contracts)) {
  const code = await client.getCode({ address });
  if (confirmed === 0 && code && code !== "0x") {
    throw new Error(`predicted Schema-19 address already contains code: ${address}`);
  }
}
if (stage === "verify") {
  if (statusResult.latestNonce !== expectedStart || statusResult.pendingNonce !== expectedStart) {
    throw new Error("Schema-19 Mainnet deployer nonce changed before deployment");
  }
  if (BigInt(statusResult.balanceWei) < BigInt(funding.requiredBalance)) {
    throw new Error("Schema-19 Mainnet funding fell below the sealed requirement");
  }
  process.stdout.write(`${JSON.stringify({ ...statusResult, passed: true })}\n`);
  process.exit(0);
}

const keystore = path.resolve(
  process.env.ROBYN_MAINNET_KEYSTORE ??
    "/home/hendo420/.config/robyn/wallets/robinhood-mainnet-deployer/robyn-mainnet-deployer",
);
const passwordFile = path.resolve(
  process.env.ROBYN_MAINNET_PASSWORD_FILE ??
    "/home/hendo420/.config/robyn/wallets/robinhood-mainnet-deployer/password",
);
const password = (await readFile(passwordFile, "utf8")).trimEnd();
const cast = path.join(process.env.HOME ?? "/home/hendo420", ".foundry", "bin", "cast");
const decrypted = command(
  cast,
  ["wallet", "decrypt-keystore", path.basename(keystore), "--keystore-dir", path.dirname(keystore)],
  { env: { ...process.env, CAST_UNSAFE_PASSWORD: password } },
);
const account = privateKeyToAccount(parseCastDecryptedPrivateKey(decrypted));
if (getAddress(account.address) !== deployer) throw new Error("Mainnet keystore address mismatch");
const mainnetChain = defineChain({
  id: 4663,
  name: "Robinhood Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const wallet = createWalletClient({
  account,
  chain: mainnetChain,
  transport: http(rpcUrl, { retryCount: 0, timeout: 30_000 }),
});

for (let index = 0; index < forgeLedger.transactions.length; index += 1) {
  const template = forgeLedger.transactions[index].transaction;
  const nonce = Number(BigInt(template.nonce));
  if (nonce !== expectedStart + index) throw new Error("template deployment nonce mismatch");
  const logicalKey = `schema19-mainnet-deployment:${deploymentIdentity.preparedManifestSha256}:${nonce}`;
  const classified = classifyCanaryJournal(await loadJournal(), logicalKey);
  if (classified.receipt) {
    const receipt = await client.getTransactionReceipt({ hash: classified.receipt.transactionHash });
    if (receipt.status !== "success" || receiptDigest(receipt) !== classified.receipt.receiptDigest) {
      throw new Error(`${logicalKey} confirmed receipt changed`);
    }
    continue;
  }
  if (classified.activeIntent) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: classified.activeIntent.transactionHash });
      if (receipt.status !== "success") throw new Error(`${logicalKey} reverted`);
      await append({
        type: "receipt",
        recordedAt: new Date().toISOString(),
        logicalKey,
        idempotencyKey: classified.activeIntent.idempotencyKey,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString(),
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
        contractAddress: receipt.contractAddress,
        receiptDigest: receiptDigest(receipt),
      });
      continue;
    } catch (error) {
      if (!missing(error)) throw error;
      throw new Error(`${logicalKey} has an unresolved signed intent; replay is prohibited`);
    }
  }
  const [latest, pending, fees, balance] = await Promise.all([
    client.getTransactionCount({ address: deployer, blockTag: "latest" }),
    client.getTransactionCount({ address: deployer, blockTag: "pending" }),
    client.estimateFeesPerGas(),
    client.getBalance({ address: deployer }),
  ]);
  if (latest !== nonce || pending !== nonce) throw new Error(`${logicalKey} nonce is ambiguous`);
  const to = template.to ? getAddress(template.to) : undefined;
  const data = template.input;
  const value = BigInt(template.value ?? 0);
  const estimate = await client.estimateGas({ account: deployer, to, data, value });
  const baseMaxFee = fees.maxFeePerGas ?? fees.gasPrice;
  const maxFeePerGas = (baseMaxFee * 12_500n + 9_999n) / 10_000n;
  const maxPriorityFeePerGas =
    (fees.maxPriorityFeePerGas ?? 0n) <= maxFeePerGas
      ? (fees.maxPriorityFeePerGas ?? 0n)
      : maxFeePerGas;
  const sealedGasCeiling = BigInt(replacement.execution.transactionGasCeilings[String(nonce)] ?? 0);
  if (sealedGasCeiling === 0n || estimate > sealedGasCeiling) throw new Error(`${logicalKey} exceeds sealed gas ceiling`);
  const gas = sealedGasCeiling;
  if (maxFeePerGas > BigInt(replacement.execution.maxFeePerGasWei)) throw new Error(`${logicalKey} exceeds sealed fee ceiling`);
  const remainingReserve = 20_000_000_000_000_000n;
  const l1FeeReserve = 25_000_000_000_000n;
  if (balance < value + gas * maxFeePerGas + l1FeeReserve + remainingReserve) {
    throw new Error(`${logicalKey} would breach the fixed Mainnet reserve`);
  }
  const request = {
    account,
    to,
    data,
    value,
    nonce,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    type: "eip1559",
  };
  const serialized = await wallet.signTransaction(request);
  const transactionHash = keccak256(serialized);
  const idempotencyKey = keccak256(`0x${Buffer.from(logicalKey).toString("hex")}`);
  await append({
    type: "intent",
    recordedAt: new Date().toISOString(),
    logicalKey,
    idempotencyKey,
    chainId: 4663,
    nonce: String(nonce),
    to: to ?? null,
    valueWei: value.toString(),
    calldataHash: keccak256(data),
    gasEstimate: estimate.toString(),
    gasLimit: gas.toString(),
    maxFeePerGasWei: maxFeePerGas.toString(),
    maxPriorityFeePerGasWei: maxPriorityFeePerGas.toString(),
    transactionHash,
  });
  let published;
  try {
    published = await client.sendRawTransaction({ serializedTransaction: serialized });
  } catch (error) {
    const [afterLatest, afterPending] = await Promise.all([
      client.getTransactionCount({ address: deployer, blockTag: "latest" }),
      client.getTransactionCount({ address: deployer, blockTag: "pending" }),
    ]);
    if (afterLatest !== nonce || afterPending !== nonce) {
      throw new Error(`${logicalKey} submission is ambiguous; manual reconciliation required`);
    }
    await append({
      type: "submission-rejected",
      recordedAt: new Date().toISOString(),
      logicalKey,
      idempotencyKey,
      transactionHash,
      error: String(error?.shortMessage ?? error?.message ?? error).slice(0, 500),
    });
    throw new Error(`${logicalKey} was rejected before admission`);
  }
  if (published !== transactionHash) throw new Error(`${logicalKey} transaction hash changed`);
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${logicalKey} reverted`);
  await append({
    type: "receipt",
    recordedAt: new Date().toISOString(),
    logicalKey,
    idempotencyKey,
    transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    status: receipt.status,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    contractAddress: receipt.contractAddress,
    receiptDigest: receiptDigest(receipt),
  });
}
process.stdout.write(
  `${JSON.stringify({ passed: true, confirmedTransactions: (await loadJournal()).filter((record) => record.type === "receipt").length, expectedTransactions: validatedLedger.transactionCount })}\n`,
);

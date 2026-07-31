#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  decryptCampaignRoot,
  deriveCampaignAccounts,
} from "./lib/campaign-wallets.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const stateDir = resolve(option("state-dir", "/nonexistent"));
const passphrasePath = resolve(option("passphrase-file", "/nonexistent"));
const allowBondingHistory = option("allow-bonding-history", "false") === "true";
const allowIncompleteHistory =
  option("allow-incomplete-history", "false") === "true";
const manifestPath = resolve(
  option("manifest", "deployments/46630-v4-schema16.json"),
);
const rpcUrl = option("rpc-url", "http://127.0.0.1:18548");
const outputPath = resolve(
  option("output", join(stateDir, "failed-funding-recovery.json")),
);
const runStatePath = resolve(
  option(
    "run-state",
    join(
      "/var/lib/robyn/testnet-endurance",
      option("run-id", "invalid"),
      "state.json",
    ),
  ),
);

function protectedText(path, label) {
  const details = statSync(path);
  if (!details.isFile() || (details.mode & 0o077) !== 0) {
    throw new Error(`${label} must be mode 0600 or stricter`);
  }
  return readFileSync(path, "utf8").trim();
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function json(value) {
  return JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
}
function atomicWrite(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${json(value)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

const manifest = readJson(manifestPath);
if (manifest.schemaVersion !== 16 || manifest.chainId !== 46630) {
  throw new Error("Funding recovery requires the Schema-16 Testnet manifest");
}
const campaignState = readJson(join(stateDir, "state.json"));
const failedRun = readJson(runStatePath);
const retainedLaunches = failedRun.enduranceLaunches ?? [];
const hasGraduationHistory = (failedRun.transactions ?? []).some((entry) =>
  entry.label?.startsWith("endurance-graduate-"),
);
const healthySeconds = Number(failedRun.healthySeconds ?? 0);
const incompleteHistoryIsEligible =
  allowIncompleteHistory &&
  failedRun.completed !== true &&
  failedRun.terminalFailure;
if (
  failedRun.runId !== option("run-id") ||
  failedRun.failed !== true ||
  (healthySeconds !== 0 && !incompleteHistoryIsEligible) ||
  (retainedLaunches.length !== 0 && !allowBondingHistory) ||
  (hasGraduationHistory && !incompleteHistoryIsEligible)
) {
  throw new Error(
    "Funding recovery requires an eligible failed, incomplete run without graduation history",
  );
}
if (allowIncompleteHistory && !allowBondingHistory) {
  throw new Error("Incomplete-history recovery also requires --allow-bonding-history true");
}
if (campaignState.walletCount !== 100) {
  throw new Error("Funding recovery requires the encrypted 100-wallet identity");
}
const passphrase = protectedText(passphrasePath, "Campaign passphrase");
const root = decryptCampaignRoot(
  readJson(join(stateDir, "encrypted-root.json")),
  passphrase,
);
const derived = deriveCampaignAccounts(root, campaignState.campaignId, 100);
for (const actor of campaignState.actors) {
  if (getAddress(actor.address) !== getAddress(derived[actor.index].address)) {
    throw new Error(`Campaign actor ${actor.index} does not match encrypted root`);
  }
}

const chain = defineChain({
  id: 46630,
  name: "Robinhood Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  testnet: true,
});
const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl, { retryCount: 3, retryDelay: 500, timeout: 15_000 }),
});
if ((await publicClient.getChainId()) !== 46630) {
  throw new Error("Funding recovery RPC is not chain 46630");
}
const wallet = (account) =>
  createWalletClient({
    account,
    chain,
    transport: http(rpcUrl, { retryCount: 0, timeout: 15_000 }),
  });
const daoAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];

let journal;
try {
  journal = readJson(outputPath);
  if (
    journal.campaignId !== campaignState.campaignId ||
    journal.failedRunId !== failedRun.runId ||
    journal.recipient !== manifest.deployer
  ) {
    throw new Error("Existing recovery journal identity mismatch");
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  journal = {
    schemaVersion: 1,
    campaignId: campaignState.campaignId,
    failedRunId: failedRun.runId,
    failedRunStateSha256: createHash("sha256")
      .update(readFileSync(runStatePath))
      .digest("hex"),
    recipient: manifest.deployer,
    bondingHistoryRecovery: retainedLaunches.length > 0,
    incompleteHistoryRecovery: healthySeconds !== 0,
    graduationHistoryRecovery: hasGraduationHistory,
    originalHealthySeconds: healthySeconds,
    terminalFailure: failedRun.terminalFailure
      ? {
          message:
            failedRun.terminalFailure.message ??
            failedRun.terminalFailure.reason ??
            null,
          sampledAt:
            failedRun.terminalFailure.sampledAt ??
            failedRun.terminalFailure.at ??
            null,
        }
      : null,
    graduationTransactions: (failedRun.transactions ?? [])
      .filter((entry) => entry.label?.startsWith("endurance-graduate-"))
      .map(({ label, hash, blockNumber }) => ({ label, hash, blockNumber })),
    retainedLaunches: retainedLaunches.map((launch) => ({
      index: launch.index,
      token: launch.token,
      transactionHash: launch.transactionHash,
    })),
    transactions: [],
    completed: false,
    createdAt: new Date().toISOString(),
  };
  atomicWrite(outputPath, journal);
}

async function confirm(label, account, request) {
  let entry = journal.transactions.find((item) => item.label === label);
  if (entry?.status === "confirmed") {
    const receipt = await publicClient.getTransactionReceipt({ hash: entry.hash });
    if (receipt.status !== "success") {
      throw new Error(`Previously confirmed recovery transaction failed: ${label}`);
    }
    return entry;
  }
  let hash = entry?.hash;
  if (!hash) {
    const estimatedGas = await publicClient.estimateGas(request);
    const gas = estimatedGas + estimatedGas / 2n;
    hash = await wallet(account).sendTransaction({ ...request, gas });
    entry = {
      label,
      hash,
      from: account.address,
      to: request.to,
      value: String(request.value ?? 0n),
      status: "submitted",
      submittedAt: new Date().toISOString(),
    };
    journal.transactions.push(entry);
    atomicWrite(outputPath, journal);
  }
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180_000,
  });
  if (receipt.status !== "success") {
    entry.status = "failed";
    entry.blockNumber = receipt.blockNumber.toString();
    atomicWrite(outputPath, journal);
    throw new Error(`Recovery transaction failed: ${label}`);
  }
  entry.status = "confirmed";
  entry.blockNumber = receipt.blockNumber.toString();
  entry.gasUsed = receipt.gasUsed.toString();
  entry.confirmedAt = new Date().toISOString();
  atomicWrite(outputPath, journal);
  return entry;
}

const recipient = getAddress(manifest.deployer);
const daoToken = getAddress(manifest.contracts.daoToken);
const projectBalanceBefore = await publicClient.getBalance({ address: recipient });
for (const item of derived) {
  const account = privateKeyToAccount(item.privateKey);
  const balance = await publicClient.readContract({
    address: daoToken,
    abi: daoAbi,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (balance === 0n) continue;
  await confirm(`recover-rdao-${item.index}`, account, {
    account,
    to: daoToken,
    data: encodeFunctionData({
      abi: daoAbi,
      functionName: "transfer",
      args: [recipient, balance],
    }),
    value: 0n,
  });
}
for (const item of derived) {
  const account = privateKeyToAccount(item.privateKey);
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) continue;
  const gasPrice = await publicClient.getGasPrice();
  const estimatedGas = await publicClient.estimateGas({
    account,
    to: recipient,
    value: 1n,
    gasPrice,
  });
  const gas = estimatedGas + estimatedGas / 2n;
  const reserve = (gas * gasPrice * 125n) / 100n;
  if (balance <= reserve) continue;
  await confirm(`recover-native-${item.index}`, account, {
    account,
    to: recipient,
    value: balance - reserve,
    gasPrice,
  });
}
const projectBalanceAfter = await publicClient.getBalance({ address: recipient });
journal.completed = true;
journal.completedAt = new Date().toISOString();
journal.projectBalanceBeforeWei = projectBalanceBefore.toString();
journal.projectBalanceAfterWei = projectBalanceAfter.toString();
journal.recoveredNativeWei = (projectBalanceAfter - projectBalanceBefore).toString();
journal.confirmedTransactionCount = journal.transactions.filter(
  ({ status }) => status === "confirmed",
).length;
atomicWrite(outputPath, journal);
process.stdout.write(
  `${json({
    completed: journal.completed,
    failedRunId: journal.failedRunId,
    recoveredNativeWei: journal.recoveredNativeWei,
    confirmedTransactionCount: journal.confirmedTransactionCount,
    outputPath,
  })}\n`,
);

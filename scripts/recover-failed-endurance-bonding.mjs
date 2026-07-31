#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  decryptCampaignRoot,
  deriveCampaignAccounts,
} from "./lib/campaign-wallets.mjs";
import { parseCastDecryptedPrivateKey } from "./lib/campaign-keystore.mjs";
import {
  ENDURANCE_L1_DATA_FEE_RESERVE_WEI,
  ENDURANCE_RESERVE_WEI,
  normalizeFeeEnvelope,
  transactionFundingShortfall,
  transactionFundingTarget,
} from "./testnet-endurance-policy.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const runId = option("run-id");
if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(runId ?? "")) {
  throw new Error("A valid --run-id is required");
}
const stateDir = resolve(option("state-dir", "/nonexistent"));
const runStatePath = resolve(option("run-state", "/nonexistent"));
const passphrasePath = resolve(option("passphrase-file", "/nonexistent"));
const manifestPath = resolve(
  option("manifest", "deployments/46630-v4-schema16.json"),
);
const rpcUrl = option("rpc-url", "http://127.0.0.1:18548");
const receiptRpcUrl = option("receipt-rpc-url", rpcUrl);
const outputPath = resolve(
  option("output", join(stateDir, "bonding-position-recovery.json")),
);
const minimumOutputBps = BigInt(option("minimum-output-bps", "9900"));
if (minimumOutputBps <= 0n || minimumOutputBps > 10_000n) {
  throw new Error("minimum-output-bps must be between 1 and 10000");
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
function protectedText(path, label) {
  const details = statSync(path);
  if (!details.isFile() || (details.mode & 0o077) !== 0) {
    throw new Error(`${label} must be mode 0600 or stricter`);
  }
  return readFileSync(path, "utf8").trim();
}
function atomicWrite(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${json(value)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

const manifest = readJson(manifestPath);
if (manifest.schemaVersion !== 16 || manifest.chainId !== 46630) {
  throw new Error("Bonding recovery requires the active Schema-16 manifest");
}
const campaignState = readJson(join(stateDir, "state.json"));
const failedRun = readJson(runStatePath);
if (
  campaignState.campaignId !== runId ||
  campaignState.walletCount !== 100 ||
  failedRun.runId !== runId ||
  failedRun.failed !== true ||
  failedRun.completed === true ||
  !failedRun.terminalFailure
) {
  throw new Error("Bonding recovery requires an incomplete failed run");
}
const ambiguousTransactions = (failedRun.transactions ?? []).filter(
  (entry) =>
    entry.expectedFailure !== true &&
    (!entry.hash || !entry.confirmedAt || !entry.blockNumber),
);
const malformedExpectedFailures = (failedRun.transactions ?? []).filter(
  (entry) =>
    entry.expectedFailure === true &&
    (entry.hash || !entry.observedAt || !entry.reason),
);
if (ambiguousTransactions.length > 0 || malformedExpectedFailures.length > 0) {
  throw new Error("Bonding recovery refuses ambiguous run transactions");
}

const campaignPassphrase = protectedText(
  passphrasePath,
  "Campaign passphrase",
);
const campaignRoot = decryptCampaignRoot(
  readJson(join(stateDir, "encrypted-root.json")),
  campaignPassphrase,
);
const derived = deriveCampaignAccounts(campaignRoot, runId, 100);
for (const actor of campaignState.actors) {
  if (getAddress(actor.address) !== getAddress(derived[actor.index].address)) {
    throw new Error(`Campaign actor ${actor.index} does not match encrypted root`);
  }
}
const actors = derived.map(({ privateKey }) =>
  privateKeyToAccount(privateKey),
);

function projectAccount() {
  const keystore = resolve(
    process.env.ROBYN_TESTNET_KEYSTORE ?? "/nonexistent",
  );
  const password = protectedText(
    resolve(process.env.ROBYN_TESTNET_PASSWORD_FILE ?? "/nonexistent"),
    "Project keystore password",
  );
  const decrypted = execFileSync(
    join(process.env.HOME, ".foundry", "bin", "cast"),
    [
      "wallet",
      "decrypt-keystore",
      basename(keystore),
      "--keystore-dir",
      dirname(keystore),
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CAST_UNSAFE_PASSWORD: password },
    },
  );
  const account = privateKeyToAccount(
    parseCastDecryptedPrivateKey(decrypted),
  );
  if (getAddress(account.address) !== getAddress(manifest.deployer)) {
    throw new Error("Project keystore does not match the active deployer");
  }
  return account;
}
const project = projectAccount();
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
const receiptClient = createPublicClient({
  chain,
  transport: http(receiptRpcUrl, {
    retryCount: 3,
    retryDelay: 500,
    timeout: 15_000,
  }),
});
const writer = (account) =>
  createWalletClient({
    account,
    chain,
    transport: http(rpcUrl, { retryCount: 0, timeout: 15_000 }),
  });
if (
  (await publicClient.getChainId()) !== 46630 ||
  (await receiptClient.getChainId()) !== 46630
) {
  throw new Error("Bonding recovery RPC is not chain 46630");
}

const tokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];
const marketAbi = [
  {
    type: "function",
    name: "graduated",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "quoteSell",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenInput", type: "uint256" }],
    outputs: [
      { name: "feeAmount", type: "uint256" },
      { name: "nativeOutput", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenInput", type: "uint256" },
      { name: "minimumNativeOutput", type: "uint256" },
    ],
    outputs: [{ name: "nativeOutput", type: "uint256" }],
  },
];

let journal;
try {
  journal = readJson(outputPath);
  if (
    journal.runId !== runId ||
    getAddress(journal.recipient) !== getAddress(project.address) ||
    journal.runStateSha256 !==
      createHash("sha256").update(readFileSync(runStatePath)).digest("hex")
  ) {
    throw new Error("Existing bonding recovery journal identity mismatch");
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  journal = {
    schemaVersion: 1,
    runId,
    chainId: 46630,
    recipient: project.address,
    runStateSha256: createHash("sha256")
      .update(readFileSync(runStatePath))
      .digest("hex"),
    minimumOutputBps: minimumOutputBps.toString(),
    retainedGraduatedLaunches: [],
    launches: [],
    transactions: [],
    completed: false,
    createdAt: new Date().toISOString(),
  };
  atomicWrite(outputPath, journal);
}

for (const entry of failedRun.transactions ?? []) {
  if (entry.expectedFailure === true) continue;
  const receipt = await receiptClient.getTransactionReceipt({ hash: entry.hash });
  if (receipt.status !== "success") {
    throw new Error(`Run transaction is not confirmed successful: ${entry.label}`);
  }
}

async function feeEnvelope() {
  const fees = await publicClient.estimateFeesPerGas();
  const fallbackGasPrice = await publicClient.getGasPrice();
  return normalizeFeeEnvelope({ ...fees, fallbackGasPrice });
}

async function submit(
  label,
  account,
  request,
  expectedEffect,
  preparedOverride,
) {
  let entry = journal.transactions.find((item) => item.label === label);
  if (entry?.status === "confirmed") {
    const receipt = await publicClient.getTransactionReceipt({ hash: entry.hash });
    if (receipt.status !== "success") {
      throw new Error(`Previously confirmed recovery transaction failed: ${label}`);
    }
    return entry;
  }
  if (entry?.hash) {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: entry.hash,
      confirmations: 1,
      timeout: 180_000,
    });
    if (receipt.status !== "success") {
      entry.status = "failed";
      atomicWrite(outputPath, journal);
      throw new Error(`Submitted recovery transaction failed: ${label}`);
    }
    entry.status = "confirmed";
    entry.blockNumber = receipt.blockNumber.toString();
    entry.gasUsed = receipt.gasUsed.toString();
    entry.confirmedAt = new Date().toISOString();
    atomicWrite(outputPath, journal);
    return entry;
  }
  const requestCalldataHash = keccak256(request.data ?? "0x");
  const preparedIdentityMismatch =
    entry &&
    (entry.status !== "prepared" ||
      entry.from !== account.address ||
      entry.to !== request.to ||
      entry.value !== String(request.value ?? 0n) ||
      entry.calldataHash !== requestCalldataHash ||
      (preparedOverride &&
        (entry.maxFeePerGas !==
          preparedOverride.envelope.maxFeePerGas.toString() ||
          entry.maxPriorityFeePerGas !==
            preparedOverride.envelope.maxPriorityFeePerGas.toString() ||
          entry.gas !== preparedOverride.gas.toString())));
  if (preparedIdentityMismatch) {
    if (entry.status !== "prepared" || entry.hash || !preparedOverride) {
      throw new Error(`Prepared recovery transaction identity mismatch: ${label}`);
    }
    entry.supersededPreparations ??= [];
    entry.supersededPreparations.push({
      value: entry.value,
      calldataHash: entry.calldataHash,
      maxFeePerGas: entry.maxFeePerGas,
      maxPriorityFeePerGas: entry.maxPriorityFeePerGas,
      gas: entry.gas,
      supersededAt: new Date().toISOString(),
      reason: "unbroadcast-fee-envelope-refresh",
    });
    entry.from = account.address;
    entry.to = request.to;
    entry.value = String(request.value ?? 0n);
    entry.calldataHash = requestCalldataHash;
    entry.expectedEffect = expectedEffect;
    entry.maxFeePerGas = preparedOverride.envelope.maxFeePerGas.toString();
    entry.maxPriorityFeePerGas =
      preparedOverride.envelope.maxPriorityFeePerGas.toString();
    entry.gas = preparedOverride.gas.toString();
    entry.repreparedAt = new Date().toISOString();
    atomicWrite(outputPath, journal);
  }
  if (!entry) {
    const envelope = preparedOverride?.envelope ?? (await feeEnvelope());
    const estimatedGas =
      preparedOverride?.estimatedGas ??
      (await publicClient.estimateGas({
        ...request,
        account,
        ...envelope,
      }));
    const gas = preparedOverride?.gas ?? estimatedGas * 2n;
    entry = {
      label,
      idempotencyKey: keccak256(
        encodeFunctionData({
          abi: [
            {
              type: "function",
              name: "recovery",
              stateMutability: "pure",
              inputs: [
                { name: "runId", type: "string" },
                { name: "label", type: "string" },
              ],
              outputs: [],
            },
          ],
          functionName: "recovery",
          args: [runId, label],
        }),
      ),
      from: account.address,
      to: request.to,
      value: String(request.value ?? 0n),
      calldataHash: requestCalldataHash,
      expectedEffect,
      maxFeePerGas: envelope.maxFeePerGas.toString(),
      maxPriorityFeePerGas: envelope.maxPriorityFeePerGas.toString(),
      gas: gas.toString(),
      status: "prepared",
      preparedAt: new Date().toISOString(),
    };
    journal.transactions.push(entry);
    atomicWrite(outputPath, journal);
  }
  const hash = await writer(account).sendTransaction({
    ...request,
    account,
    gas: BigInt(entry.gas),
    maxFeePerGas: BigInt(entry.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(entry.maxPriorityFeePerGas),
  });
  entry.hash = hash;
  entry.status = "submitted";
  entry.submittedAt = new Date().toISOString();
  atomicWrite(outputPath, journal);
  return submit(label, account, request, expectedEffect);
}

async function ensureActorFunding(label, account, request) {
  const envelope = await feeEnvelope();
  const fundShortfall = async (stage, targetWei) => {
    const balanceWei = await publicClient.getBalance({ address: account.address });
    const shortfall = transactionFundingShortfall({ balanceWei, targetWei });
    if (shortfall === 0n) return;
    const projectBalance = await publicClient.getBalance({ address: project.address });
    if (projectBalance < shortfall + ENDURANCE_RESERVE_WEI) {
      throw new Error(`Recovery funding ${label} would breach the project reserve`);
    }
    await submit(
      `fund-${stage}-${label}-${targetWei}`,
      project,
      { to: account.address, value: shortfall, data: "0x" },
      `fund ${account.address} exactly once for ${stage} of ${label}`,
    );
  };
  const estimationTargetWei = transactionFundingTarget({
    valueWei: request.value ?? 0n,
    estimatedGas: 2_000_000n,
    maxFeePerGas: envelope.maxFeePerGas,
    additionalFeeReserveWei: ENDURANCE_L1_DATA_FEE_RESERVE_WEI,
  });
  await fundShortfall("estimate", estimationTargetWei);
  const estimatedGas = await publicClient.estimateGas({
    ...request,
    account,
    ...envelope,
  });
  const finalTargetWei = transactionFundingTarget({
    valueWei: request.value ?? 0n,
    estimatedGas,
    maxFeePerGas: envelope.maxFeePerGas,
    additionalFeeReserveWei: ENDURANCE_L1_DATA_FEE_RESERVE_WEI,
  });
  await fundShortfall("final", finalTargetWei);
  return { envelope, estimatedGas, gas: estimatedGas * 2n };
}

async function sweepRecoveredNative(token, index, account) {
  const actorBalance = await publicClient.getBalance({ address: account.address });
  const envelope = await feeEnvelope();
  const sweepProbe = {
    account,
    to: project.address,
    value: 1n,
    data: "0x",
    ...envelope,
  };
  const estimatedSweepGas = await publicClient.estimateGas(sweepProbe);
  const sweepGas = estimatedSweepGas * 2n;
  const sweepReserve = sweepGas * envelope.maxFeePerGas;
  if (actorBalance <= sweepReserve) return;
  await submit(
    `sweep-${token}-${index}`,
    account,
    {
      to: project.address,
      value: actorBalance - sweepReserve,
      data: "0x",
    },
    "return recovered liquid native value to the protected project deployer",
    { envelope, estimatedGas: estimatedSweepGas, gas: sweepGas },
  );
}

const projectBalanceBefore = await publicClient.getBalance({
  address: project.address,
});
for (const launch of failedRun.enduranceLaunches ?? []) {
  const token = getAddress(launch.token);
  const market = getAddress(launch.market);
  const graduated = await publicClient.readContract({
    address: market,
    abi: marketAbi,
    functionName: "graduated",
  });
  if (graduated) {
    if (!journal.retainedGraduatedLaunches.includes(token)) {
      journal.retainedGraduatedLaunches.push(token);
      atomicWrite(outputPath, journal);
    }
    continue;
  }
  let launchEntry = journal.launches.find((item) => item.token === token);
  if (!launchEntry) {
    launchEntry = { token, market, graduated: false, actors: [] };
    journal.launches.push(launchEntry);
    atomicWrite(outputPath, journal);
  }
  for (const [index, account] of actors.entries()) {
    let actorEntry = launchEntry.actors.find((item) => item.index === index);
    const tokenInput = await publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    });
    if (tokenInput === 0n) {
      const confirmedSell = journal.transactions.some(
        (item) =>
          item.label === `sell-${token}-${index}` && item.status === "confirmed",
      );
      if (actorEntry && !actorEntry.completedAt && confirmedSell) {
        await sweepRecoveredNative(token, index, account);
        actorEntry.completedAt = new Date().toISOString();
        actorEntry.resumedAfterConfirmedSell = true;
        atomicWrite(outputPath, journal);
      }
      continue;
    }
    actorEntry ??= {
        index,
        address: account.address,
        initialTokenInput: tokenInput.toString(),
      };
    if (!launchEntry.actors.some((item) => item.index === index)) {
      launchEntry.actors.push(actorEntry);
      atomicWrite(outputPath, journal);
    }
    const quoteData = encodeFunctionData({
      abi: marketAbi,
      functionName: "quoteSell",
      args: [tokenInput],
    });
    const quoteResult = await publicClient.call({ to: market, data: quoteData });
    const [, quotedNativeOutput] = decodeFunctionResult({
      abi: marketAbi,
      functionName: "quoteSell",
      data: quoteResult.data,
    });
    const economicFeeEnvelope = await feeEnvelope();
    const conservativeRecoveryCost =
      5_000_000n * economicFeeEnvelope.maxFeePerGas +
      4n * ENDURANCE_L1_DATA_FEE_RESERVE_WEI;
    if (quotedNativeOutput <= conservativeRecoveryCost) {
      actorEntry.skippedAt = new Date().toISOString();
      actorEntry.skippedReason = "quote-does-not-cover-conservative-gas";
      actorEntry.quotedNativeOutput = quotedNativeOutput.toString();
      actorEntry.conservativeRecoveryCost = conservativeRecoveryCost.toString();
      atomicWrite(outputPath, journal);
      continue;
    }
    const currentAllowance = await publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "allowance",
      args: [account.address, market],
    });
    if (currentAllowance < tokenInput) {
      const approveRequest = {
        to: token,
        data: encodeFunctionData({
          abi: tokenAbi,
          functionName: "approve",
          args: [market, tokenInput],
        }),
        value: 0n,
      };
      await publicClient.simulateContract({
        account,
        address: token,
        abi: tokenAbi,
        functionName: "approve",
        args: [market, tokenInput],
      });
      const approveFunding = await ensureActorFunding(
        `approve-${token}-${index}`,
        account,
        approveRequest,
      );
      await submit(
        `approve-${token}-${index}`,
        account,
        approveRequest,
        `approve exactly ${tokenInput} launch tokens for bounded bonding recovery`,
        approveFunding,
      );
    }
    const minimumNativeOutput =
      (quotedNativeOutput * minimumOutputBps) / 10_000n;
    if (minimumNativeOutput === 0n) {
      throw new Error(`Bonding recovery quote is zero for ${token} actor ${index}`);
    }
    const sellRequest = {
      to: market,
      data: encodeFunctionData({
        abi: marketAbi,
        functionName: "sell",
        args: [tokenInput, minimumNativeOutput],
      }),
      value: 0n,
    };
    await publicClient.simulateContract({
      account,
      address: market,
      abi: marketAbi,
      functionName: "sell",
      args: [tokenInput, minimumNativeOutput],
    });
    const sellFunding = await ensureActorFunding(
      `sell-${token}-${index}`,
      account,
      sellRequest,
    );
    await submit(
      `sell-${token}-${index}`,
      account,
      sellRequest,
      `sell ${tokenInput} project-controlled bonding tokens for at least ${minimumNativeOutput} wei`,
      sellFunding,
    );
    const remainingTokenBalance = await publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    });
    const remainingAllowance = await publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "allowance",
      args: [account.address, market],
    });
    if (remainingTokenBalance !== 0n || remainingAllowance !== 0n) {
      throw new Error(`Bonding recovery left token balance or allowance for ${token}`);
    }
    await sweepRecoveredNative(token, index, account);
    actorEntry.completedAt = new Date().toISOString();
    actorEntry.quotedNativeOutput = quotedNativeOutput.toString();
    actorEntry.minimumNativeOutput = minimumNativeOutput.toString();
    atomicWrite(outputPath, journal);
  }
}

const projectBalanceAfter = await publicClient.getBalance({
  address: project.address,
});
journal.completed = true;
journal.completedAt = new Date().toISOString();
journal.projectBalanceBeforeWei = projectBalanceBefore.toString();
journal.projectBalanceAfterWei = projectBalanceAfter.toString();
journal.recoveredNativeWei = (
  await journal.transactions.reduce(async (pendingTotal, entry) => {
    let total = await pendingTotal;
    if (entry.status !== "confirmed" || !entry.hash) return total;
    const receipt = await publicClient.getTransactionReceipt({ hash: entry.hash });
    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;
    if (getAddress(entry.from) === getAddress(project.address)) {
      total -= BigInt(entry.value) + gasCost;
    }
    if (
      getAddress(entry.to) === getAddress(project.address) &&
      getAddress(entry.from) !== getAddress(project.address)
    ) {
      total += BigInt(entry.value);
    }
    return total;
  }, Promise.resolve(0n))
).toString();
journal.confirmedTransactionCount = journal.transactions.filter(
  ({ status }) => status === "confirmed",
).length;
atomicWrite(outputPath, journal);
process.stdout.write(
  `${json({
    completed: journal.completed,
    runId,
    recoveredNativeWei: journal.recoveredNativeWei,
    retainedGraduatedLaunches: journal.retainedGraduatedLaunches,
    confirmedTransactionCount: journal.confirmedTransactionCount,
    outputPath,
  })}\n`,
);

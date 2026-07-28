#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statfsSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseCastDecryptedPrivateKey } from "./lib/campaign-keystore.mjs";
import {
  alignedConcentratedTicks,
  encodeV4MintPosition,
} from "./lib/v4-position-manager.mjs";
import {
  encodeUniversalV4Donation,
  encodeUniversalV4SingleSwap,
} from "./lib/v4-universal-router.mjs";
import {
  decryptCampaignRoot,
  deriveCampaignAccounts,
} from "./lib/campaign-wallets.mjs";
import {
  applyHeadroom,
  assertSecurityRemediationManifest,
  V4_FEE_COLLECTION_MINIMUMS,
} from "./lib/campaign-plan.mjs";
import {
  boundedTerminalCurveBuyValue,
  diskHeadroomPass,
  dueCount,
  dueLaunchCount,
  enduranceSamplePassed,
  enduranceCoverageFailures,
  ENDURANCE_DURATION_SECONDS,
  ENDURANCE_GRADUATION_THRESHOLDS_SECONDS,
  ENDURANCE_L1_DATA_FEE_RESERVE_WEI,
  ENDURANCE_MAXIMUM_API_P95_MS,
  ENDURANCE_MINIMUM_MEMORY_BYTES,
  ENDURANCE_RESERVE_WEI,
  ENDURANCE_REVIEW_INTERVAL_SECONDS,
  ENDURANCE_SAMPLE_INTERVAL_SECONDS,
  ENDURANCE_WRITE_INTERVAL_SECONDS,
  enduranceRelevantFiringAlerts,
  isRetryablePublicRpcError,
  isApprovedTestnetRpcUrl,
  percentile,
  processContinuityFailures,
  protocolHealthFailures,
  reconcileReleaseIdentity,
  rewardClaimIndexes,
  transactionFundingTarget,
} from "./testnet-endurance-policy.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const runId = process.env.ROBYN_ENDURANCE_RUN_ID;
if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(runId ?? "")) {
  throw new Error("ROBYN_ENDURANCE_RUN_ID is invalid");
}
const expectedReleaseLink =
  process.env.ROBYN_ENDURANCE_RELEASE_LINK ?? "/opt/robyn/testnet-current";
const releaseRoot = realpathSync(expectedReleaseLink);
if (!releaseRoot.startsWith("/opt/robyn/testnet-releases/")) {
  throw new Error("Endurance release must be immutable testnet release");
}
const releaseManifest = JSON.parse(
  readFileSync(join(releaseRoot, "testnet-release-manifest.json"), "utf8"),
);
const manifestPath = resolve(
  process.env.ROBYN_ENDURANCE_MANIFEST ??
    join(releaseRoot, "deployments", "46630-v4.json"),
);
const manifest = assertSecurityRemediationManifest(
  JSON.parse(readFileSync(manifestPath, "utf8")),
);
const rpcUrl = process.env.ROBYN_TESTNET_SERVER_RPC_URL;
if (!isApprovedTestnetRpcUrl(rpcUrl)) {
  throw new Error("Endurance RPC is not an approved Robinhood Testnet endpoint");
}
const publicBase =
  process.env.ROBYN_ENDURANCE_PUBLIC_BASE ?? "https://testnet.sherwoodforest.trade";
const apiBase = `${publicBase}/api`;
const outputBase =
  process.env.ROBYN_ENDURANCE_OUTPUT_DIR ??
  "/var/lib/robyn/testnet-endurance";
const outputDir = join(outputBase, runId);
const statePath = join(outputDir, "state.json");
const samplesPath = join(outputDir, "samples.jsonl");
const transactionsPath = join(outputDir, "transactions.jsonl");
const reviewsDir = join(outputDir, "reviews");
const checksumPath = join(outputDir, "SHA256SUMS");
const campaignDir = resolve(
  process.env.ROBYN_ENDURANCE_CAMPAIGN_STATE_DIR ?? "/nonexistent",
);
const campaignStatePath = join(campaignDir, "state.json");
const campaignRootPath = join(campaignDir, "encrypted-root.json");
const campaignPassphrasePath = resolve(
  process.env.ROBYN_ENDURANCE_CAMPAIGN_PASSPHRASE_FILE ?? "/nonexistent",
);
const operatorTokenPath = resolve(
  process.env.ROBYN_ENDURANCE_OPERATOR_TOKEN_FILE ?? "/nonexistent",
);
const durationSeconds = ENDURANCE_DURATION_SECONDS;
const sampleIntervalSeconds = ENDURANCE_SAMPLE_INTERVAL_SECONDS;
const writeIntervalSeconds = ENDURANCE_WRITE_INTERVAL_SECONDS;
const reviewIntervalSeconds = ENDURANCE_REVIEW_INTERVAL_SECONDS;

const chain = defineChain({
  id: 46630,
  name: "Robinhood Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  testnet: true,
});
const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl, {
    retryCount: 5,
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
function protectedText(path, label) {
  const details = statSync(path);
  if (!details.isFile() || (details.mode & 0o077) !== 0) {
    throw new Error(`${label} must be mode 0600 or stricter`);
  }
  return readFileSync(path, "utf8").trim();
}
function dependencyArtifactAbi(...parts) {
  return JSON.parse(
    readFileSync(join(releaseRoot, "node_modules", ...parts), "utf8"),
  ).abi;
}
function artifactAbi(contract) {
  return JSON.parse(
    readFileSync(
      join(
        releaseRoot,
        "packages",
        "contracts",
        "out",
        `${contract}.sol`,
        `${contract}.json`,
      ),
      "utf8",
    ),
  ).abi;
}
function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

mkdirSync(outputDir, { recursive: true, mode: 0o700 });
mkdirSync(reviewsDir, { recursive: true, mode: 0o700 });
const campaignState = JSON.parse(readFileSync(campaignStatePath, "utf8"));
if (campaignState.walletCount !== 100) {
  throw new Error("Endurance requires the encrypted 100-wallet campaign root");
}
const campaignPassphrase = protectedText(
  campaignPassphrasePath,
  "Campaign passphrase",
);
const campaignRoot = decryptCampaignRoot(
  JSON.parse(readFileSync(campaignRootPath, "utf8")),
  campaignPassphrase,
);
const derived = deriveCampaignAccounts(
  campaignRoot,
  campaignState.campaignId,
  100,
);
const accounts = derived.map(({ privateKey }) =>
  privateKeyToAccount(privateKey),
);
const operatorToken = protectedText(operatorTokenPath, "Operator token");

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
  if (account.address.toLowerCase() !== manifest.deployer.toLowerCase()) {
    throw new Error("Project keystore does not match the active deployment deployer");
  }
  return account;
}
const project = projectAccount();

let state;
try {
  state = JSON.parse(readFileSync(statePath, "utf8"));
  state = reconcileReleaseIdentity(state, {
    runId,
    releaseSha: releaseManifest.gitSha,
    deploymentManifestSha256: sha256File(manifestPath),
    migratedAt: new Date().toISOString(),
  });
  atomicWrite(statePath, state);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  state = {
    schemaVersion: 2,
    runId,
    mode: "uninterrupted",
    observationPeriodSeconds: ENDURANCE_DURATION_SECONDS,
    targetSeconds: ENDURANCE_DURATION_SECONDS,
    targetHealthySeconds: ENDURANCE_DURATION_SECONDS,
    remainingHealthySeconds: ENDURANCE_DURATION_SECONDS,
    requiredRewardAssets: manifest.assetRoutes.map((route) => route.address),
    releaseSha: releaseManifest.gitSha,
    deploymentGitCommit: manifest.gitCommit,
    deploymentManifestSha256: sha256File(manifestPath),
    startedAt: new Date().toISOString(),
    healthySeconds: 0,
    sampleCount: 0,
    writeCycleCount: 0,
    reviewCount: 0,
    completed: false,
    failed: false,
    paused: false,
    segments: [{ index: 1, startedAt: new Date().toISOString() }],
    transactions: [],
    submittedTransactions: {},
    enduranceLaunches: [],
    degradations: [],
    failures: [],
    governance: {},
  };
  atomicWrite(statePath, state);
  writeFileSync(samplesPath, "", { flag: "wx", mode: 0o600 });
  writeFileSync(transactionsPath, "", { flag: "wx", mode: 0o600 });
}

function saveState() {
  state.updatedAt = new Date().toISOString();
  state.targetSeconds = durationSeconds;
  state.remainingSeconds = Math.max(0, durationSeconds - state.healthySeconds);
  state.targetHealthySeconds = durationSeconds;
  state.remainingHealthySeconds = state.remainingSeconds;
  state.mode = "uninterrupted";
  const coveredAssets = new Set(
    state.enduranceLaunches.flatMap((launch) => launch.assets ?? []).map((asset) => asset.toLowerCase()),
  );
  state.coverage = {
    requiredRewardAssetCount: 24,
    coveredRewardAssetCount: coveredAssets.size,
    launchCount: state.enduranceLaunches.length,
    graduatedLaunchCount: state.transactions.filter((entry) => entry.label.startsWith("endurance-graduate-")).length,
    pendingRequirements: enduranceCoverageFailures(state),
  };
  const status = state.lastSample?.status;
  state.rpcCu = status
    ? {
        indexerEstimatedCu: status.indexerEstimatedCu ?? null,
        keeperEstimatedCu: status.keeperEstimatedCu ?? null,
        keeperProjectedDailyIdleCu: status.keeperProjectedDailyIdleCu ?? null,
        keeperProjectedMonthlyCu: status.keeperProjectedMonthlyCu ?? null,
        protocolEstimatedCu: status.protocol?.estimatedCu ?? null,
        protocolProjectedDailyCu: status.protocol?.projectedDailyCu ?? null,
        protocolProjectedMonthlyCu: status.protocol?.projectedMonthlyCu ?? null,
      }
    : null;
  atomicWrite(statePath, state);
}
function append(path, entry) {
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

async function rpcRetry(label, action) {
  const began = Date.now();
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      const result = await action();
      if (attempt > 1) {
        state.degradations.push({
          label,
          attempts: attempt,
          durationMs: Date.now() - began,
          recoveredAt: new Date().toISOString(),
        });
        state.degradations = state.degradations.slice(-200);
        saveState();
      }
      return result;
    } catch (error) {
      if (
        !isRetryablePublicRpcError(error) ||
        Date.now() - began >= 120_000
      ) {
        throw error;
      }
      await sleep(Math.min(15_000, 500 * 2 ** Math.min(attempt - 1, 5)));
    }
  }
}

async function receiptFor(hash) {
  return rpcRetry(`receipt-${hash}`, async () => {
    try {
      return await publicClient.getTransactionReceipt({ hash });
    } catch (error) {
      if (/not found|could not be found/i.test(String(error))) {
        throw new Error(`temporarily missing receipt ${hash}`);
      }
      throw error;
    }
  });
}

async function recordTransaction(label, account, request) {
  const confirmed = state.transactions.find((entry) => entry.label === label);
  if (confirmed) return confirmed;
  let hash = state.submittedTransactions[label]?.hash;
  if (!hash) {
    const estimated = await rpcRetry(`estimate-${label}`, () =>
      publicClient.estimateGas({ ...request, account }),
    );
    hash = await writer(account).sendTransaction({
      ...request,
      account,
      gas: applyHeadroom(estimated),
    });
    state.submittedTransactions[label] = {
      hash,
      submittedAt: new Date().toISOString(),
      from: account.address,
      to: request.to,
    };
    saveState();
  }
  const receipt = await receiptFor(hash);
  if (receipt.status !== "success") {
    throw new Error(`Endurance transaction reverted: ${label} ${hash}`);
  }
  const entry = {
    label,
    hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    confirmedAt: new Date().toISOString(),
  };
  state.transactions.push(entry);
  delete state.submittedTransactions[label];
  append(transactionsPath, entry);
  saveState();
  return entry;
}

async function contractTransaction(
  label,
  account,
  address,
  abi,
  functionName,
  args = [],
  value,
) {
  return recordTransaction(label, account, {
    to: address,
    data: encodeFunctionData({ abi, functionName, args }),
    ...(value === undefined ? {} : { value }),
  });
}

async function recordExpectedFailure(label, account, request, expectedReason) {
  if (state.transactions.some((entry) => entry.label === label)) return;
  try {
    await publicClient.call({ ...request, account: account.address });
  } catch (error) {
    const reason = String(
      error?.shortMessage ?? error?.message ?? error,
    ).slice(0, 500);
    if (expectedReason && !expectedReason.test(reason)) {
      throw new Error(
        `Expected ${label} to fail for ${expectedReason}, received: ${reason}`,
      );
    }
    const entry = {
      label,
      expectedFailure: true,
      observedAt: new Date().toISOString(),
      reason,
    };
    state.transactions.push(entry);
    state.expectedFailures ??= [];
    state.expectedFailures.push(entry);
    append(transactionsPath, entry);
    saveState();
    return;
  }
  throw new Error(`Expected failure unexpectedly succeeded: ${label}`);
}

async function apiJson(pathname, init = {}) {
  return rpcRetry(`api-${pathname}`, async () => {
    const response = await fetch(`${apiBase}${pathname}`, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        `API ${response.status} ${pathname}: ${body.error ?? "request_failed"}`,
      );
      if (response.status >= 500 || response.status === 429) {
        error.message = `temporary ${error.message}`;
      }
      throw error;
    }
    return { body, response };
  });
}

async function creatorSession(account) {
  const headers = {
    "content-type": "application/json",
    origin: publicBase,
  };
  const nonce = await apiJson("/auth/nonce", {
    method: "POST",
    headers,
    body: JSON.stringify({ address: account.address }),
  });
  const message = nonce.body.data.message;
  const signature = await account.signMessage({ message });
  const verified = await apiJson("/auth/verify", {
    method: "POST",
    headers,
    body: JSON.stringify({ message, signature }),
  });
  const cookie = verified.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("SIWE verification did not set a session cookie");
  return { cookie };
}

async function prepareMetadata(account, index) {
  const session = await creatorSession(account);
  const artwork = readFileSync(
    join(
      releaseRoot,
      "apps",
      "web",
      "public",
      "assets",
      "launchpad",
      "token-fallback.webp",
    ),
  );
  const media = await apiJson("/media?purpose=token", {
    method: "POST",
    headers: {
      "content-type": "image/webp",
      origin: publicBase,
      cookie: session.cookie,
    },
    body: artwork,
  });
  const name = `Sherwood Endurance ${index + 1}`;
  const symbol = `END${index + 1}`;
  const prepared = await apiJson("/launch-metadata/prepare", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: publicBase,
      cookie: session.cookie,
      "x-robyn-operator-token": operatorToken,
    },
    body: JSON.stringify({
      mediaId: media.body.data.media_id,
      name,
      symbol,
      description: `Automated two-hour schema-11 endurance launch ${index + 1}.`,
      campaignId: runId,
      releaseSha: releaseManifest.gitSha,
    }),
  });
  return {
    session,
    name,
    symbol,
    preparationId: prepared.body.data.preparation_id,
    metadataUri: prepared.body.data.metadata_uri,
    metadataCid: prepared.body.data.metadata_cid,
  };
}

async function waitForLaunchAndBind(token, metadata) {
  const began = Date.now();
  while (Date.now() - began < 300_000) {
    const response = await fetch(`${apiBase}/launches/${token}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      await apiJson(`/launches/${token}/metadata`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: publicBase,
          cookie: metadata.session.cookie,
        },
        body: JSON.stringify({
          preparationId: metadata.preparationId,
        }),
      });
      return;
    }
    await sleep(2_000);
  }
  throw new Error(`Indexer did not expose endurance token ${token}`);
}

const coordinatorAbi = artifactAbi("RobynV4LaunchCoordinatorV5");
const marketAbi = artifactAbi("RobynV4BondingCurveMarket");
const tokenAbi = artifactAbi("RobynLaunchToken");
const feeRouterAbi = artifactAbi("RobynNativeProtocolFeeRouterV4");
const daoAbi = artifactAbi("RobynDaoToken");
const governorAbi = artifactAbi("RobynTestnetGovernor");
const assetRouterAbi = artifactAbi("RobynV4AssetRouter");
const hookAbi = artifactAbi("RobynV4FeeAndPhaseHook");
const lockerAbi = artifactAbi("RobynV4FeePositionLocker");
const quoterAbi = dependencyArtifactAbi(
  "@uniswap",
  "v4-periphery",
  "foundry-out",
  "V4Quoter.sol",
  "V4Quoter.json",
);
const positionManagerAbi = dependencyArtifactAbi(
  "@uniswap",
  "v4-periphery",
  "foundry-out",
  "PositionManager.sol",
  "PositionManager.json",
);
const stateViewAbi = dependencyArtifactAbi(
  "@uniswap",
  "v4-periphery",
  "foundry-out",
  "StateView.sol",
  "StateView.json",
);
const universalRouterAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
];
const permit2Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
];

async function createEnduranceLaunch(index) {
  if (state.enduranceLaunches.some((launch) => launch.index === index)) return;
  const account = accounts[40 + index];
  const metadata = await prepareMetadata(account, index);
  const routes = manifest.assetRoutes.slice(index * 3, index * 3 + 3);
  const request = {
    name: metadata.name,
    symbol: metadata.symbol,
    assets: routes.map((route) => route.address),
    weights: [3334, 3333, 3333],
    metadataUri: metadata.metadataUri,
    userSalt: keccak256(
      stringToHex(
        `${derived[40 + index].privateKey}:${runId}:${releaseManifest.gitSha}:${index}`,
      ),
    ),
  };
  const transaction = await contractTransaction(
    `endurance-launch-${index}`,
    account,
    manifest.contracts.atomicLaunchCoordinator,
    coordinatorAbi,
    "createLaunch",
    [request],
  );
  const receipt = await receiptFor(transaction.hash);
  const decoded = receipt.logs
    .map((log) => {
      try {
        return decodeEventLog({
          abi: coordinatorAbi,
          eventName: "AtomicV4LaunchCreated",
          data: log.data,
          topics: log.topics,
        });
      } catch {
        return null;
      }
    })
    .find(Boolean);
  if (!decoded) throw new Error(`Missing launch receipt for endurance ${index}`);
  const created = {
    index,
    creator: account.address,
    token: decoded.args.token,
    vault: decoded.args.receipt.vault,
    market: decoded.args.receipt.market,
    adapter: decoded.args.receipt.adapter,
    locker: decoded.args.receipt.locker,
    poolId: decoded.args.receipt.poolId,
    transactionHash: transaction.hash,
    metadataCid: metadata.metadataCid,
    metadataUri: metadata.metadataUri,
    assets: request.assets,
    shouldGraduate: index < 3,
  };
  state.enduranceLaunches.push(created);
  saveState();
  await waitForLaunchAndBind(created.token, metadata);
  if (index === 0) {
    await contractTransaction(
      `endurance-creator-split-open-${created.token}`,
      account,
      manifest.contracts.protocolFeeRouter,
      feeRouterAbi,
      "setCreatorFeeSplit",
      [created.token, [account.address, accounts[60].address], [7000, 3000], false],
    );
  } else if (index === 1) {
    await contractTransaction(
      `endurance-creator-split-lock-${created.token}`,
      account,
      manifest.contracts.protocolFeeRouter,
      feeRouterAbi,
      "setCreatorFeeSplit",
      [created.token, [account.address, accounts[61].address], [5000, 5000], true],
    );
  }
}

async function fundingPreflight() {
  const targetByIndex = new Map();
  for (let index = 0; index < 20; index += 1) {
    targetByIndex.set(index, 100_000_000_000_000n);
  }
  for (let index = 40; index < 48; index += 1) {
    targetByIndex.set(index, 500_000_000_000_000n);
  }
  targetByIndex.set(96, 700_000_000_000_000n);
  targetByIndex.set(97, 700_000_000_000_000n);
  targetByIndex.set(98, 700_000_000_000_000n);
  targetByIndex.set(99, 500_000_000_000_000n);
  targetByIndex.set(99, 500_000_000_000_000n);
  targetByIndex.set(98, 700_000_000_000_000n);
  const balances = await Promise.all(
    [...targetByIndex.keys()].map((index) =>
      publicClient.getBalance({ address: accounts[index].address }),
    ),
  );
  const shortfalls = [...targetByIndex.entries()].map(
    ([index, target], offset) => ({
      index,
      amount: balances[offset] >= target ? 0n : target - balances[offset],
    }),
  );
  const actorFundingWei = shortfalls.reduce(
    (total, entry) => total + entry.amount,
    0n,
  );
  const workloadValueWei = 2_500_000_000_000_000n;
  const projectBalanceWei = await publicClient.getBalance({
    address: project.address,
  });
  const requiredWei =
    actorFundingWei + workloadValueWei + ENDURANCE_RESERVE_WEI;
  return {
    projectAddress: project.address,
    projectBalanceWei,
    actorFundingWei,
    workloadValueWei,
    reserveWei: ENDURANCE_RESERVE_WEI,
    requiredWei,
    surplusWei: projectBalanceWei - requiredWei,
    sufficient: projectBalanceWei >= requiredWei,
    shortfalls: shortfalls.filter(({ amount }) => amount > 0n),
  };
}
async function ensureFunding() {
  if (state.funding?.completedAt) return;
  const targetByIndex = new Map();
  for (let index = 0; index < 20; index += 1) {
    targetByIndex.set(index, 100_000_000_000_000n);
  }
  for (let index = 40; index < 48; index += 1) {
    targetByIndex.set(index, 500_000_000_000_000n);
  }
  targetByIndex.set(96, 700_000_000_000_000n);
  targetByIndex.set(97, 700_000_000_000_000n);
  const balances = await Promise.all(
    [...targetByIndex.keys()].map((index) =>
      publicClient.getBalance({ address: accounts[index].address }),
    ),
  );
  const shortfalls = [...targetByIndex.entries()].map(
    ([index, target], offset) => ({
      index,
      amount: balances[offset] >= target ? 0n : target - balances[offset],
    }),
  );
  const required = shortfalls.reduce(
    (total, entry) => total + entry.amount,
    0n,
  );
  const projectBalance = await publicClient.getBalance({
    address: project.address,
  });
  const workloadValue = 2_500_000_000_000_000n;
  if (projectBalance < required + workloadValue + ENDURANCE_RESERVE_WEI) {
    throw new Error(
      `Endurance funding preflight failed: ${projectBalance} wei available`,
    );
  }
  for (const entry of shortfalls) {
    if (entry.amount === 0n) continue;
    await recordTransaction(`endurance-fund-${entry.index}`, project, {
      to: accounts[entry.index].address,
      value: entry.amount,
    });
  }
  const allocations = [
    [0, 120_000_000n * 10n ** 18n],
    [1, 20_000_000n * 10n ** 18n],
    [2, 20_000_000n * 10n ** 18n],
  ];
  for (const [index, amount] of allocations) {
    const balance = await publicClient.readContract({
      address: manifest.contracts.daoToken,
      abi: daoAbi,
      functionName: "balanceOf",
      args: [accounts[index].address],
    });
    if (balance < amount) {
      await contractTransaction(
        `endurance-rdao-fund-${index}`,
        project,
        manifest.contracts.daoToken,
        daoAbi,
        "transfer",
        [accounts[index].address, amount - balance],
      );
    }
    await contractTransaction(
      `endurance-delegate-${index}`,
      accounts[index],
      manifest.contracts.daoToken,
      daoAbi,
      "delegate",
      [accounts[index].address],
    );
  }
  state.funding = {
    completedAt: new Date().toISOString(),
    requiredWei: required.toString(),
    projectBalanceBeforeWei: projectBalance.toString(),
  };
  saveState();
}

function activeLaunches() {
  return [...state.enduranceLaunches];
}

async function maybeGraduate() {
  for (
    let index = 0;
    index < Math.min(3, state.enduranceLaunches.length);
    index += 1
  ) {
    const launch = state.enduranceLaunches[index];
    const threshold = ENDURANCE_GRADUATION_THRESHOLDS_SECONDS[index];
    if (state.healthySeconds < threshold) continue;
    const graduated = await publicClient.readContract({
      address: launch.market,
      abi: marketAbi,
      functionName: "graduated",
    });
    if (graduated) continue;
    const account = accounts[96 + index];
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const [
        realCurveTokenReserve,
        virtualTokenReserve,
        virtualNativeReserve,
        feeBps,
        maximumCurvePurchase,
      ] = await Promise.all([
        publicClient.readContract({
          address: launch.market,
          abi: marketAbi,
          functionName: "realCurveTokenReserve",
        }),
        publicClient.readContract({
          address: launch.market,
          abi: marketAbi,
          functionName: "virtualTokenReserve",
        }),
        publicClient.readContract({
          address: launch.market,
          abi: marketAbi,
          functionName: "virtualNativeReserve",
        }),
        publicClient.readContract({
          address: launch.market,
          abi: marketAbi,
          functionName: "feeBps",
        }),
        publicClient.readContract({
          address: launch.market,
          abi: marketAbi,
          functionName: "maximumCurvePurchase",
        }),
      ]);
      const value = boundedTerminalCurveBuyValue({
        realCurveTokenReserve,
        virtualTokenReserve,
        virtualNativeReserve,
        feeBps: BigInt(feeBps),
        maximumCurvePurchase,
      });
      const [, output] = await publicClient.readContract({
        address: launch.market,
        abi: marketAbi,
        functionName: "quoteBuy",
        args: [value],
        account: account.address,
      });
      const buyRequest = {
        to: launch.market,
        data: encodeFunctionData({
          abi: marketAbi,
          functionName: "buy",
          args: [(output * 98n) / 100n || 1n],
        }),
        value,
      };
      const estimatedGas = await rpcRetry(
        `estimate graduation ${index}`,
        () =>
          publicClient.estimateGas({
            ...buyRequest,
            account: project.address,
          }),
      );
      const estimatedFees = await rpcRetry(
        `estimate graduation fees ${index}`,
        () => publicClient.estimateFeesPerGas(),
      );
      const maxFeePerGas =
        estimatedFees.maxFeePerGas ??
        estimatedFees.gasPrice ??
        (await rpcRetry("read public gas price", () =>
          publicClient.getGasPrice(),
        ));
      const fundingTarget = transactionFundingTarget({
        valueWei: value,
        estimatedGas,
        maxFeePerGas,
        additionalFeeReserveWei: ENDURANCE_L1_DATA_FEE_RESERVE_WEI,
      });
      const buyerBalance = await publicClient.getBalance({
        address: account.address,
      });
      if (buyerBalance < fundingTarget) {
        const funding = fundingTarget - buyerBalance;
        const projectBalance = await publicClient.getBalance({
          address: project.address,
        });
        if (projectBalance < funding + ENDURANCE_RESERVE_WEI) {
          throw new Error(
            `Endurance graduation ${index} would breach the reserve`,
          );
        }
        await recordTransaction(
          `endurance-graduate-fund-${index}-${realCurveTokenReserve}-${fundingTarget}`,
          project,
          {
            to: account.address,
            value: funding,
          },
        );
      }
      await recordTransaction(
        `endurance-graduate-${index}-${realCurveTokenReserve}`,
        account,
        buyRequest,
      );
      const after = await publicClient.readContract({
        address: launch.market,
        abi: marketAbi,
        functionName: "graduated",
      });
      if (after) break;
      if (attempt === 15) {
        throw new Error(
          `Endurance launch ${index} did not graduate after bounded top-ups`,
        );
      }
    }
  }
}

async function claimEligible(account, launch, cycle) {
  let holderClaimable = 0n;
  const rewardCount = Number(
    await publicClient.readContract({
      address: launch.token,
      abi: tokenAbi,
      functionName: "rewardAssetCount",
    }),
  );
  for (const index of rewardClaimIndexes(rewardCount)) {
    holderClaimable += await publicClient.readContract({
      address: launch.token,
      abi: tokenAbi,
      functionName: "withdrawableRewardOf",
      args: [account.address, index],
    });
  }
  if (holderClaimable > 0n) {
    await contractTransaction(
      `endurance-holder-claim-${cycle}`,
      account,
      launch.token,
      tokenAbi,
      "claimAll",
    );
  }
  const creatorIndex = accounts.findIndex(
    (candidate) =>
      candidate.address.toLowerCase() === launch.creator.toLowerCase(),
  );
  if (creatorIndex >= 0) {
    const creatorClaimable = await publicClient.readContract({
      address: manifest.contracts.protocolFeeRouter,
      abi: feeRouterAbi,
      functionName: "claimableCreatorNativeByRecipient",
      args: [launch.token, accounts[creatorIndex].address],
    });
    if (creatorClaimable > 0n) {
      await contractTransaction(
        `endurance-creator-claim-${launch.token}-${cycle}`,
        accounts[creatorIndex],
        manifest.contracts.protocolFeeRouter,
        feeRouterAbi,
        "claimCreatorFees",
        [launch.token],
      );
    }
  }
  const daoClaimable = await publicClient.readContract({
    address: manifest.contracts.daoToken,
    abi: daoAbi,
    functionName: "claimableRewardOf",
    args: [accounts[0].address],
  });
  if (daoClaimable > 0n) {
    await contractTransaction(
      `endurance-rdao-claim-${cycle}`,
      accounts[0],
      manifest.contracts.daoToken,
      daoAbi,
      "claimRewards",
    );
  }
}

async function maintainGraduatedFees(account, launch, cycle) {
  if (cycle % 6 !== 0) return;
  state.feeMaintenance ??= { completed: [], deferred: [] };
  await contractTransaction(
    `endurance-lp-harvest-${launch.token}-${cycle}`,
    account,
    launch.locker,
    lockerAbi,
    "collectFees",
    V4_FEE_COLLECTION_MINIMUMS,
  );

  const pendingNative = await publicClient.readContract({
    address: manifest.contracts.oracleHook,
    abi: hookAbi,
    functionName: "pendingNativeFees",
    args: [launch.token],
  });
  if (pendingNative > 0n) {
    await contractTransaction(
      `endurance-hook-native-${launch.token}-${cycle}`,
      account,
      manifest.contracts.oracleHook,
      hookAbi,
      "settleNativeFees",
      [launch.token, pendingNative],
    );
  }

  const pendingToken = await publicClient.readContract({
    address: manifest.contracts.oracleHook,
    abi: hookAbi,
    functionName: "pendingTokenFees",
    args: [launch.token],
  });
  let convertedToken = 0n;
  if (pendingToken > 0n) {
    convertedToken =
      pendingToken > (1n << 128n) - 1n ? (1n << 128n) - 1n : pendingToken;
    const deadline = BigInt(Math.floor(Date.now() / 1_000) + 600);
    let minimumOutput = 0n;
    let ready = false;
    for (let attempt = 0; attempt < 12 && convertedToken > 0n; attempt += 1) {
      try {
        const [quoted] = await publicClient.readContract({
          address: manifest.contracts.assetRouter,
          abi: assetRouterAbi,
          functionName: "quoteAssetToNative",
          args: [launch.token, convertedToken],
        });
        minimumOutput = (quoted * 99n) / 100n || 1n;
        await publicClient.call({
          account: account.address,
          to: manifest.contracts.oracleHook,
          data: encodeFunctionData({
            abi: hookAbi,
            functionName: "convertTokenFees",
            args: [launch.token, convertedToken, minimumOutput, deadline],
          }),
        });
        ready = true;
        break;
      } catch (error) {
        convertedToken /= 2n;
        if (attempt === 11 || convertedToken === 0n) {
          state.feeMaintenance.deferred.push({
            cycle,
            token: launch.token,
            reason: String(
              error?.shortMessage ?? error?.message ?? error,
            ).slice(0, 500),
          });
          state.feeMaintenance.deferred =
            state.feeMaintenance.deferred.slice(-100);
          saveState();
        }
      }
    }
    if (ready) {
      await contractTransaction(
        `endurance-hook-token-${launch.token}-${cycle}`,
        account,
        manifest.contracts.oracleHook,
        hookAbi,
        "convertTokenFees",
        [launch.token, convertedToken, minimumOutput, deadline],
      );
    } else {
      convertedToken = 0n;
    }
  }

  const generatedNative = await publicClient.readContract({
    address: manifest.contracts.oracleHook,
    abi: hookAbi,
    functionName: "pendingNativeFees",
    args: [launch.token],
  });
  if (generatedNative > 0n) {
    await contractTransaction(
      `endurance-hook-native-followup-${launch.token}-${cycle}`,
      account,
      manifest.contracts.oracleHook,
      hookAbi,
      "settleNativeFees",
      [launch.token, generatedNative],
    );
  }
  state.feeMaintenance.completed.push({
    cycle,
    token: launch.token,
    nativeSettled: pendingNative.toString(),
    tokenConverted: convertedToken.toString(),
    generatedNativeSettled: generatedNative.toString(),
  });
  saveState();
}

async function runGraduatedTrade(account, launch, cycle, value) {
  const [quoted] = await publicClient.readContract({
    address: manifest.contracts.assetRouter,
    abi: assetRouterAbi,
    functionName: "quoteNativeToAsset",
    args: [launch.token, value],
    account: account.address,
  });
  await contractTransaction(
    `endurance-v4-buy-${cycle}`,
    account,
    manifest.contracts.assetRouter,
    assetRouterAbi,
    "swapExactNativeForAsset",
    [
      launch.token,
      (quoted * 98n) / 100n || 1n,
      account.address,
      BigInt(Math.floor(Date.now() / 1_000) + 600),
    ],
    value,
  );
  const balance = await publicClient.readContract({
    address: launch.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (cycle % 2 === 0 && balance > 100n) {
    await contractTransaction(
      `endurance-v4-transfer-${cycle}`,
      account,
      launch.token,
      tokenAbi,
      "transfer",
      [accounts[(cycle + 1) % 20].address, balance / 100n],
    );
  }
  if (cycle % 3 === 0 && balance > 1_000n) {
    const amount = balance / 200n;
    await contractTransaction(
      `endurance-v4-approve-${cycle}`,
      account,
      launch.token,
      tokenAbi,
      "approve",
      [manifest.contracts.assetRouter, amount],
    );
    const [nativeOutput] = await publicClient.readContract({
      address: manifest.contracts.assetRouter,
      abi: assetRouterAbi,
      functionName: "quoteAssetToNative",
      args: [launch.token, amount],
      account: account.address,
    });
    await contractTransaction(
      `endurance-v4-sell-${cycle}`,
      account,
      manifest.contracts.assetRouter,
      assetRouterAbi,
      "swapExactAssetForNative",
      [
        launch.token,
        amount,
        (nativeOutput * 98n) / 100n || 1n,
        account.address,
        BigInt(Math.floor(Date.now() / 1_000) + 600),
      ],
    );
  }
  await maintainGraduatedFees(account, launch, cycle);
}

async function runWriteCycle(cycle) {
  const launches = activeLaunches();
  const eligible = state.streamProbe && launches.length > 1 ? launches.slice(1) : launches;
  const launch = eligible[cycle % eligible.length];
  const account = accounts[cycle % 20];
  const value = 10_000_000_000_000n;
  const graduated = await publicClient.readContract({
    address: launch.market,
    abi: marketAbi,
    functionName: "graduated",
  });
  if (graduated) {
    await runGraduatedTrade(account, launch, cycle, value);
    await claimEligible(account, launch, cycle);
    state.writeCycleCount = cycle + 1;
    saveState();
    return;
  }
  const [, output] = await publicClient.readContract({
    address: launch.market,
    abi: marketAbi,
    functionName: "quoteBuy",
    args: [value],
    account: account.address,
  });
  await contractTransaction(
    `endurance-buy-${cycle}`,
    account,
    launch.market,
    marketAbi,
    "buy",
    [(output * 98n) / 100n || 1n],
    value,
  );
  const balance = await publicClient.readContract({
    address: launch.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (cycle % 2 === 0 && balance > 100n) {
    await contractTransaction(
      `endurance-transfer-${cycle}`,
      account,
      launch.token,
      tokenAbi,
      "transfer",
      [accounts[(cycle + 1) % 20].address, balance / 100n],
    );
  }
  if (cycle % 3 === 0 && balance > 1_000n) {
    const amount = balance / 200n;
    await contractTransaction(
      `endurance-approve-${cycle}`,
      account,
      launch.token,
      tokenAbi,
      "approve",
      [launch.market, amount],
    );
    const [, nativeOutput] = await publicClient.readContract({
      address: launch.market,
      abi: marketAbi,
      functionName: "quoteSell",
      args: [amount],
      account: account.address,
    });
    await contractTransaction(
      `endurance-sell-${cycle}`,
      account,
      launch.market,
      marketAbi,
      "sell",
      [amount, (nativeOutput * 98n) / 100n || 1n],
    );
  }
  await claimEligible(account, launch, cycle);
  state.writeCycleCount = cycle + 1;
  saveState();
}

function endurancePoolKey(launch) {
  return {
    currency0: "0x0000000000000000000000000000000000000000",
    currency1: launch.token,
    fee: manifest.market.poolFeePips,
    tickSpacing: manifest.market.tickSpacing,
    hooks: manifest.contracts.oracleHook,
  };
}

async function maybePreGraduationCoverage() {
  if (state.preGraduationCoverageComplete) return;
  const launch = state.enduranceLaunches[0];
  if (!launch || state.healthySeconds >= ENDURANCE_GRADUATION_THRESHOLDS_SECONDS[0]) return;
  const account = accounts[0];
  const tokenBalance = await publicClient.readContract({
    address: launch.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (tokenBalance === 0n) return;
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + 600);
  await recordExpectedFailure(
    `endurance-pregraduation-swap-rejected-${launch.token}`,
    account,
    {
      to: manifest.contracts.assetRouter,
      value: 100_000_000n,
      data: encodeFunctionData({
        abi: assetRouterAbi,
        functionName: "swapExactNativeForAsset",
        args: [launch.token, 1n, account.address, deadline],
      }),
    },
    /InvalidPhase|PoolNotTrading|bonding|98d23bb0|Execution reverted/i,
  );
  const amount1Max = tokenBalance / 1_000n || 1n;
  const liquidityPlan = encodeV4MintPosition({
    poolKey: endurancePoolKey(launch),
    tickLower: -887_200,
    tickUpper: 887_200,
    liquidity: 1n,
    amount0Max: 1_000_000n,
    amount1Max,
    owner: account.address,
  });
  await recordExpectedFailure(
    `endurance-pregraduation-liquidity-rejected-${launch.token}`,
    account,
    {
      to: manifest.contracts.positionManager,
      value: 1_000_000n,
      data: encodeFunctionData({
        abi: positionManagerAbi,
        functionName: "modifyLiquidities",
        args: [liquidityPlan, deadline],
      }),
    },
    /InvalidPhase|PoolNotTrading|bonding|98d23bb0|Execution reverted/i,
  );
  const donation = encodeUniversalV4Donation({
    poolKey: endurancePoolKey(launch),
    amount0: 1_000_000n,
    amount1: 0n,
  });
  await recordExpectedFailure(
    `endurance-pregraduation-donation-rejected-${launch.token}`,
    account,
    {
      to: manifest.contracts.universalRouter,
      value: 1_000_000n,
      data: encodeFunctionData({
        abi: universalRouterAbi,
        functionName: "execute",
        args: [donation.commands, donation.inputs, deadline],
      }),
    },
    /InvalidPhase|PoolNotTrading|bonding|98d23bb0|Execution reverted/i,
  );
  state.preGraduationCoverageComplete = true;
  saveState();
}

async function executeUniversalCoverage(launch) {
  state.advancedCoverage ??= {};
  if (state.advancedCoverage.universalComplete) return;
  const account = accounts[99];
  const poolKey = endurancePoolKey(launch);
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + 600);
  const execute = async ({ label, zeroForOne, exactOutput, amount, limit, value }) => {
    const plan = encodeUniversalV4SingleSwap({
      poolKey,
      zeroForOne,
      exactOutput,
      amount,
      limit,
      refundRecipient: account.address,
    });
    await contractTransaction(
      label,
      account,
      manifest.contracts.universalRouter,
      universalRouterAbi,
      "execute",
      [plan.commands, plan.inputs, deadline],
      value,
    );
  };
  const nativeInput = 100_000_000_000n;
  const [tokenOutput] = await publicClient.readContract({
    address: manifest.contracts.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey, zeroForOne: true, exactAmount: nativeInput, hookData: "0x" }],
  });
  await execute({
    label: `endurance-universal-exact-in-buy-${launch.token}`,
    zeroForOne: true,
    exactOutput: false,
    amount: nativeInput,
    limit: (tokenOutput * 98n) / 100n || 1n,
    value: nativeInput,
  });
  await contractTransaction(
    `endurance-universal-token-approve-${launch.token}`,
    account,
    launch.token,
    tokenAbi,
    "approve",
    [manifest.contracts.permit2, (1n << 256n) - 1n],
  );
  await contractTransaction(
    `endurance-universal-permit2-approve-${launch.token}`,
    account,
    manifest.contracts.permit2,
    permit2Abi,
    "approve",
    [
      launch.token,
      manifest.contracts.universalRouter,
      (1n << 160n) - 1n,
      BigInt(Math.floor(Date.now() / 1_000) + 86_400),
    ],
  );
  const balance = await publicClient.readContract({
    address: launch.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [account.address],
  });
  const tokenInput = balance / 8n;
  const [nativeOutput] = await publicClient.readContract({
    address: manifest.contracts.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey, zeroForOne: false, exactAmount: tokenInput, hookData: "0x" }],
  });
  await execute({
    label: `endurance-universal-exact-in-sell-${launch.token}`,
    zeroForOne: false,
    exactOutput: false,
    amount: tokenInput,
    limit: (nativeOutput * 98n) / 100n || 1n,
  });
  const exactTokenOutput = 10n ** 18n;
  const [maximumNativeQuote] = await publicClient.readContract({
    address: manifest.contracts.quoter,
    abi: quoterAbi,
    functionName: "quoteExactOutputSingle",
    args: [{ poolKey, zeroForOne: true, exactAmount: exactTokenOutput, hookData: "0x" }],
  });
  const maximumNativeInput = (maximumNativeQuote * 102n) / 100n + 1n;
  await execute({
    label: `endurance-universal-exact-out-buy-${launch.token}`,
    zeroForOne: true,
    exactOutput: true,
    amount: exactTokenOutput,
    limit: maximumNativeInput,
    value: maximumNativeInput,
  });
  const exactNativeOutput = 10_000_000n;
  const [maximumTokenQuote] = await publicClient.readContract({
    address: manifest.contracts.quoter,
    abi: quoterAbi,
    functionName: "quoteExactOutputSingle",
    args: [{ poolKey, zeroForOne: false, exactAmount: exactNativeOutput, hookData: "0x" }],
  });
  await execute({
    label: `endurance-universal-exact-out-sell-${launch.token}`,
    zeroForOne: false,
    exactOutput: true,
    amount: exactNativeOutput,
    limit: (maximumTokenQuote * 102n) / 100n + 1n,
  });
  state.advancedCoverage.universalComplete = true;
  saveState();
}

async function addExternalLiquidity(launch, positionIndex) {
  state.advancedCoverage ??= {};
  state.advancedCoverage.externalLiquidity ??= [];
  if (state.advancedCoverage.externalLiquidity.some((entry) => entry.positionIndex === positionIndex)) return;
  const account = accounts[96 + positionIndex];
  const poolKey = endurancePoolKey(launch);
  const lockedTokenId = await publicClient.readContract({
    address: launch.locker,
    abi: lockerAbi,
    functionName: "positionTokenId",
  });
  const lockedLiquidity = await publicClient.readContract({
    address: manifest.contracts.positionManager,
    abi: positionManagerAbi,
    functionName: "getPositionLiquidity",
    args: [lockedTokenId],
  });
  const [, currentTick] = await publicClient.readContract({
    address: manifest.contracts.stateView,
    abi: stateViewAbi,
    functionName: "getSlot0",
    args: [launch.poolId],
  });
  const ticks = positionIndex === 0
    ? { tickLower: -887_200, tickUpper: 887_200 }
    : alignedConcentratedTicks(currentTick, manifest.market.tickSpacing);
  const tokenBalance = await publicClient.readContract({
    address: launch.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [account.address],
  });
  const amount0Max = 20_000_000_000n;
  const amount1Max = tokenBalance / 4n;
  let liquidity = lockedLiquidity / 100n;
  if (liquidity === 0n || amount1Max === 0n) throw new Error("External liquidity has no capacity");
  await contractTransaction(
    `endurance-external-token-approve-${positionIndex}-${launch.token}`,
    account,
    launch.token,
    tokenAbi,
    "approve",
    [manifest.contracts.permit2, (1n << 256n) - 1n],
  );
  await contractTransaction(
    `endurance-external-permit2-approve-${positionIndex}-${launch.token}`,
    account,
    manifest.contracts.permit2,
    permit2Abi,
    "approve",
    [
      launch.token,
      manifest.contracts.positionManager,
      (1n << 160n) - 1n,
      BigInt(Math.floor(Date.now() / 1_000) + 86_400),
    ],
  );
  let calldata;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    calldata = encodeV4MintPosition({
      poolKey,
      ...ticks,
      liquidity,
      amount0Max,
      amount1Max,
      owner: account.address,
    });
    try {
      await publicClient.call({
        account: account.address,
        to: manifest.contracts.positionManager,
        value: amount0Max,
        data: encodeFunctionData({
          abi: positionManagerAbi,
          functionName: "modifyLiquidities",
          args: [calldata, BigInt(Math.floor(Date.now() / 1_000) + 600)],
        }),
      });
      break;
    } catch (error) {
      if (liquidity <= 1n || attempt === 15) throw error;
      liquidity /= 2n;
    }
  }
  const nextTokenId = await publicClient.readContract({
    address: manifest.contracts.positionManager,
    abi: positionManagerAbi,
    functionName: "nextTokenId",
  });
  const kind = positionIndex === 0 ? "full" : "concentrated";
  const transaction = await contractTransaction(
    `endurance-external-liquidity-${kind}-${launch.token}`,
    account,
    manifest.contracts.positionManager,
    positionManagerAbi,
    "modifyLiquidities",
    [calldata, BigInt(Math.floor(Date.now() / 1_000) + 600)],
    amount0Max,
  );
  const minted = await publicClient.readContract({
    address: manifest.contracts.positionManager,
    abi: positionManagerAbi,
    functionName: "getPositionLiquidity",
    args: [nextTokenId],
  });
  if (minted !== liquidity) throw new Error("External liquidity mint mismatch");
  state.advancedCoverage.externalLiquidity.push({
    positionIndex,
    token: launch.token,
    tokenId: nextTokenId.toString(),
    liquidity: liquidity.toString(),
    lockedLiquidity: lockedLiquidity.toString(),
    transactionHash: transaction.hash,
  });
  saveState();
}

async function maybeCreatorSplitUpdate() {
  if (state.creatorSplitUpdated || state.healthySeconds < 45 * 60) return;
  const launch = state.enduranceLaunches[0];
  if (!launch) return;
  await contractTransaction(
    `endurance-creator-split-update-${launch.token}`,
    accounts[40],
    manifest.contracts.protocolFeeRouter,
    feeRouterAbi,
    "setCreatorFeeSplit",
    [launch.token, [accounts[40].address, accounts[60].address], [6000, 4000], false],
  );
  const locked = state.enduranceLaunches[1];
  if (locked) {
    await recordExpectedFailure(
      `endurance-creator-split-locked-rejected-${locked.token}`,
      accounts[41],
      {
        to: manifest.contracts.protocolFeeRouter,
        data: encodeFunctionData({
          abi: feeRouterAbi,
          functionName: "setCreatorFeeSplit",
          args: [locked.token, [accounts[41].address], [10000], false],
        }),
      },
    );
  }
  state.creatorSplitUpdated = true;
  saveState();
}

async function maybeCreatorClaimCoverage() {
  if (state.creatorClaimCoverageComplete || state.healthySeconds < 110 * 60) return;
  const [open, locked, direct] = state.enduranceLaunches;
  if (!open || !locked || !direct) return;
  const checks = await Promise.all([
    publicClient.readContract({ address: manifest.contracts.protocolFeeRouter, abi: feeRouterAbi, functionName: "claimableCreatorNativeByRecipient", args: [open.token, accounts[60].address] }),
    publicClient.readContract({ address: manifest.contracts.protocolFeeRouter, abi: feeRouterAbi, functionName: "claimableCreatorNativeByRecipient", args: [locked.token, accounts[61].address] }),
    publicClient.readContract({ address: manifest.contracts.protocolFeeRouter, abi: feeRouterAbi, functionName: "claimableCreatorNativeByRecipient", args: [direct.token, accounts[42].address] }),
  ]);
  if (checks.some((amount) => amount === 0n)) return;
  await contractTransaction(
    `endurance-creator-claim-to-${open.token}`,
    accounts[60],
    manifest.contracts.protocolFeeRouter,
    feeRouterAbi,
    "claimCreatorFeesTo",
    [open.token, accounts[62].address],
  );
  await contractTransaction(
    `endurance-creator-batch-claim-to-${locked.token}`,
    accounts[61],
    manifest.contracts.protocolFeeRouter,
    feeRouterAbi,
    "claimCreatorFeesBatchTo",
    [[locked.token], accounts[63].address],
  );
  await contractTransaction(
    `endurance-creator-batch-claim-${direct.token}`,
    accounts[42],
    manifest.contracts.protocolFeeRouter,
    feeRouterAbi,
    "claimCreatorFeesBatch",
    [[direct.token]],
  );
  state.creatorClaimCoverageComplete = true;
  saveState();
}

async function maybeStreamProbe() {
  const launch = state.enduranceLaunches[0];
  if (!launch || !state.advancedCoverage?.universalComplete) return;
  const holder = accounts[0];
  const creator = accounts[40];
  const dao = accounts[0];
  const rewardCount = Number(await publicClient.readContract({
    address: launch.token,
    abi: tokenAbi,
    functionName: "rewardAssetCount",
  }));
  const holderAmounts = await Promise.all(
    rewardClaimIndexes(rewardCount).map((index) =>
      publicClient.readContract({
        address: launch.token,
        abi: tokenAbi,
        functionName: "withdrawableRewardOf",
        args: [holder.address, index],
      }),
    ),
  );
  const holderClaimable = holderAmounts.reduce((total, amount) => total + amount, 0n);
  const creatorClaimable = await publicClient.readContract({
    address: manifest.contracts.protocolFeeRouter,
    abi: feeRouterAbi,
    functionName: "claimableCreatorNativeByRecipient",
    args: [launch.token, creator.address],
  });
  const daoClaimable = await publicClient.readContract({
    address: manifest.contracts.daoToken,
    abi: daoAbi,
    functionName: "claimableRewardOf",
    args: [dao.address],
  });
  if (!state.streamProbe) {
    if (holderClaimable === 0n || creatorClaimable === 0n || daoClaimable === 0n) {
      if (state.healthySeconds >= 55 * 60) {
        throw new Error("One-hour stream probe did not start by healthy minute 55");
      }
      return;
    }
    state.streamProbe = {
      startedHealthySeconds: state.healthySeconds,
      startedAt: new Date().toISOString(),
      claims: [],
    };
    saveState();
  }
  for (const minute of [10, 30, 59, 60]) {
    if (state.streamProbe.claims.includes(minute)) continue;
    if (state.healthySeconds - state.streamProbe.startedHealthySeconds < minute * 60) continue;
    const currentHolder = await Promise.all(
      rewardClaimIndexes(rewardCount).map((index) =>
        publicClient.readContract({
          address: launch.token,
          abi: tokenAbi,
          functionName: "withdrawableRewardOf",
          args: [holder.address, index],
        }),
      ),
    );
    if (currentHolder.every((amount) => amount === 0n)) return;
    const currentCreator = await publicClient.readContract({
      address: manifest.contracts.protocolFeeRouter,
      abi: feeRouterAbi,
      functionName: "claimableCreatorNativeByRecipient",
      args: [launch.token, creator.address],
    });
    const currentDao = await publicClient.readContract({
      address: manifest.contracts.daoToken,
      abi: daoAbi,
      functionName: "claimableRewardOf",
      args: [dao.address],
    });
    if (currentCreator === 0n || currentDao === 0n) return;
    await contractTransaction(
      `endurance-stream-claim-${minute}-holder`,
      holder,
      launch.token,
      tokenAbi,
      "claimAll",
    );
    await contractTransaction(
      `endurance-stream-claim-${minute}-creator`,
      creator,
      manifest.contracts.protocolFeeRouter,
      feeRouterAbi,
      "claimCreatorFees",
      [launch.token],
    );
    await contractTransaction(
      `endurance-stream-claim-${minute}-dao`,
      dao,
      manifest.contracts.daoToken,
      daoAbi,
      "claimRewards",
    );
    state.streamProbe.claims.push(minute);
    saveState();
  }
}

async function maybeAdvancedCoverage() {
  const first = state.enduranceLaunches[0];
  if (first && state.healthySeconds >= 25 * 60) {
    await executeUniversalCoverage(first);
    await addExternalLiquidity(first, 0);
    if (!state.advancedCoverage.firstFeesMaintained) {
      await maintainGraduatedFees(accounts[96], first, 6000);
      state.advancedCoverage.firstFeesMaintained = true;
      saveState();
    }
  }
  const second = state.enduranceLaunches[1];
  if (second && state.healthySeconds >= 55 * 60) {
    await addExternalLiquidity(second, 1);
    if (!state.advancedCoverage.secondFeesMaintained) {
      await maintainGraduatedFees(accounts[97], second, 6006);
      state.advancedCoverage.secondFeesMaintained = true;
      saveState();
    }
  }
  const third = state.enduranceLaunches[2];
  if (third && state.healthySeconds >= 85 * 60) {
    if (!state.advancedCoverage.thirdFeesMaintained) {
      await maintainGraduatedFees(accounts[98], third, 6012);
      state.advancedCoverage.thirdFeesMaintained = true;
      saveState();
    }
  }
  await maybeCreatorSplitUpdate();
  await maybeStreamProbe();
  await maybeCreatorClaimCoverage();
}
async function advanceGovernance() {
  const governor = manifest.contracts.governor;
  if (!state.governance.proposalId) {
    if (!state.funding?.completedAt || state.healthySeconds < 10 * 60) return;
    const threshold = await publicClient.readContract({
      address: governor,
      abi: governorAbi,
      functionName: "proposalThreshold",
    });
    const description = `Sherwood endurance harmless proposal ${runId}`;
    const targets = [governor];
    const values = [0n];
    const calldatas = [
      encodeFunctionData({
        abi: governorAbi,
        functionName: "setProposalThreshold",
        args: [threshold],
      }),
    ];
    await contractTransaction(
      "endurance-governance-propose",
      accounts[0],
      governor,
      governorAbi,
      "propose",
      [targets, values, calldatas, description],
    );
    const descriptionHash = keccak256(stringToHex(description));
    const proposalId = await publicClient.readContract({
      address: governor,
      abi: governorAbi,
      functionName: "hashProposal",
      args: [targets, values, calldatas, descriptionHash],
    });
    state.governance = {
      proposalId: proposalId.toString(),
      targets,
      values: values.map(String),
      calldatas,
      description,
      descriptionHash,
    };
    saveState();
    return;
  }
  const proposalId = BigInt(state.governance.proposalId);
  const proposalState = Number(
    await publicClient.readContract({
      address: governor,
      abi: governorAbi,
      functionName: "state",
      args: [proposalId],
    }),
  );
  if (proposalState === 1) {
    for (const [index, support] of [
      [0, 1],
      [1, 0],
      [2, 2],
    ]) {
      await contractTransaction(
        `endurance-governance-vote-${index}`,
        accounts[index],
        governor,
        governorAbi,
        "castVote",
        [proposalId, support],
      );
    }
  } else if (proposalState === 4) {
    await contractTransaction(
      "endurance-governance-queue",
      accounts[0],
      governor,
      governorAbi,
      "queue",
      [
        state.governance.targets,
        state.governance.values.map(BigInt),
        state.governance.calldatas,
        state.governance.descriptionHash,
      ],
    );
  } else if (proposalState === 5) {
    const eta = await publicClient.readContract({
      address: governor,
      abi: governorAbi,
      functionName: "proposalEta",
      args: [proposalId],
    });
    const block = await publicClient.getBlock();
    if (block.timestamp >= eta) {
      await contractTransaction(
        "endurance-governance-execute",
        accounts[0],
        governor,
        governorAbi,
        "execute",
        [
          state.governance.targets,
          state.governance.values.map(BigInt),
          state.governance.calldatas,
          state.governance.descriptionHash,
        ],
      );
    }
  }
  state.governance.lastState = proposalState;
  saveState();
}

function pm2Processes() {
  const pm2 = join(releaseRoot, "node_modules", ".bin", "pm2");
  const output = execFileSync(pm2, ["jlist"], {
    encoding: "utf8",
    env: { ...process.env, PM2_HOME: "/home/hendo420/.pm2" },
  });
  return JSON.parse(output)
    .filter((entry) => entry.name.endsWith("-testnet"))
    .map((entry) => ({
      name: entry.name,
      status: entry.pm2_env.status,
      restarts: entry.pm2_env.restart_time,
      cwd: entry.pm2_env.pm_cwd,
      rss: entry.monit.memory,
    }));
}

function availableMemory() {
  const match = readFileSync("/proc/meminfo", "utf8").match(
    /^MemAvailable:\s+(\d+) kB$/m,
  );
  if (!match) throw new Error("MemAvailable is unavailable");
  return BigInt(match[1]) * 1024n;
}

async function timedFetch(name, url, latencies) {
  const began = performance.now();
  const result = await rpcRetry(name, async () => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const error = new Error(`temporary ${name} returned ${response.status}`);
      throw error;
    }
    return response;
  });
  latencies.push(performance.now() - began);
  return result;
}

async function runReview(reviewIndex) {
  const path = join(
    reviewsDir,
    `review-${String(reviewIndex).padStart(2, "0")}.json`,
  );
  if (statExists(path)) return JSON.parse(readFileSync(path, "utf8"));
  const output = execFileSync(
    process.execPath,
    [
      join(releaseRoot, "scripts", "verify-testnet-v4-deployment.mjs"),
      manifestPath,
    ],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ROBYN_TESTNET_RPC_URL: rpcUrl },
    },
  );
  const verification = JSON.parse(output);
  if (verification.failures?.length) {
    throw new Error(
      `Deployment verifier failed ${verification.failures.length} checks`,
    );
  }
  const review = {
    reviewIndex,
    reviewedAt: new Date().toISOString(),
    releaseSha: releaseManifest.gitSha,
    deploymentManifestSha256: state.deploymentManifestSha256,
    verifierChecks: verification.checks?.length ?? null,
    verifierFailures: 0,
    healthySeconds: state.healthySeconds,
    targetSeconds: durationSeconds,
    remainingSeconds: Math.max(0, durationSeconds - state.healthySeconds),
    mode: "uninterrupted",
    observationPeriodSeconds: durationSeconds,
    transactionCount: state.transactions.length,
    writeCycleCount: state.writeCycleCount,
    enduranceLaunchCount: state.enduranceLaunches.length,
  };
  atomicWrite(path, review);
  state.reviewCount = Math.max(state.reviewCount, reviewIndex + 1);
  saveState();
  return review;
}

function statExists(path) {
  try {
    statSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function sample({ readiness = false } = {}) {
  const sampledAtMs = Date.now();
  const latencies = [];
  const failures = [];
  let status;
  let rpcBlock;
  let alerts = [];
  let processes = [];
  try {
    if (realpathSync(expectedReleaseLink) !== releaseRoot) {
      failures.push("exact release symlink changed");
    }
    const statusResponse = await timedFetch(
      "api-status",
      `${apiBase}/status`,
      latencies,
    );
    status = await statusResponse.json();
    await timedFetch("web-home", `${publicBase}/`, latencies);
    await timedFetch("web-markets", `${publicBase}/discover`, latencies);
    await timedFetch("web-dao", `${publicBase}/dao`, latencies);
    await timedFetch("web-admin-health", `${publicBase}/admin/health`, latencies);
    if (state.enduranceLaunches[0]) {
      await timedFetch(
        "web-token",
        `${publicBase}/launches/${state.enduranceLaunches[0].token}`,
        latencies,
      );
    }
    rpcBlock = await rpcRetry("rpc-block", () => publicClient.getBlockNumber());
    const alertResponse = await fetch(
      "http://127.0.0.1:9090/api/v1/alerts",
      { signal: AbortSignal.timeout(5_000) },
    );
    const alertPayload = await alertResponse.json();
    alerts = enduranceRelevantFiringAlerts(alertPayload.data.alerts);
    if (alerts.length) failures.push(`firing alerts: ${alerts.join(",")}`);
    processes = pm2Processes();
    const baseline = state.baselineProcesses;
    if (!baseline) {
      state.baselineProcesses = processes;
    } else {
      failures.push(...processContinuityFailures(baseline, processes));
    }
    if (status.chainId !== 46630) failures.push("API chain mismatch");
    const launchCount = Number(status.launchCount);
    if (
      state.lastLaunchCount !== undefined &&
      launchCount < state.lastLaunchCount
    ) {
      failures.push("indexed launch count moved backward");
    }
    state.lastLaunchCount = launchCount;
    const observedHeadBlock = Number(
      status.observedHeadBlock ?? status.asOfBlock,
    );
    const ingestionLag = Number(rpcBlock) - observedHeadBlock;
    const projectionLag = Number(status.projectionLagBlocks);
    if (ingestionLag < 0 || ingestionLag > 100) {
      failures.push(`ingestion lag is ${ingestionLag} blocks`);
    }
    if (!Number.isFinite(projectionLag) || projectionLag > 100) {
      failures.push(`projection lag is ${projectionLag} blocks`);
    }
    if (
      status.ingestionStatus !== "ok" ||
      status.projectionStatus !== "ok"
    ) {
      failures.push("indexer pipeline status is degraded");
    }
    failures.push(...protocolHealthFailures(status.protocol));
    if (!readiness) {
      state.ingestionLagSamples = [
        ...(state.ingestionLagSamples ?? []),
        ingestionLag,
      ].slice(-20);
    }
    const ingestionLagSamples = state.ingestionLagSamples ?? [];
    const ingestionLagP95 = percentile(ingestionLagSamples, 0.95);
    if (ingestionLagSamples.length >= 20 && ingestionLagP95 > 50) {
      failures.push(
        `ingestion lag p95 ${ingestionLagP95} blocks exceeds threshold`,
      );
    }
    const projectedDailyCu =
      Number(status.indexerProjectedDailyCu ?? 0) +
      Number(status.keeperProjectedDailyIdleCu ?? 0) +
      Number(status.protocol?.projectedDailyCu ?? 0);
    const projectedMonthlyCu =
      Number(status.indexerProjectedDailyCu ?? 0) * 30 +
      Number(status.keeperProjectedMonthlyCu ?? 0) +
      Number(status.protocol?.projectedMonthlyCu ?? 0);
    if (!Number.isFinite(projectedDailyCu) || projectedDailyCu > 250_000) {
      failures.push(`projected idle RPC use is ${projectedDailyCu} CU/day`);
    }
    if (!Number.isFinite(projectedMonthlyCu) || projectedMonthlyCu > 30_000_000) {
      failures.push(`projected normal RPC use is ${projectedMonthlyCu} CU/month`);
    }
    if (status.keeperStatus !== "ok") failures.push("keeper status is not ok");
    const keeperFailed = Number(status.keeperQueueCounts?.failed ?? 0);
    if (!Number.isSafeInteger(keeperFailed) || keeperFailed > 0) {
      failures.push(`keeper queue has ${keeperFailed} failed jobs`);
    }
    if (
      status.keeperOperatorBalanceWei !== null &&
      status.keeperMinimumOperatorBalanceWei !== null &&
      BigInt(status.keeperOperatorBalanceWei) <
        BigInt(status.keeperMinimumOperatorBalanceWei)
    ) {
      failures.push("keeper operator balance is below its safety floor");
    }
    if (status.artifactStatus !== "ok") {
      failures.push("artifact status is not ok");
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  const filesystem = statfsSync("/", { bigint: true });
  const disk = diskHeadroomPass(
    filesystem.bavail * filesystem.bsize,
    filesystem.blocks * filesystem.bsize,
  );
  if (!disk.passed) failures.push("disk headroom gate failed");
  const memoryBytes = availableMemory();
  if (memoryBytes < ENDURANCE_MINIMUM_MEMORY_BYTES) {
    failures.push("memory headroom gate failed");
  }
  const p95 = percentile(latencies, 0.95);
  if (p95 > ENDURANCE_MAXIMUM_API_P95_MS) {
    failures.push(`endpoint p95 ${p95.toFixed(1)}ms exceeds threshold`);
  }
  const infrastructurePassed = failures.length === 0;
  const passed = enduranceSamplePassed(
    infrastructurePassed,
    state.workloadFailure,
  );
  if (state.workloadFailure) {
    failures.push(
      `unresolved workload failure: ${state.workloadFailure.message}`,
    );
  }
  const previousPassed = state.lastSamplePassed;
  if (
    passed &&
    previousPassed === true &&
    Number.isFinite(state.lastSampleAtMs)
  ) {
    state.healthySeconds +=
      (sampledAtMs - state.lastSampleAtMs) / 1000;
  }
  if (!passed && !readiness) {
    state.paused = true;
    state.failed = true;
    state.terminalFailure = {
      sampledAt: new Date(sampledAtMs).toISOString(),
      failures,
      releaseSha: releaseManifest.gitSha,
    };
    state.segments.at(-1).finishedAt ??= new Date(sampledAtMs).toISOString();
    state.segments.at(-1).healthySeconds = state.healthySeconds;
    state.failures.push({
      sampledAt: new Date(sampledAtMs).toISOString(),
      failures,
      releaseSha: releaseManifest.gitSha,
    });
    state.failures = state.failures.slice(-200);
  }
  if (readiness) {
    state.readinessSampleCount = (state.readinessSampleCount ?? 0) + 1;
  } else {
    state.sampleCount += 1;
    state.lastSamplePassed = passed;
    state.lastSampleAtMs = sampledAtMs;
  }
  const sampleEntry = {
    sampledAt: new Date(sampledAtMs).toISOString(),
    phase: readiness ? "readiness" : "endurance",
    passed,
    infrastructurePassed,
    failures,
    healthySeconds: state.healthySeconds,
    sampleCount: readiness
      ? state.readinessSampleCount
      : state.sampleCount,
    status,
    rpcBlock: rpcBlock?.toString() ?? null,
    firingAlerts: alerts,
    processes,
    availableMemoryBytes: memoryBytes.toString(),
    availableDiskBytes: (
      filesystem.bavail * filesystem.bsize
    ).toString(),
    availableDiskPercent: disk.availablePercent,
    endpointP95Ms: p95,
    ingestionLagBlocks:
      status?.observedHeadBlock && rpcBlock !== undefined
        ? Number(rpcBlock) - Number(status.observedHeadBlock)
        : null,
    canonicalCheckpointLagBlocks:
      status?.observedHeadBlock && status?.asOfBlock
        ? Number(status.observedHeadBlock) - Number(status.asOfBlock)
        : null,
    projectionLagBlocks:
      status?.projectionLagBlocks === undefined
        ? null
        : Number(status.projectionLagBlocks),
    ingestionLagP95Blocks: state.ingestionLagSamples?.length
      ? percentile(state.ingestionLagSamples, 0.95)
      : null,
    transactionCount: state.transactions.length,
    writeCycleCount: state.writeCycleCount,
    enduranceLaunchCount: state.enduranceLaunches.length,
  };
  if (readiness) state.lastReadinessSample = sampleEntry;
  else state.lastSample = sampleEntry;
  append(samplesPath, sampleEntry);
  saveState();
  return sampleEntry;
}

async function runDueWork() {
  const launchDue = dueLaunchCount(state.healthySeconds);
  while (state.enduranceLaunches.length < launchDue) {
    await createEnduranceLaunch(state.enduranceLaunches.length);
  }
  await maybeGraduate();
  const writeDue = dueCount(state.healthySeconds, writeIntervalSeconds);
  while (state.writeCycleCount < writeDue) {
    await runWriteCycle(state.writeCycleCount);
  }
  await maybePreGraduationCoverage();
  await maybeAdvancedCoverage();
  await advanceGovernance();
  const reviewDue = dueCount(state.healthySeconds, reviewIntervalSeconds);
  while (state.reviewCount < reviewDue) {
    await runReview(state.reviewCount);
  }
}

function finalize() {
  const coverageFailures = enduranceCoverageFailures(state);
  if (coverageFailures.length > 0) {
    throw new Error(
      `Endurance lifecycle coverage is incomplete: ${coverageFailures.join("; ")}`,
    );
  }
  state.completed = true;
  state.completedAt = new Date().toISOString();
  state.segments.at(-1).finishedAt = state.completedAt;
  state.segments.at(-1).healthySeconds = state.healthySeconds;
  saveState();
  const files = [statePath, samplesPath, transactionsPath];
  for (const entry of execFileSync("find", [reviewsDir, "-type", "f"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)) {
    files.push(entry);
  }
  writeFileSync(
    checksumPath,
    `${files.map((path) => `${sha256File(path)}  ${path}`).join("\n")}\n`,
    { mode: 0o600 },
  );
}

if ((await publicClient.getChainId()) !== 46630) {
  throw new Error("Endurance RPC chain ID is not 46630");
}
if (process.env.ROBYN_ENDURANCE_PREFLIGHT_ONLY === "1") {
  process.stdout.write(`${json(await fundingPreflight())}\n`);
  process.exit(0);
}
await ensureFunding();
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

let readinessPasses = 0;
const readinessDeadlineMs = Date.now() + 10 * 60 * 1000;
while (!stopping && readinessPasses < 2) {
  const readinessSample = await sample({ readiness: true });
  readinessPasses = readinessSample.passed ? readinessPasses + 1 : 0;
  if (readinessPasses >= 2) break;
  if (Date.now() >= readinessDeadlineMs) {
    throw new Error(
      `Endurance readiness did not stabilize: ${readinessSample.failures.join("; ")}`,
    );
  }
  await sleep(sampleIntervalSeconds * 1000);
}
state.enduranceStartedAt = new Date().toISOString();
state.segments = [{ index: 1, startedAt: state.enduranceStartedAt }];
state.lastSamplePassed = undefined;
state.lastSampleAtMs = undefined;
saveState();

function pauseForWorkloadFailure(error) {
  const failure = {
    sampledAt: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
    releaseSha: releaseManifest.gitSha,
  };
  if (!state.paused) {
    state.paused = true;
    const segment = state.segments.at(-1);
    if (segment && !segment.finishedAt) {
      segment.finishedAt = failure.sampledAt;
      segment.healthySeconds = state.healthySeconds;
    }
  }
  state.lastSamplePassed = false;
  state.workloadFailure = failure;
  state.failed = true;
  state.terminalFailure = failure;
  state.failures.push({
    sampledAt: failure.sampledAt,
    failures: [failure.message],
    phase: "workload",
    releaseSha: releaseManifest.gitSha,
  });
  state.failures = state.failures.slice(-200);
  saveState();
}

while (!stopping && !state.completed && !state.failed) {
  const began = Date.now();
  const sampleEntry = await sample();
  if (sampleEntry.passed) {
    try {
      await runDueWork();
      if (state.workloadFailure) {
        state.workloadFailure = undefined;
        saveState();
      }
    } catch (error) {
      pauseForWorkloadFailure(error);
      break;
    }
  } else {
    break;
  }
  if (
    state.healthySeconds >= durationSeconds &&
    state.lastSamplePassed &&
    !state.workloadFailure &&
    !state.paused
  ) {
    await runReview(state.reviewCount);
    finalize();
    break;
  }
  const remaining = sampleIntervalSeconds * 1000 - (Date.now() - began);
  if (remaining > 0 && !stopping) await sleep(remaining);
}
process.stdout.write(`${json(state)}\n`);

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
  decryptCampaignRoot,
  deriveCampaignAccounts,
} from "./lib/campaign-wallets.mjs";
import { applyHeadroom, assertSchema8Manifest } from "./lib/campaign-plan.mjs";
import {
  diskHeadroomPass,
  dueCount,
  dueLaunchCount,
  enduranceSamplePassed,
  ENDURANCE_DURATION_SECONDS,
  ENDURANCE_MAXIMUM_API_P95_MS,
  ENDURANCE_MINIMUM_MEMORY_BYTES,
  ENDURANCE_RESERVE_WEI,
  ENDURANCE_REVIEW_INTERVAL_SECONDS,
  ENDURANCE_SAMPLE_INTERVAL_SECONDS,
  ENDURANCE_WRITE_INTERVAL_SECONDS,
  isRetryablePublicRpcError,
  percentile,
  processContinuityFailures,
  reconcileReleaseIdentity,
  rewardClaimIndexes,
  terminalCurveBuyValue,
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
const manifest = assertSchema8Manifest(
  JSON.parse(readFileSync(manifestPath, "utf8")),
);
const rpcUrl =
  process.env.ROBYN_TESTNET_RPC_URL ??
  "https://rpc.testnet.chain.robinhood.com";
if (rpcUrl !== "https://rpc.testnet.chain.robinhood.com") {
  throw new Error("Endurance requires Robinhood's official public testnet RPC");
}
const publicBase =
  process.env.ROBYN_ENDURANCE_PUBLIC_BASE ?? "https://sherwoodforest.trade";
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
const durationSeconds = Number(
  process.env.ROBYN_ENDURANCE_DURATION_SECONDS ??
    String(ENDURANCE_DURATION_SECONDS),
);
const sampleIntervalSeconds = Number(
  process.env.ROBYN_ENDURANCE_SAMPLE_INTERVAL_SECONDS ??
    String(ENDURANCE_SAMPLE_INTERVAL_SECONDS),
);
const writeIntervalSeconds = Number(
  process.env.ROBYN_ENDURANCE_WRITE_INTERVAL_SECONDS ??
    String(ENDURANCE_WRITE_INTERVAL_SECONDS),
);
const reviewIntervalSeconds = Number(
  process.env.ROBYN_ENDURANCE_REVIEW_INTERVAL_SECONDS ??
    String(ENDURANCE_REVIEW_INTERVAL_SECONDS),
);

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
if (campaignState.walletCount !== 100 || campaignState.launches?.length !== 8) {
  throw new Error("Endurance requires the completed 100-wallet schema-v8 campaign");
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
    throw new Error("Project keystore does not match schema-v8 deployer");
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
    schemaVersion: 1,
    runId,
    releaseSha: releaseManifest.gitSha,
    deploymentGitCommit: manifest.gitCommit,
    deploymentManifestSha256: sha256File(manifestPath),
    startedAt: new Date().toISOString(),
    healthySeconds: 0,
    sampleCount: 0,
    writeCycleCount: 0,
    reviewCount: 0,
    completed: false,
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
      description: `Automated eight-hour endurance launch ${index + 1}.`,
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
const feeRouterAbi = artifactAbi("RobynNativeProtocolFeeRouterV3");
const daoAbi = artifactAbi("RobynDaoToken");
const governorAbi = artifactAbi("RobynTestnetGovernor");

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
    shouldGraduate: index < 2,
  };
  state.enduranceLaunches.push(created);
  saveState();
  await waitForLaunchAndBind(created.token, metadata);
}

async function ensureFunding() {
  if (state.funding?.completedAt) return;
  const targetByIndex = new Map();
  for (let index = 0; index < 20; index += 1) {
    targetByIndex.set(index, 100_000_000_000_000n);
  }
  for (let index = 40; index < 44; index += 1) {
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
  return [...campaignState.launches, ...state.enduranceLaunches];
}

async function maybeGraduate() {
  for (let index = 0; index < Math.min(2, state.enduranceLaunches.length); index += 1) {
    const launch = state.enduranceLaunches[index];
    const threshold = index * 2 * 60 * 60 + 20 * 60;
    if (state.healthySeconds < threshold) continue;
    const graduated = await publicClient.readContract({
      address: launch.market,
      abi: marketAbi,
      functionName: "graduated",
    });
    if (graduated) continue;
    const account = accounts[96 + index];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [
        realCurveTokenReserve,
        virtualTokenReserve,
        virtualNativeReserve,
        feeBps,
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
      ]);
      const value = terminalCurveBuyValue({
        realCurveTokenReserve,
        virtualTokenReserve,
        virtualNativeReserve,
        feeBps: BigInt(feeBps),
      });
      const gasReserve = 20_000_000_000_000n;
      const buyerBalance = await publicClient.getBalance({
        address: account.address,
      });
      if (buyerBalance < value + gasReserve) {
        const funding = value + gasReserve - buyerBalance;
        const projectBalance = await publicClient.getBalance({
          address: project.address,
        });
        if (projectBalance < funding + ENDURANCE_RESERVE_WEI) {
          throw new Error(
            `Endurance graduation ${index} would breach the reserve`,
          );
        }
        await recordTransaction(
          `endurance-graduate-fund-${index}-${realCurveTokenReserve}`,
          project,
          {
            to: account.address,
            value: funding,
          },
        );
      }
      const [, output] = await publicClient.readContract({
        address: launch.market,
        abi: marketAbi,
        functionName: "quoteBuy",
        args: [value],
        account: account.address,
      });
      await contractTransaction(
        `endurance-graduate-${index}-${realCurveTokenReserve}`,
        account,
        launch.market,
        marketAbi,
        "buy",
        [(output * 98n) / 100n || 1n],
        value,
      );
      const after = await publicClient.readContract({
        address: launch.market,
        abi: marketAbi,
        functionName: "graduated",
      });
      if (after) break;
      if (attempt === 4) {
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
    const accountState = await publicClient.readContract({
      address: manifest.contracts.protocolFeeRouter,
      abi: feeRouterAbi,
      functionName: "launchAccount",
      args: [launch.token],
    });
    if (accountState.claimableCreatorNative > 0n) {
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

async function runWriteCycle(cycle) {
  const launches = activeLaunches();
  const launch = launches[cycle % launches.length];
  const account = accounts[cycle % 20];
  const value = 10_000_000_000_000n;
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

async function sample() {
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
    rpcBlock = await rpcRetry("rpc-block", () => publicClient.getBlockNumber());
    const alertResponse = await fetch(
      "http://127.0.0.1:9090/api/v1/alerts",
      { signal: AbortSignal.timeout(5_000) },
    );
    const alertPayload = await alertResponse.json();
    alerts = alertPayload.data.alerts
      .filter((entry) => entry.state === "firing")
      .map((entry) => entry.labels.alertname);
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
    const lag = Number(rpcBlock) - Number(status.asOfBlock);
    if (lag < 0 || lag > 100) failures.push(`index lag is ${lag} blocks`);
    if (status.keeperStatus !== "ok") failures.push("keeper status is not ok");
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
  if (!passed && !state.paused) {
    state.paused = true;
    state.segments.at(-1).finishedAt = new Date().toISOString();
    state.segments.at(-1).healthySeconds = state.healthySeconds;
  } else if (passed && state.paused) {
    state.paused = false;
    state.segments.push({
      index: state.segments.length + 1,
      startedAt: new Date().toISOString(),
    });
  }
  if (!passed) {
    state.failures.push({
      sampledAt: new Date(sampledAtMs).toISOString(),
      failures,
      releaseSha: releaseManifest.gitSha,
    });
    state.failures = state.failures.slice(-200);
  }
  state.sampleCount += 1;
  state.lastSamplePassed = passed;
  state.lastSampleAtMs = sampledAtMs;
  const sampleEntry = {
    sampledAt: new Date(sampledAtMs).toISOString(),
    passed,
    infrastructurePassed,
    failures,
    healthySeconds: state.healthySeconds,
    sampleCount: state.sampleCount,
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
    transactionCount: state.transactions.length,
    writeCycleCount: state.writeCycleCount,
    enduranceLaunchCount: state.enduranceLaunches.length,
  };
  state.lastSample = sampleEntry;
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
  await advanceGovernance();
  const reviewDue = dueCount(state.healthySeconds, reviewIntervalSeconds);
  while (state.reviewCount < reviewDue) {
    await runReview(state.reviewCount);
  }
}

function finalize() {
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
await ensureFunding();
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

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
  state.failures.push({
    sampledAt: failure.sampledAt,
    failures: [failure.message],
    phase: "workload",
    releaseSha: releaseManifest.gitSha,
  });
  state.failures = state.failures.slice(-200);
  saveState();
}

while (!stopping && !state.completed) {
  const began = Date.now();
  const sampleEntry = await sample();
  if (sampleEntry.infrastructurePassed) {
    try {
      await runDueWork();
      if (state.workloadFailure) {
        state.workloadFailure = undefined;
        saveState();
      }
    } catch (error) {
      pauseForWorkloadFailure(error);
    }
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

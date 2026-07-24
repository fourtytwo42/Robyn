#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  keccak256,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertCampaignId,
  createCampaignRoot,
  decryptCampaignRoot,
  deriveCampaignAccounts,
  encryptCampaignRoot,
  publicCampaignAccounts,
  weightedFundingTreeTransfers,
} from "./lib/campaign-wallets.mjs";
import {
  applyHeadroom,
  basketConversionActorIndex,
  graduationActorIndex,
  assertSchema8Manifest,
  launchBasketPlan,
  plannedBuyValueWei,
  plannedTransactionValueWei,
  plannedWalletValueWei,
  PRICED_TRANSACTION_COUNT,
  PLANNED_SWEEP_GAS_UNITS_PER_ACTOR,
  projectCampaignCost,
  REQUIRED_HEADROOM_BPS,
  REQUIRED_DISK_HEADROOM_BYTES,
  REQUIRED_RESERVE_WEI,
  V4_FEE_COLLECTION_MINIMUMS,
  V4_ORACLE_WINDOW_MATURITY_SECONDS,
  REQUIRED_SUCCESSFUL_WRITES,
  REQUIRED_WALLET_COUNT,
  weightedWalletFunding,
} from "./lib/campaign-plan.mjs";

const argv = process.argv.slice(2);
const command = argv.shift();
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const flag = (name) => argv.includes(`--${name}`);
const campaignId = assertCampaignId(
  option("campaign", process.env.ROBYN_CAMPAIGN_ID),
);
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const manifestPath = resolve(
  option(
    "manifest",
    process.env.ROBYN_CAMPAIGN_MANIFEST ??
      join(repoRoot, "deployments", "46630-v4.json"),
  ),
);
const stateDir = resolve(
  option(
    "state-dir",
    process.env.ROBYN_CAMPAIGN_STATE_DIR ??
      join(
        process.env.HOME,
        ".local",
        "state",
        "robyn-testnet-campaigns",
        campaignId,
      ),
  ),
);
const rootPath = join(stateDir, "encrypted-root.json");
const statePath = join(stateDir, "state.json");
const evidencePath = join(stateDir, "evidence.json");
const passphrasePath = resolve(
  option(
    "passphrase-file",
    process.env.ROBYN_CAMPAIGN_PASSPHRASE_FILE ?? "/nonexistent",
  ),
);
const rpcUrl =
  option("rpc-url", process.env.ROBYN_TESTNET_RPC_URL) ??
  "https://rpc.testnet.chain.robinhood.com";
const chain = defineChain({
  id: 46630,
  name: "Robinhood Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

function json(value) {
  return JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
}

function atomicWrite(path, value, mode = 0o600) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${json(value)}\n`, { mode });
  renameSync(temporary, path);
  chmodSync(path, mode);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function artifactAbi(contractName) {
  return readJson(
    join(
      repoRoot,
      "packages",
      "contracts",
      "out",
      `${contractName}.sol`,
      `${contractName}.json`,
    ),
  ).abi;
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(values[index], index);
      }
    }),
  );
  return results;
}

function requireProtectedFile(path, label) {
  const details = statSync(path);
  if (!details.isFile() || (details.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a regular file with mode 0600 or stricter`);
  }
  return readFileSync(path, "utf8").trim();
}

function loadManifest() {
  return assertSchema8Manifest(readJson(manifestPath));
}

function loadState() {
  const state = readJson(statePath);
  if (
    state.campaignId !== campaignId ||
    state.walletCount !== REQUIRED_WALLET_COUNT
  ) {
    throw new Error("Campaign state identity does not match this invocation");
  }
  return state;
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  atomicWrite(statePath, state);
  atomicWrite(evidencePath, {
    schemaVersion: 1,
    campaignId: state.campaignId,
    releaseSha: state.releaseSha,
    chainId: state.chainId,
    walletCount: state.walletCount,
    actors: state.actors,
    phases: state.phases,
    transactions: state.transactions,
    launches: state.launches ?? [],
    funding: state.funding ?? null,
    preflight: state.preflight ?? null,
    expectedFailures: state.expectedFailures ?? [],
    trading: state.trading ?? null,
    conversions: state.conversions ?? null,
    governance: state.governance ?? null,
    claims: state.claims ?? null,
    fill: state.fill ?? null,
    sweep: state.sweep ?? null,
    updatedAt: state.updatedAt,
  });
}

function loadAccounts() {
  const passphrase = requireProtectedFile(
    passphrasePath,
    "Campaign passphrase",
  );
  const root = decryptCampaignRoot(readJson(rootPath), passphrase);
  return deriveCampaignAccounts(root, campaignId, REQUIRED_WALLET_COUNT);
}

function projectPrivateKey(manifest) {
  if (flag("rehearsal")) {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(rpcUrl)) {
      throw new Error("Rehearsal private-key input is restricted to loopback RPC");
    }
    return requireProtectedFile(
      resolve(process.env.ROBYN_CAMPAIGN_REHEARSAL_KEY_FILE ?? "/nonexistent"),
      "Rehearsal key",
    );
  }
  const keystore = resolve(
    process.env.ROBYN_TESTNET_KEYSTORE ?? "/nonexistent",
  );
  const password = requireProtectedFile(
    resolve(process.env.ROBYN_TESTNET_PASSWORD_FILE ?? "/nonexistent"),
    "Project keystore password",
  );
  statSync(keystore);
  const privateKey = execFileSync(
    join(process.env.HOME, ".foundry", "bin", "cast"),
    [
      "wallet",
      "decrypt-keystore",
      basename(keystore),
      "--keystore-dir",
      dirname(keystore),
      "--unsafe-password",
      password,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== manifest.deployer.toLowerCase()) {
    throw new Error("Project keystore does not match manifest deployer");
  }
  return privateKey;
}

async function recordTransaction(state, label, client, request) {
  const previous = state.transactions.find((entry) => entry.label === label);
  if (previous) return previous;
  state.submittedTransactions ??= {};
  let hash = state.submittedTransactions[label]?.hash;
  if (!hash) {
    const pricedRequest =
      state.preflight?.gasPriceWei && request.gasPrice === undefined
        ? { ...request, gasPrice: BigInt(state.preflight.gasPriceWei) }
        : request;
    const estimatedGas = await publicClient.estimateGas(pricedRequest);
    hash = await client.sendTransaction({
      ...pricedRequest,
      gas: applyHeadroom(estimatedGas),
    });
    state.submittedTransactions[label] = {
      hash,
      submittedAt: new Date().toISOString(),
      from: request.account.address,
      to: request.to,
    };
    saveState(state);
  }
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180_000,
  });
  if (receipt.status !== "success") {
    throw new Error(`Transaction failed: ${label} ${hash}`);
  }
  const entry = {
    label,
    hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    from: receipt.from,
    to: receipt.to,
    transactionIndex: receipt.transactionIndex,
  };
  state.transactions.push(entry);
  delete state.submittedTransactions[label];
  saveState(state);
  return entry;
}

function walletClient(account) {
  return createWalletClient({ account, chain, transport: http(rpcUrl) });
}

async function contractTransaction(state, label, account, address, abi, functionName, args = [], value) {
  return recordTransaction(state, label, walletClient(account), {
    account,
    to: address,
    data: encodeFunctionData({ abi, functionName, args }),
    ...(value === undefined ? {} : { value }),
  });
}

async function expectSimulationFailure(state, label, request, pattern) {
  state.expectedFailures ??= [];
  if (state.expectedFailures.some((entry) => entry.label === label)) return;
  try {
    await publicClient.call(request);
  } catch (error) {
    const message = String(error?.shortMessage ?? error?.message ?? error);
    if (pattern && !pattern.test(message)) {
      throw new Error(`Unexpected failure for ${label}: ${message}`);
    }
    state.expectedFailures.push({ label, observedAt: new Date().toISOString(), message: message.slice(0, 500) });
    saveState(state);
    return;
  }
  throw new Error(`Expected ${label} to fail`);
}

async function apiJson(url, init = {}) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `API ${response.status} ${url}: ${body.error ?? "request_failed"}`,
    );
  }
  return { body, response };
}

async function creatorSession(account) {
  const apiBase = process.env.ROBYN_CAMPAIGN_API_URL;
  const origin = process.env.ROBYN_CAMPAIGN_APP_ORIGIN;
  if (!apiBase || !origin) {
    throw new Error("Campaign API URL and application origin are required");
  }
  const common = { "content-type": "application/json", origin };
  const nonce = await apiJson(`${apiBase}/auth/nonce`, {
    method: "POST",
    headers: common,
    body: JSON.stringify({ address: account.address }),
  });
  const message = nonce.body.data.message;
  const signature = await account.signMessage({ message });
  const verified = await apiJson(`${apiBase}/auth/verify`, {
    method: "POST",
    headers: common,
    body: JSON.stringify({ message, signature }),
  });
  const cookie = verified.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Authentication response did not set a session cookie");
  return { apiBase, origin, cookie };
}

async function prepareCampaignMetadata(account, launch, releaseSha) {
  const session = await creatorSession(account);
  const artworkPath = resolve(
    process.env.ROBYN_CAMPAIGN_ARTWORK ??
      join(
        repoRoot,
        "apps",
        "web",
        "public",
        "assets",
        "launchpad",
        "token-fallback.webp",
      ),
  );
  const media = await apiJson(`${session.apiBase}/media?purpose=token`, {
    method: "POST",
    headers: {
      "content-type": "image/webp",
      origin: session.origin,
      cookie: session.cookie,
    },
    body: readFileSync(artworkPath),
  });
  const operatorToken = requireProtectedFile(
    resolve(process.env.ROBYN_CAMPAIGN_OPERATOR_TOKEN_FILE ?? "/nonexistent"),
    "Campaign operator token",
  );
  const prepared = await apiJson(`${session.apiBase}/launch-metadata/prepare`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: session.origin,
      cookie: session.cookie,
      "x-robyn-operator-token": operatorToken,
    },
    body: JSON.stringify({
      mediaId: media.body.data.media_id,
      name: launch.name,
      symbol: launch.symbol,
      description: `Automated Robinhood Testnet assurance launch ${launch.index + 1}.`,
      campaignId,
      releaseSha,
    }),
  });
  return {
    session,
    mediaId: media.body.data.media_id,
    preparationId: prepared.body.data.preparation_id,
    metadataUri: prepared.body.data.metadata_uri,
    metadataCid: prepared.body.data.metadata_cid,
  };
}

async function waitForLaunchAndBind(token, metadata) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${metadata.session.apiBase}/launches/${token}`, {
      headers: { origin: metadata.session.origin },
    });
    if (response.ok) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  if (Date.now() >= deadline) throw new Error(`Indexer did not expose ${token}`);
  await apiJson(`${metadata.session.apiBase}/launches/${token}/metadata`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: metadata.session.origin,
      cookie: metadata.session.cookie,
    },
    body: JSON.stringify({ preparationId: metadata.preparationId }),
  });
}

async function init() {
  const manifest = loadManifest();
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
  try {
    statSync(statePath);
    throw new Error("Campaign state already exists; refusing to replace it");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const passphrase = requireProtectedFile(
    passphrasePath,
    "Campaign passphrase",
  );
  const root = createCampaignRoot();
  atomicWrite(rootPath, encryptCampaignRoot(root, passphrase));
  const state = {
    schemaVersion: 1,
    campaignId,
    releaseSha: manifest.gitCommit,
    chainId: 46630,
    walletCount: REQUIRED_WALLET_COUNT,
    actors: publicCampaignAccounts(
      root,
      campaignId,
      REQUIRED_WALLET_COUNT,
    ),
    phases: { initialized: new Date().toISOString() },
    transactions: [],
    createdAt: new Date().toISOString(),
  };
  saveState(state);
  console.log(
    json({
      campaignId,
      stateDir,
      walletCount: state.walletCount,
      rootEncrypted: true,
    }),
  );
}

async function verifyRelease(manifest) {
  const chainId = await publicClient.getChainId();
  if (chainId !== 46630) throw new Error(`Wrong chain ID: ${chainId}`);
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (dirty) throw new Error("Campaign requires a clean worktree");
  if (head !== manifest.gitCommit) {
    throw new Error("Manifest release SHA does not match the checked-out commit");
  }
  if (!flag("rehearsal")) {
    execFileSync("git", ["fetch", "origin", "main"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    const main = execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    if (head !== main) throw new Error("Live campaign requires exact origin/main");
  }
  for (const [name, address] of Object.entries(manifest.contracts)) {
    if (
      /^0x[0-9a-fA-F]{40}$/.test(address) &&
      !/^0x0{40}$/i.test(address) &&
      address.toLowerCase() !== manifest.contracts.guardian.toLowerCase()
    ) {
      const code = await publicClient.getCode({ address });
      if (!code || code === "0x") throw new Error(`${name} has no runtime code`);
    }
  }
  return head;
}

async function preflight() {
  const manifest = loadManifest();
  const state = loadState();
  const releaseSha = await verifyRelease(manifest);
  const gasPriceOverride = option("gas-price-wei");
  const l1Override = option("l1-base-fee-wei");
  if (
    (gasPriceOverride !== undefined || l1Override !== undefined) &&
    (!flag("rehearsal") ||
      !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(rpcUrl))
  ) {
    throw new Error("Fee overrides are restricted to loopback rehearsals");
  }
  const gasPriceWei =
    gasPriceOverride !== undefined
      ? BigInt(gasPriceOverride)
      : await publicClient.getGasPrice();
  const l1BaseFeeWei =
    l1Override !== undefined
      ? BigInt(l1Override)
      : await publicClient.readContract({
          address: "0x000000000000000000000000000000000000006C",
          abi: [
            {
              type: "function",
              name: "getL1BaseFeeEstimate",
              stateMutability: "view",
              inputs: [],
              outputs: [{ type: "uint256" }],
            },
          ],
          functionName: "getL1BaseFeeEstimate",
        });
  const cost = projectCampaignCost({
    gasPriceWei,
    l1BaseFeeWei,
    averageGasPerWrite: 250_000n,
    averageCalldataBytes: 512n,
    successfulWrites: PRICED_TRANSACTION_COUNT,
    transactionValueWei: plannedTransactionValueWei(),
  });
  const projectAddress = getAddress(manifest.deployer);
  const projectBalanceWei = await publicClient.getBalance({
    address: projectAddress,
  });
  const actorBalanceWei = (
    await mapWithConcurrency(state.actors, 4, ({ address }) =>
      publicClient.getBalance({ address }),
    )
  ).reduce((total, value) => total + value, 0n);
  const combinedBalanceWei = projectBalanceWei + actorBalanceWei;
  const filesystem = statfsSync(stateDir, { bigint: true });
  const diskAvailableBytes = filesystem.bavail * filesystem.bsize;
  if (diskAvailableBytes < REQUIRED_DISK_HEADROOM_BYTES) {
    throw new Error(
      `Insufficient campaign disk headroom: ${diskAvailableBytes} bytes available; ` +
        `${REQUIRED_DISK_HEADROOM_BYTES} required`,
    );
  }
  if (combinedBalanceWei < cost.totalRequiredWei) {
    throw new Error(
      `Insufficient combined balance: ${formatEther(combinedBalanceWei)} ETH; ` +
        `${formatEther(cost.totalRequiredWei)} ETH required`,
    );
  }
  state.preflight = {
    checkedAt: new Date().toISOString(),
    releaseSha,
    chainId: 46630,
    headroomBps: REQUIRED_HEADROOM_BPS.toString(),
    requiredSuccessfulWrites: REQUIRED_SUCCESSFUL_WRITES,
    gasPriceWei: gasPriceWei.toString(),
    l1BaseFeeWei: l1BaseFeeWei.toString(),
    projectAddress,
    projectBalanceWei: projectBalanceWei.toString(),
    actorBalanceWei: actorBalanceWei.toString(),
    combinedBalanceWei: combinedBalanceWei.toString(),
    diskAvailableBytes: diskAvailableBytes.toString(),
    requiredDiskHeadroomBytes: REQUIRED_DISK_HEADROOM_BYTES.toString(),
    cost,
    passed: true,
  };
  state.phases.preflight = state.preflight.checkedAt;
  saveState(state);
  console.log(json(state.preflight));
}

async function fund() {
  const manifest = loadManifest();
  const state = loadState();
  if (!state.preflight?.passed) throw new Error("Run a passing preflight first");
  const accounts = loadAccounts();
  const project = privateKeyToAccount(projectPrivateKey(manifest));
  const projectClient = createWalletClient({
    account: project,
    chain,
    transport: http(rpcUrl),
  });
  const gasPriceWei = BigInt(state.preflight.gasPriceWei);
  const l1BaseFeeWei = BigInt(state.preflight.l1BaseFeeWei);
  const transferCostWei =
    21_000n * gasPriceWei + 128n * 16n * l1BaseFeeWei;
  const campaignBudget = BigInt(state.preflight.cost.withHeadroomWei);
  const creatorLaunchBudgetWei =
    ((15_000_000n * gasPriceWei + 2_048n * 16n * l1BaseFeeWei) *
      (10_000n + REQUIRED_HEADROOM_BPS) +
      9_999n) /
    10_000n;
  const graduationGasBudgetWei =
    ((15_000_000n * gasPriceWei + 2_048n * 16n * l1BaseFeeWei) *
      (10_000n + REQUIRED_HEADROOM_BPS) +
      9_999n) /
    10_000n;
  const sweepGasBudgetWei =
    ((PLANNED_SWEEP_GAS_UNITS_PER_ACTOR * gasPriceWei +
      1_152n * 16n * l1BaseFeeWei) *
      (10_000n + REQUIRED_HEADROOM_BPS) +
      9_999n) /
    10_000n;
  const allocation = weightedWalletFunding(
    campaignBudget,
    Array.from({ length: REQUIRED_WALLET_COUNT }, (_, index) => ({
      index,
      amountWei:
        plannedWalletValueWei(index) +
        sweepGasBudgetWei +
        (index < 8 ? creatorLaunchBudgetWei : 0n) +
        (index >= 96 && index <= 98 ? graduationGasBudgetWei : 0n),
    })),
  );
  const plan = weightedFundingTreeTransfers(allocation.walletBudgetsWei, transferCostWei);
  const projectBalance = await publicClient.getBalance({
    address: project.address,
  });
  if (
    projectBalance <
    plan.rootFundingWei +
      transferCostWei +
      REQUIRED_RESERVE_WEI
  ) {
    throw new Error("Project wallet cannot fund the tree while preserving the reserve");
  }
  await recordTransaction(state, "fund-root", projectClient, {
    account: project,
    to: accounts[0].address,
    value: plan.rootFundingWei,
  });
  for (const transfer of plan.transfers) {
    const sender = privateKeyToAccount(accounts[transfer.parent].privateKey);
    const client = createWalletClient({
      account: sender,
      chain,
      transport: http(rpcUrl),
    });
    await recordTransaction(
      state,
      `fund-tree-${transfer.parent}-${transfer.child}`,
      client,
      {
        account: sender,
        to: accounts[transfer.child].address,
        value: transfer.amountWei,
      },
    );
  }
  state.phases.funded = new Date().toISOString();
  state.funding = {
    basePerWalletWei: allocation.basePerWalletWei.toString(),
    transferCostWei: transferCostWei.toString(),
    rootFundingWei: plan.rootFundingWei.toString(),
    creatorLaunchBudgetWei: creatorLaunchBudgetWei.toString(),
    graduationGasBudgetWei: graduationGasBudgetWei.toString(),
    sweepGasBudgetWei: sweepGasBudgetWei.toString(),
    weightedTopupTotalWei: allocation.topupTotalWei.toString(),
    minimumWalletBudgetWei: allocation.walletBudgetsWei.reduce((left, right) => left < right ? left : right).toString(),
    maximumWalletBudgetWei: allocation.walletBudgetsWei.reduce((left, right) => left > right ? left : right).toString(),
    allocatedActorBudgetWei: allocation.allocatedWei.toString(),
  };
  saveState(state);
  console.log(json(state.funding));
}

async function launches() {
  const manifest = loadManifest();
  const state = loadState();
  if (!state.phases.funded) throw new Error("Fund the campaign before launching");
  const accounts = loadAccounts();
  const plan = launchBasketPlan(manifest);
  const coordinatorAbi = artifactAbi("RobynV4LaunchCoordinatorV5");
  state.launches ??= [];
  for (const launch of plan) {
    if (state.launches.some((existing) => existing.index === launch.index)) continue;
    const account = privateKeyToAccount(accounts[launch.index].privateKey);
    let metadata;
    const rehearsalUri = option("metadata-uri");
    if (rehearsalUri !== undefined) {
      if (
        !flag("rehearsal") ||
        !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(rpcUrl) ||
        !/^ipfs:\/\/b[a-z2-7]+$/.test(rehearsalUri)
      ) {
        throw new Error("Metadata override is restricted to loopback rehearsals");
      }
      metadata = { metadataUri: rehearsalUri, preparationId: null, metadataCid: null };
    } else {
      metadata = await prepareCampaignMetadata(account, launch, state.releaseSha);
    }
    const userSalt = keccak256(
      stringToHex(
        `${accounts[launch.index].privateKey}:${campaignId}:${state.releaseSha}:${launch.index}`,
      ),
    );
    const request = {
      name: launch.name,
      symbol: launch.symbol,
      assets: launch.assets,
      weights: launch.weights,
      metadataUri: metadata.metadataUri,
      userSalt,
    };
    const data = encodeFunctionData({
      abi: coordinatorAbi,
      functionName: "createLaunch",
      args: [request],
    });
    const client = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });
    const transaction = await recordTransaction(
      state,
      `launch-${launch.index}`,
      client,
      {
        account,
        to: manifest.contracts.atomicLaunchCoordinator,
        data,
      },
    );
    const receipt = await publicClient.getTransactionReceipt({
      hash: transaction.hash,
    });
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
    if (!decoded) throw new Error(`Missing coordinator event for launch ${launch.index}`);
    const created = {
      ...launch,
      creator: account.address,
      transactionHash: transaction.hash,
      launchId: decoded.args.launchId.toString(),
      token: decoded.args.token,
      vault: decoded.args.receipt.vault,
      market: decoded.args.receipt.market,
      adapter: decoded.args.receipt.adapter,
      poolId: decoded.args.receipt.poolId,
      locker: decoded.args.receipt.locker,
      metadataUri: metadata.metadataUri,
      preparationId: metadata.preparationId,
      metadataCid: metadata.metadataCid,
    };
    state.launches.push(created);
    saveState(state);
    if (metadata.preparationId) await waitForLaunchAndBind(created.token, metadata);
  }
  state.phases.launched = new Date().toISOString();
  saveState(state);
  console.log(json({ launchCount: state.launches.length, launches: state.launches }));
}

async function trading() {
  const manifest = loadManifest();
  const state = loadState();
  if (!state.phases.launched || state.launches?.length !== 8) {
    throw new Error("Create all eight launches before trading");
  }
  const accounts = loadAccounts();
  const marketAbi = artifactAbi("RobynV4BondingCurveMarket");
  const tokenAbi = artifactAbi("RobynLaunchToken");
  const assetRouterAbi = artifactAbi("RobynV4AssetRouter");
  state.trading ??= { approvals: [] };

  for (let index = 0; index < 900; index += 1) {
    const launch = state.launches[index % state.launches.length];
    const actorIndex = index % accounts.length;
    const account = privateKeyToAccount(accounts[actorIndex].privateKey);
    const value = plannedBuyValueWei(index);
    const [, quoted] = await publicClient.readContract({
      address: launch.market,
      abi: marketAbi,
      functionName: "quoteBuy",
      args: [value],
      account: account.address,
    });
    const minimum = (quoted * 98n) / 100n || 1n;
    await contractTransaction(
      state,
      `trade-buy-${index}`,
      account,
      launch.market,
      marketAbi,
      "buy",
      [minimum],
      value,
    );
  }

  for (let index = 0; index < 200; index += 1) {
    const launch = state.launches[index % state.launches.length];
    let actorIndex = index % accounts.length;
    let balance = 0n;
    for (let attempts = 0; attempts < accounts.length; attempts += 1) {
      balance = await publicClient.readContract({
        address: launch.token,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [accounts[actorIndex].address],
      });
      if (balance > 1n) break;
      actorIndex = (actorIndex + 1) % accounts.length;
    }
    if (balance <= 1n) throw new Error(`No holder available for transfer ${index}`);
    const account = privateKeyToAccount(accounts[actorIndex].privateKey);
    const recipient = accounts[(actorIndex + 37) % accounts.length].address;
    const amount = balance / 100n || 1n;
    await contractTransaction(state, `trade-transfer-${index}`, account, launch.token, tokenAbi, "transfer", [recipient, amount]);
  }

  for (let index = 0; index < 150; index += 1) {
    const launch = state.launches[index % state.launches.length];
    let actorIndex = index % accounts.length;
    let balance = 0n;
    for (let attempts = 0; attempts < accounts.length; attempts += 1) {
      balance = await publicClient.readContract({
        address: launch.token,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [accounts[actorIndex].address],
      });
      if (balance > 100n) break;
      actorIndex = (actorIndex + 1) % accounts.length;
    }
    if (balance <= 100n) throw new Error(`No holder available for approval ${index}`);
    const amount = balance / 20n;
    const account = privateKeyToAccount(accounts[actorIndex].privateKey);
    await contractTransaction(state, `trade-approve-${index}`, account, launch.token, tokenAbi, "approve", [launch.market, amount]);
    if (!state.trading.approvals.some((entry) => entry.index === index)) {
      state.trading.approvals.push({ index, actorIndex, launchIndex: launch.index, amount: amount.toString() });
      saveState(state);
    }
  }

  for (const approval of state.trading.approvals) {
    const launch = state.launches[approval.launchIndex];
    const account = privateKeyToAccount(accounts[approval.actorIndex].privateKey);
    const balance = await publicClient.readContract({
      address: launch.token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    });
    const amount = [BigInt(approval.amount), balance / 100n].reduce((left, right) => left < right ? left : right);
    if (amount === 0n) throw new Error(`No balance available for sell ${approval.index}`);
    const [, quoted] = await publicClient.readContract({
      address: launch.market,
      abi: marketAbi,
      functionName: "quoteSell",
      args: [amount],
      account: account.address,
    });
    await contractTransaction(state, `trade-sell-${approval.index}`, account, launch.market, marketAbi, "sell", [amount, (quoted * 98n) / 100n || 1n]);
  }

  const graduated = [];
  const bondingProgress = [];
  for (const launch of state.launches) {
    const isGraduated = await publicClient.readContract({ address: launch.market, abi: marketAbi, functionName: "graduated" });
    const progress = await publicClient.readContract({ address: launch.market, abi: marketAbi, functionName: "graduationProgressBps" });
    if (isGraduated) graduated.push(launch.index);
    else bondingProgress.push({ index: launch.index, progressBps: progress.toString() });
  }
  if (graduated.length !== 3 || bondingProgress.length !== 5) {
    throw new Error(`Expected exactly three graduated and five bonding launches; got ${graduated.length}/${bondingProgress.length}`);
  }
  if (new Set(bondingProgress.map((entry) => entry.progressBps)).size !== 5) {
    throw new Error("Five bonding launches do not have distinct progress states");
  }

  for (const launchIndex of graduated) {
    const launch = state.launches[launchIndex];
    const account = privateKeyToAccount(accounts[90 + launchIndex].privateKey);
    const value = 250_000_000_000n;
    const [quoted] = await publicClient.readContract({
      address: manifest.contracts.assetRouter,
      abi: assetRouterAbi,
      functionName: "quoteNativeToAsset",
      args: [launch.token, value],
      account: account.address,
    });
    await contractTransaction(state, `direct-v4-buy-${launchIndex}`, account, manifest.contracts.assetRouter, assetRouterAbi, "swapExactNativeForAsset", [launch.token, (quoted * 98n) / 100n || 1n, account.address, BigInt(Math.floor(Date.now() / 1000) + 600)], value);
    const tokenBalance = await publicClient.readContract({ address: launch.token, abi: tokenAbi, functionName: "balanceOf", args: [account.address] });
    const sellAmount = tokenBalance / 4n;
    await contractTransaction(state, `direct-v4-approve-${launchIndex}`, account, launch.token, tokenAbi, "approve", [manifest.contracts.assetRouter, sellAmount]);
    const [nativeQuoted] = await publicClient.readContract({ address: manifest.contracts.assetRouter, abi: assetRouterAbi, functionName: "quoteAssetToNative", args: [launch.token, sellAmount], account: account.address });
    await contractTransaction(state, `direct-v4-sell-${launchIndex}`, account, manifest.contracts.assetRouter, assetRouterAbi, "swapExactAssetForNative", [launch.token, sellAmount, (nativeQuoted * 98n) / 100n || 1n, account.address, BigInt(Math.floor(Date.now() / 1000) + 600)]);
  }

  const first = state.launches[0];
  const firstAccount = privateKeyToAccount(accounts[0].privateKey);
  await expectSimulationFailure(
    state,
    "buy-impossible-slippage",
    {
      account: firstAccount.address,
      to: first.market,
      data: encodeFunctionData({ abi: marketAbi, functionName: "buy", args: [(1n << 256n) - 1n] }),
      value: 1_000_000_000n,
    },
    /revert|execution/i,
  );

  state.trading.graduatedLaunches = graduated;
  state.trading.bondingProgress = bondingProgress;
  state.phases.trading = new Date().toISOString();
  saveState(state);
  console.log(json({ buys: 900, transfers: 200, approvals: 150, sells: 150, graduated, bondingProgress }));
}

function loopbackRehearsal() {
  return flag("rehearsal") && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(rpcUrl);
}

async function advanceOrWait(seconds, label) {
  if (loopbackRehearsal()) {
    await publicClient.request({ method: "evm_increaseTime", params: [seconds] });
    await publicClient.request({ method: "evm_mine", params: [] });
    return;
  }
  const start = await publicClient.getBlock();
  const target = Number(start.timestamp) + seconds;
  while (true) {
    const current = await publicClient.getBlock();
    if (Number(current.timestamp) >= target) return;
    const remaining = target - Number(current.timestamp);
    console.error(`${label}: waiting ${remaining}s of chain time`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(30, remaining) * 1_000));
  }
}

async function conversions() {
  const manifest = loadManifest();
  const state = loadState();
  if (!state.phases.trading) throw new Error("Complete trading before conversions");
  const accounts = loadAccounts();
  const vaultAbi = artifactAbi("RobynNativeBasketVaultV2");
  const assetRouterAbi = artifactAbi("RobynV4AssetRouter");
  const lockerAbi = artifactAbi("RobynV4FeePositionLocker");
  const tokenAbi = artifactAbi("RobynLaunchToken");
  state.conversions ??= { legs: [] };
  state.conversions.harvests ??= [];
  state.conversions.batchAdjustments ??= [];
  if (!state.conversions.oracleWindowTargetTimestamp) {
    const current = await publicClient.getBlock();
    state.conversions.oracleWindowTargetTimestamp = (
      current.timestamp + BigInt(V4_ORACLE_WINDOW_MATURITY_SECONDS)
    ).toString();
    saveState(state);
  }
  const current = await publicClient.getBlock();
  const remaining =
    BigInt(state.conversions.oracleWindowTargetTimestamp) > current.timestamp
      ? Number(BigInt(state.conversions.oracleWindowTargetTimestamp) - current.timestamp)
      : 0;
  if (remaining > 0) {
    await advanceOrWait(remaining, "launch-fee oracle maturity");
  }
  state.conversions.oracleWindowReadyAt = new Date().toISOString();
  saveState(state);
  for (const launchIndex of state.trading.graduatedLaunches) {
    const launch = state.launches[launchIndex];
    const account = privateKeyToAccount(accounts[graduationActorIndex(launchIndex)].privateKey);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    await contractTransaction(state, `locker-collect-${launchIndex}`, account, launch.locker, lockerAbi, "collectFees", V4_FEE_COLLECTION_MINIMUMS);
    const nativeBalance = await publicClient.getBalance({ address: launch.locker });
    if (nativeBalance > 0n) await contractTransaction(state, `locker-route-native-${launchIndex}`, account, launch.locker, lockerAbi, "routeCollectedNative", [nativeBalance]);
    const tokenBalance = await publicClient.readContract({ address: launch.token, abi: tokenAbi, functionName: "balanceOf", args: [launch.locker] });
    if (tokenBalance > 0n) {
      const amount = tokenBalance > (1n << 128n) - 1n ? (1n << 128n) - 1n : tokenBalance;
      const [quoted] = await publicClient.readContract({ address: manifest.contracts.assetRouter, abi: assetRouterAbi, functionName: "quoteAssetToNative", args: [launch.token, amount] });
      await contractTransaction(state, `locker-convert-token-${launchIndex}`, account, launch.locker, lockerAbi, "convertCollectedToken", [amount, (quoted * 99n) / 100n || 1n, deadline]);
    }
    if (!state.conversions.harvests.some((entry) => entry.launchIndex === launchIndex)) {
      state.conversions.harvests.push({ launchIndex, nativeRouted: nativeBalance.toString(), launchTokenCollected: tokenBalance.toString() });
      saveState(state);
    }
  }
  for (const launch of state.launches) {
    for (let legIndex = 0; legIndex < 3; legIndex += 1) {
      const label = `basket-convert-${launch.index}-${legIndex}`;
      if (state.transactions.some((entry) => entry.label === label)) continue;
      const before = await publicClient.readContract({ address: launch.vault, abi: vaultAbi, functionName: "leg", args: [BigInt(legIndex)] });
      if (before.pendingNative === 0n) throw new Error(`No pending basket fees for ${label}`);
      const status = await publicClient.readContract({ address: manifest.contracts.assetRouter, abi: assetRouterAbi, functionName: "routeStatus", args: [before.asset] });
      if (!status.ready) throw new Error(`Basket route is not ready for ${before.asset}`);
      const account = privateKeyToAccount(
        accounts[basketConversionActorIndex(launch.index, legIndex)].privateKey,
      );
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      let amount = before.pendingNative < status.maximumNativeInput ? before.pendingNative : status.maximumNativeInput;
      let quoted;
      let minimumOutput;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        [quoted] = await publicClient.readContract({
          address: manifest.contracts.assetRouter,
          abi: assetRouterAbi,
          functionName: "quoteNativeToAsset",
          args: [before.asset, amount],
        });
        if (quoted === 0n) throw new Error(`Zero basket quote for ${label}`);
        minimumOutput = (quoted * 99n) / 100n;
        const request = {
          account: account.address,
          to: launch.vault,
          data: encodeFunctionData({
            abi: vaultAbi,
            functionName: "convertLeg",
            args: [BigInt(legIndex), amount, minimumOutput, deadline],
          }),
        };
        try {
          await publicClient.call(request);
          break;
        } catch (error) {
          const message = String(error?.shortMessage ?? error?.message ?? error);
          state.conversions.batchAdjustments.push({
            label,
            attempt,
            rejectedAmount: amount.toString(),
            reason: message.slice(0, 500),
          });
          saveState(state);
          if (amount <= 1n || attempt === 15) {
            throw new Error(`No safe basket conversion batch for ${label}: ${message}`);
          }
          amount /= 2n;
        }
      }
      if (launch.index === 0 && legIndex === 0) {
        await expectSimulationFailure(
          state,
          "basket-minimum-output-rejection",
          {
            account: account.address,
            to: launch.vault,
            data: encodeFunctionData({ abi: vaultAbi, functionName: "convertLeg", args: [0n, amount, quoted + 1n, deadline] }),
          },
          /revert|execution/i,
        );
      }
      await contractTransaction(state, label, account, launch.vault, vaultAbi, "convertLeg", [BigInt(legIndex), amount, minimumOutput, deadline]);
      const after = await publicClient.readContract({ address: launch.vault, abi: vaultAbi, functionName: "leg", args: [BigInt(legIndex)] });
      if (after.pendingNative >= before.pendingNative || after.rewardsDeposited <= before.rewardsDeposited) {
        throw new Error(`Basket conversion did not advance ${label}`);
      }
      state.conversions.legs.push({
        launchIndex: launch.index,
        legIndex,
        asset: before.asset,
        nativeInput: amount.toString(),
        minimumOutput: ((quoted * 99n) / 100n).toString(),
        rewardDelta: (after.rewardsDeposited - before.rewardsDeposited).toString(),
      });
      saveState(state);
    }
  }
  if (state.conversions.legs.length !== 24 || new Set(state.conversions.legs.map((entry) => entry.asset.toLowerCase())).size !== 24) {
    throw new Error("Conversions did not exercise all 24 unique basket assets");
  }
  state.phases.conversions = new Date().toISOString();
  saveState(state);
  console.log(json(state.conversions));
}

function decodeProposalId(receipt, governorAbi) {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: governorAbi, eventName: "ProposalCreated", data: log.data, topics: log.topics });
      return decoded.args.proposalId;
    } catch {}
  }
  throw new Error("Proposal receipt did not contain ProposalCreated");
}

async function governance() {
  const manifest = loadManifest();
  const state = loadState();
  if (!state.phases.conversions) throw new Error("Complete conversions before governance");
  const accounts = loadAccounts();
  const daoAbi = artifactAbi("RobynDaoToken");
  const governorAbi = artifactAbi("RobynTestnetGovernor");
  const project = privateKeyToAccount(projectPrivateKey(manifest));
  const memberAmount = 20_000_000n * 10n ** 18n;
  state.governance ??= { proposals: {} };

  for (let index = 0; index < 10; index += 1) {
    await contractTransaction(state, `rdao-transfer-${index}`, project, manifest.contracts.daoToken, daoAbi, "transfer", [accounts[index].address, memberAmount]);
  }
  for (let index = 0; index < 10; index += 1) {
    const account = privateKeyToAccount(accounts[index].privateKey);
    await contractTransaction(state, `rdao-delegate-${index}`, account, manifest.contracts.daoToken, daoAbi, "delegate", [account.address]);
  }
  await advanceOrWait(2, "RDAO checkpoint");

  const proposalThreshold = await publicClient.readContract({ address: manifest.contracts.governor, abi: governorAbi, functionName: "proposalThreshold" });
  const actionData = encodeFunctionData({ abi: governorAbi, functionName: "setProposalThreshold", args: [proposalThreshold] });
  const targets = [manifest.contracts.governor];
  const values = [0n];
  const calldatas = [actionData];
  const definitions = [
    { key: "successful", actorIndex: 0, description: `Sherwood assurance successful ${campaignId}` },
    { key: "defeated", actorIndex: 1, description: `Sherwood assurance defeated ${campaignId}` },
    { key: "cancelled", actorIndex: 2, description: `Sherwood assurance guardian cancellation ${campaignId}` },
  ];
  for (const definition of definitions) {
    if (state.governance.proposals[definition.key]) continue;
    const account = privateKeyToAccount(accounts[definition.actorIndex].privateKey);
    const transaction = await contractTransaction(state, `governance-propose-${definition.key}`, account, manifest.contracts.governor, governorAbi, "propose", [targets, values, calldatas, definition.description]);
    const receipt = await publicClient.getTransactionReceipt({ hash: transaction.hash });
    state.governance.proposals[definition.key] = {
      id: decodeProposalId(receipt, governorAbi).toString(),
      proposer: account.address,
      description: definition.description,
      descriptionHash: keccak256(stringToHex(definition.description)),
      targets,
      values: values.map(String),
      calldatas,
    };
    saveState(state);
  }

  const cancelled = state.governance.proposals.cancelled;
  const cancelledAccount = privateKeyToAccount(accounts[2].privateKey);
  await contractTransaction(state, "governance-cancel", cancelledAccount, manifest.contracts.governor, governorAbi, "cancel", [targets, values, calldatas, cancelled.descriptionHash]);

  const ineligible = privateKeyToAccount(accounts[99].privateKey);
  await expectSimulationFailure(
    state,
    "governance-ineligible-proposal",
    {
      account: ineligible.address,
      to: manifest.contracts.governor,
      data: encodeFunctionData({ abi: governorAbi, functionName: "propose", args: [targets, values, calldatas, `Ineligible ${campaignId}`] }),
    },
    /revert|execution/i,
  );

  await advanceOrWait(601, "Governance voting delay");
  const successfulId = BigInt(state.governance.proposals.successful.id);
  const defeatedId = BigInt(state.governance.proposals.defeated.id);
  for (let index = 0; index < 8; index += 1) {
    const account = privateKeyToAccount(accounts[index].privateKey);
    const support = index < 5 ? 1 : index < 7 ? 0 : 2;
    await contractTransaction(state, `governance-vote-success-${index}`, account, manifest.contracts.governor, governorAbi, "castVote", [successfulId, support]);
  }
  for (let index = 0; index < 6; index += 1) {
    const account = privateKeyToAccount(accounts[index].privateKey);
    await contractTransaction(state, `governance-vote-defeated-${index}`, account, manifest.contracts.governor, governorAbi, "castVote", [defeatedId, 0]);
  }
  const duplicateAccount = privateKeyToAccount(accounts[0].privateKey);
  await expectSimulationFailure(
    state,
    "governance-duplicate-vote",
    {
      account: duplicateAccount.address,
      to: manifest.contracts.governor,
      data: encodeFunctionData({ abi: governorAbi, functionName: "castVote", args: [successfulId, 1] }),
    },
    /revert|execution/i,
  );

  await advanceOrWait(1_801, "Governance voting period");
  const queueAccount = privateKeyToAccount(accounts[3].privateKey);
  const successful = state.governance.proposals.successful;
  await contractTransaction(state, "governance-queue-successful", queueAccount, manifest.contracts.governor, governorAbi, "queue", [targets, values, calldatas, successful.descriptionHash]);
  await advanceOrWait(601, "Governance timelock");
  await contractTransaction(state, "governance-execute-successful", queueAccount, manifest.contracts.governor, governorAbi, "execute", [targets, values, calldatas, successful.descriptionHash]);

  const states = {};
  for (const [key, proposal] of Object.entries(state.governance.proposals)) {
    states[key] = Number(await publicClient.readContract({ address: manifest.contracts.governor, abi: governorAbi, functionName: "state", args: [BigInt(proposal.id)] }));
  }
  if (states.successful !== 7 || states.defeated !== 3 || states.cancelled !== 2) {
    throw new Error(`Unexpected terminal governance states ${json(states)}`);
  }
  state.governance.states = states;
  state.phases.governance = new Date().toISOString();
  saveState(state);
  console.log(json(state.governance));
}

async function claims() {
  const manifest = loadManifest();
  const state = loadState();
  if (!state.phases.governance || !state.phases.conversions) throw new Error("Complete governance and conversions before claims");
  const accounts = loadAccounts();
  const tokenAbi = artifactAbi("RobynLaunchToken");
  const marketAbi = artifactAbi("RobynV4BondingCurveMarket");
  const feeRouterAbi = artifactAbi("RobynNativeProtocolFeeRouterV3");
  const daoAbi = artifactAbi("RobynDaoToken");
  state.claims ??= { holder: [], creator: [], dao: [] };

  for (let index = 0; index < 10; index += 1) {
    const account = privateKeyToAccount(accounts[index].privateKey);
    const launch = state.launches[3 + (index % 5)];
    const value = 200_000_000_000n;
    const [, quoted] = await publicClient.readContract({ address: launch.market, abi: marketAbi, functionName: "quoteBuy", args: [value], account: account.address });
    await contractTransaction(state, `post-rdao-fee-buy-${index}`, account, launch.market, marketAbi, "buy", [(quoted * 98n) / 100n || 1n], value);
  }

  for (let actorIndex = 0; state.claims.holder.length < 20 && actorIndex < accounts.length; actorIndex += 1) {
    const account = privateKeyToAccount(accounts[actorIndex].privateKey);
    let selected = null;
    for (const launch of state.launches) {
      for (let legIndex = 0; legIndex < 3; legIndex += 1) {
        const amount = await publicClient.readContract({ address: launch.token, abi: tokenAbi, functionName: "withdrawableRewardOf", args: [account.address, BigInt(legIndex)] });
        if (amount > 0n) { selected = { launch, legIndex, amount }; break; }
      }
      if (selected) break;
    }
    if (!selected) continue;
    const claimIndex = state.claims.holder.length;
    await contractTransaction(state, `holder-claim-${claimIndex}`, account, selected.launch.token, tokenAbi, "claim", [BigInt(selected.legIndex)]);
    state.claims.holder.push({ actorIndex, launchIndex: selected.launch.index, legIndex: selected.legIndex, amount: selected.amount.toString() });
    saveState(state);
  }
  if (state.claims.holder.length !== 20) throw new Error("Could not produce 20 holder reward claims");

  for (const launch of state.launches) {
    const account = privateKeyToAccount(accounts[launch.index].privateKey);
    const feeAccount = await publicClient.readContract({ address: manifest.contracts.protocolFeeRouter, abi: feeRouterAbi, functionName: "launchAccount", args: [launch.token] });
    if (feeAccount.claimableCreatorNative === 0n) throw new Error(`Creator ${launch.index} has no claimable native rewards`);
    await contractTransaction(state, `creator-claim-${launch.index}`, account, manifest.contracts.protocolFeeRouter, feeRouterAbi, "claimCreatorFees", [launch.token]);
    if (!state.claims.creator.some((entry) => entry.launchIndex === launch.index)) state.claims.creator.push({ launchIndex: launch.index, creator: account.address, amount: feeAccount.claimableCreatorNative.toString() });
    saveState(state);
  }

  const foreign = privateKeyToAccount(accounts[50].privateKey);
  await expectSimulationFailure(
    state,
    "creator-foreign-claim",
    { account: foreign.address, to: manifest.contracts.protocolFeeRouter, data: encodeFunctionData({ abi: feeRouterAbi, functionName: "claimCreatorFees", args: [state.launches[0].token] }) },
    /revert|execution/i,
  );

  for (let index = 0; index < 10; index += 1) {
    const account = privateKeyToAccount(accounts[index].privateKey);
    const amount = await publicClient.readContract({ address: manifest.contracts.daoToken, abi: daoAbi, functionName: "claimableRewardOf", args: [account.address] });
    if (amount === 0n) throw new Error(`RDAO member ${index} has no claimable rewards`);
    await contractTransaction(state, `rdao-claim-${index}`, account, manifest.contracts.daoToken, daoAbi, "claimRewards");
    if (!state.claims.dao.some((entry) => entry.actorIndex === index)) state.claims.dao.push({ actorIndex: index, amount: amount.toString() });
    saveState(state);
  }
  state.phases.claims = new Date().toISOString();
  saveState(state);
  console.log(json(state.claims));
}

function productWriteCount(state) {
  return state.transactions.filter((entry) => !entry.label.startsWith("fund-")).length;
}

async function fill() {
  const state = loadState();
  if (!state.phases.claims) throw new Error("Complete claims before fill");
  const accounts = loadAccounts();
  const tokenAbi = artifactAbi("RobynLaunchToken");
  let index = 0;
  while (productWriteCount(state) < 1_510) {
    const launch = state.launches[index % state.launches.length];
    let actorIndex = index % accounts.length;
    let balance = 0n;
    for (let attempts = 0; attempts < accounts.length; attempts += 1) {
      balance = await publicClient.readContract({ address: launch.token, abi: tokenAbi, functionName: "balanceOf", args: [accounts[actorIndex].address] });
      if (balance > 1n) break;
      actorIndex = (actorIndex + 1) % accounts.length;
    }
    if (balance <= 1n) throw new Error("No token holder available for fill activity");
    const account = privateKeyToAccount(accounts[actorIndex].privateKey);
    await contractTransaction(state, `fill-transfer-${index}`, account, launch.token, tokenAbi, "transfer", [accounts[(actorIndex + 1) % accounts.length].address, 1n]);
    index += 1;
  }
  state.fill = { productWrites: productWriteCount(state), additionalTransfers: index };
  state.phases.filled = new Date().toISOString();
  saveState(state);
  console.log(json(state.fill));
}

async function sweep() {
  const manifest = loadManifest();
  const state = loadState();
  if (!state.phases.filled) throw new Error("Complete fill before sweep");
  const accounts = loadAccounts();
  const tokenAbi = artifactAbi("RobynLaunchToken");
  const daoAbi = artifactAbi("RobynDaoToken");
  state.sweep ??= { tokenTransfers: 0, daoTransfers: 0, nativeTransfers: 0, dust: [] };
  for (let actorIndex = 0; actorIndex < accounts.length; actorIndex += 1) {
    const account = privateKeyToAccount(accounts[actorIndex].privateKey);
    for (const launch of state.launches) {
      const balance = await publicClient.readContract({ address: launch.token, abi: tokenAbi, functionName: "balanceOf", args: [account.address] });
      if (balance > 0n) {
        await contractTransaction(state, `sweep-token-${actorIndex}-${launch.index}`, account, launch.token, tokenAbi, "transfer", [manifest.deployer, balance]);
        state.sweep.tokenTransfers += 1;
      }
    }
    const daoBalance = await publicClient.readContract({ address: manifest.contracts.daoToken, abi: daoAbi, functionName: "balanceOf", args: [account.address] });
    if (daoBalance > 0n) {
      await contractTransaction(state, `sweep-rdao-${actorIndex}`, account, manifest.contracts.daoToken, daoAbi, "transfer", [manifest.deployer, daoBalance]);
      state.sweep.daoTransfers += 1;
    }
    saveState(state);
  }
  const gasPrice = await publicClient.getGasPrice();
  for (let actorIndex = 0; actorIndex < accounts.length; actorIndex += 1) {
    const account = privateKeyToAccount(accounts[actorIndex].privateKey);
    const balance = await publicClient.getBalance({ address: account.address });
    const reserve = 21_000n * gasPrice * 2n;
    if (balance > reserve) {
      await recordTransaction(state, `sweep-native-${actorIndex}`, walletClient(account), { account, to: manifest.deployer, value: balance - reserve });
      state.sweep.nativeTransfers += 1;
    } else if (balance > 0n) {
      state.sweep.dust.push({ actorIndex, amount: balance.toString() });
    }
    saveState(state);
  }
  const projectBalance = await publicClient.getBalance({ address: manifest.deployer });
  if (projectBalance < REQUIRED_RESERVE_WEI) throw new Error("Project reserve was not preserved after sweep");
  state.sweep.projectBalanceWei = projectBalance.toString();
  state.phases.swept = new Date().toISOString();
  saveState(state);
  console.log(json(state.sweep));
}

async function all() {
  const phases = loadState().phases;
  if (!phases.preflight) await preflight();
  if (!loadState().phases.funded) await fund();
  if (!loadState().phases.launched) await launches();
  if (!loadState().phases.trading) await trading();
  if (!loadState().phases.conversions) await conversions();
  if (!loadState().phases.governance) await governance();
  if (!loadState().phases.claims) await claims();
  if (!loadState().phases.filled) await fill();
  if (!loadState().phases.swept) await sweep();
  await status();
}

async function status() {
  const manifest = loadManifest();
  const state = loadState();
  const balances = await mapWithConcurrency(
    state.actors,
    4,
    async ({ index, address }) => ({
      index,
      address,
      balanceWei: (
        await publicClient.getBalance({ address })
      ).toString(),
    }),
  );
  const actorBalanceWei = balances.reduce(
    (total, actor) => total + BigInt(actor.balanceWei),
    0n,
  );
  const projectBalanceWei = await publicClient.getBalance({
    address: getAddress(manifest.deployer),
  });
  console.log(
    json({
      campaignId,
      releaseSha: state.releaseSha,
      phases: state.phases,
      successfulTransactions: state.transactions.length,
      productWrites: productWriteCount(state),
      requiredSuccessfulWrites: REQUIRED_SUCCESSFUL_WRITES,
      projectBalanceWei,
      actorBalanceWei,
      combinedBalanceWei: projectBalanceWei + actorBalanceWei,
      reserveSatisfied:
        projectBalanceWei + actorBalanceWei >= REQUIRED_RESERVE_WEI,
    }),
  );
}

if (!["init", "preflight", "fund", "launches", "trading", "conversions", "governance", "claims", "fill", "sweep", "all", "status"].includes(command)) {
  throw new Error(
    "Usage: testnet-assurance-campaign.mjs <init|preflight|fund|launches|trading|conversions|governance|claims|fill|sweep|all|status> --campaign ID",
  );
}
await { init, preflight, fund, launches, trading, conversions, governance, claims, fill, sweep, all, status }[command]();

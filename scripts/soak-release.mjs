#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  assertProcessContinuity,
  isRetryableNonceError,
  maximumCreatedLaunches,
  realisticSoakSymbol,
  shouldCreateLaunch,
  shouldGraduateLaunch,
} from "./soak-policy.mjs";

const durationSeconds = Number(process.env.SOAK_DURATION_SECONDS ?? "28800");
const intervalSeconds = Number(process.env.SOAK_INTERVAL_SECONDS ?? "30");
const outputBase = process.env.SOAK_OUTPUT_DIR ?? "/var/lib/robyn/soak";
const expectedRelease = process.env.SOAK_EXPECTED_RELEASE;
const minimumMemoryBytes = Number(
  process.env.SOAK_MINIMUM_AVAILABLE_MEMORY_BYTES ?? String(1024 ** 3),
);
const minimumDiskBytes = Number(
  process.env.SOAK_MINIMUM_AVAILABLE_DISK_BYTES ?? String(10 * 1024 ** 3),
);
const maximumRssGrowthBytes = Number(
  process.env.SOAK_MAXIMUM_RSS_GROWTH_BYTES ?? String(256 * 1024 ** 2),
);
const maximumEndpointP95Ms = Number(
  process.env.SOAK_MAXIMUM_ENDPOINT_P95_MS ?? "500",
);
const writeEverySamples = Number(
  process.env.SOAK_WRITE_EVERY_SAMPLES ?? "10",
);
const launchEveryWrites = Number(
  process.env.SOAK_LAUNCH_EVERY_WRITES ?? "4",
);
const graduateEveryLaunches = Number(
  process.env.SOAK_GRADUATE_EVERY_LAUNCHES ?? "2",
);
const publicApiBase =
  process.env.SOAK_PUBLIC_API_BASE ?? "http://192.168.50.250:3000/api";

if (
  !Number.isFinite(durationSeconds) ||
  durationSeconds <= 0 ||
  !Number.isFinite(intervalSeconds) ||
  intervalSeconds <= 0 ||
  !Number.isInteger(writeEverySamples) ||
  writeEverySamples <= 0 ||
  !Number.isInteger(launchEveryWrites) ||
  launchEveryWrites <= 0 ||
  !Number.isInteger(graduateEveryLaunches) ||
  graduateEveryLaunches <= 0
) {
  throw new Error(
    "soak duration, interval and write cadence must be positive numbers",
  );
}

const currentLink = "/opt/robyn/current";
const releasePath = fs.realpathSync(currentLink);
if (!releasePath.startsWith("/opt/robyn/releases/")) {
  throw new Error("current release is outside /opt/robyn/releases");
}
if (expectedRelease && releasePath !== fs.realpathSync(expectedRelease)) {
  throw new Error(`selected release does not match ${expectedRelease}`);
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(releasePath, "release-manifest.json"), "utf8"),
);
const deployment = JSON.parse(
  fs.readFileSync(path.join(releasePath, "deployments/31337.json"), "utf8"),
);
const releaseId = manifest.releaseId;
const startedAt = new Date();
const runId = startedAt.toISOString().replaceAll(/[-:.]/g, "");
const outputDir = path.join(outputBase, releaseId);
const samplesPath = path.join(outputDir, `soak-${runId}.jsonl`);
const summaryPath = path.join(outputDir, `soak-${runId}-summary.json`);
const lockPath = path.join(outputDir, "active.lock");
const workloadPath = path.join(outputDir, `soak-${runId}-workload.jsonl`);
const checksumPath = path.join(outputDir, `soak-${runId}-SHA256SUMS`);

fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
const lock = fs.openSync(lockPath, "wx", 0o600);
fs.writeFileSync(lock, `${process.pid}\n${startedAt.toISOString()}\n`);
fs.writeFileSync(samplesPath, "", { flag: "wx", mode: 0o600 });
fs.writeFileSync(workloadPath, "", { flag: "wx", mode: 0o600 });

const pm2Binary = path.join(releasePath, "node_modules/.bin/pm2");
const endpointLatencies = new Map();
const errors = [];
const manifestLaunches = deployment.demoLaunches ?? [];
const workloadLaunches = [...manifestLaunches];
const castBinary = "/home/hendo420/.foundry/bin/cast";
const operatorRpc = "http://127.0.0.1:8545";
const maximumUint256 =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const actorCount = 100;
let actorCursor = 0;
let actorRequestCount = 0;
let workloadTransactionCount = 0;
let workloadCycleCount = 0;
let createdLaunchCount = 0;
let graduatedLaunchCount = 0;
let metadataPreparationCount = 0;
let profileUpdateCount = 0;
let workloadNonceRetryCount = 0;
let errorCount = 0;
let sampleCount = 0;
let minimumObservedMemory = Number.POSITIVE_INFINITY;
let minimumObservedDisk = Number.POSITIVE_INFINITY;
let maximumObservedRss = 0;
let lastIndexedState;
let initialProtocolVerification;
let finalProtocolVerification;
let aborted = false;
let fatalFailure = false;

process.on("SIGTERM", () => {
  aborted = true;
});
process.on("SIGINT", () => {
  aborted = true;
});

function rememberError(message) {
  errorCount += 1;
  if (errors.length < 100) errors.push(message);
}

function pm2State() {
  return JSON.parse(
    execFileSync(pm2Binary, ["jlist"], {
      encoding: "utf8",
      env: { ...process.env, PM2_HOME: "/home/hendo420/.pm2" },
      maxBuffer: 4 * 1024 * 1024,
    }),
  );
}

function memAvailableBytes() {
  const match = fs
    .readFileSync("/proc/meminfo", "utf8")
    .match(/^MemAvailable:\s+(\d+) kB$/m);
  if (!match) throw new Error("MemAvailable is unavailable");
  return Number(match[1]) * 1024;
}

function diskAvailableBytes() {
  const result = execFileSync("df", ["-Pk", "/"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .at(-1)
    .trim()
    .split(/\s+/);
  return Number(result[3]) * 1024;
}

async function timedFetch(name, url, options) {
  const began = performance.now();
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(5000),
  });
  const latencyMs = performance.now() - began;
  const values = endpointLatencies.get(name) ?? [];
  values.push(latencyMs);
  endpointLatencies.set(name, values);
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  return { response, latencyMs };
}

function castCall(address, signature, ...args) {
  return execFileSync(
    castBinary,
    ["call", address, signature, ...args, "--rpc-url", operatorRpc],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  ).trim();
}

function castStringCall(address, signature, ...args) {
  const output = castCall(address, signature, ...args);
  try {
    const value = JSON.parse(output);
    if (typeof value === "string") return value;
  } catch {
    // Fall through to a fail-closed error with the original output.
  }
  throw new Error(`invalid cast string: ${output}`);
}

function castSendReceipt(sender, address, signature, ...args) {
  let output;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      output = execFileSync(
        castBinary,
        [
          "send",
          address,
          signature,
          ...args,
          "--from",
          sender,
          "--unlocked",
          "--rpc-url",
          operatorRpc,
          "--json",
        ],
        { encoding: "utf8", maxBuffer: 1024 * 1024 },
      );
      break;
    } catch (error) {
      if (attempt === 5 || !isRetryableNonceError(error)) throw error;
      workloadNonceRetryCount += 1;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  if (!output) {
    throw new Error(`workload transaction did not return: ${signature}`);
  }
  const receipt = JSON.parse(output);
  if (receipt.status !== "0x1" && receipt.status !== 1) {
    throw new Error(`workload transaction reverted: ${signature}`);
  }
  workloadTransactionCount += 1;
  return receipt;
}

function castSend(sender, address, signature, ...args) {
  return castSendReceipt(sender, address, signature, ...args).transactionHash;
}

function firstInteger(output) {
  const value = output.split(/\s+/)[0];
  if (!/^\d+$/.test(value)) throw new Error(`invalid cast integer: ${output}`);
  return BigInt(value);
}

function integerAt(output, index) {
  const values = output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
  const value = values[index];
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`invalid cast integer at ${index}: ${output}`);
  }
  return BigInt(value);
}

function unlockedAccounts() {
  return JSON.parse(
    execFileSync(
      castBinary,
      ["rpc", "eth_accounts", "--rpc-url", operatorRpc],
      { encoding: "utf8" },
    ),
  );
}

function appendWorkload(event) {
  fs.appendFileSync(
    workloadPath,
    `${JSON.stringify({
      recordedAt: new Date().toISOString(),
      gitSha: manifest.gitSha,
      ...event,
    })}\n`,
    { mode: 0o600 },
  );
}

function castFromUtf8(value) {
  return execFileSync(castBinary, ["from-utf8", value], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  }).trim();
}

async function jsonResponse(response, operation) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `${operation} returned HTTP ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function authenticateCreator(address) {
  const nonceResponse = await fetch(`${publicApiBase}/auth/nonce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
    signal: AbortSignal.timeout(5000),
  });
  const nonce = await jsonResponse(nonceResponse, "creator nonce");
  const message = nonce.data.message;
  const signature = JSON.parse(
    execFileSync(
      castBinary,
      [
        "rpc",
        "eth_sign",
        address,
        castFromUtf8(message),
        "--rpc-url",
        operatorRpc,
      ],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    ),
  );
  const verifyResponse = await fetch(`${publicApiBase}/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
    signal: AbortSignal.timeout(5000),
  });
  await jsonResponse(verifyResponse, "creator verification");
  const cookie = verifyResponse.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("creator verification did not set a session cookie");
  return cookie;
}

async function authenticatedJson(pathname, cookie, options = {}) {
  const response = await fetch(`${publicApiBase}${pathname}`, {
    ...options,
    headers: {
      cookie,
      ...(options.body && !Buffer.isBuffer(options.body)
        ? { "content-type": "application/json" }
        : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  return jsonResponse(response, pathname);
}

async function waitForLaunchIndex(token) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:3101/launches/${token}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) return;
    if (response.status !== 404) {
      throw new Error(`launch indexing returned HTTP ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`launch ${token} was not indexed within 15 seconds`);
}

function coordinatorLaunchFromReceipt(receipt, coordinator) {
  const log = receipt.logs?.find(
    (entry) =>
      entry.address?.toLowerCase() === coordinator.toLowerCase() &&
      Array.isArray(entry.topics) &&
      entry.topics.length === 4,
  );
  const tokenTopic = log?.topics?.[3];
  if (!/^0x[0-9a-fA-F]{64}$/.test(tokenTopic ?? "")) {
    throw new Error("atomic launch receipt is missing the indexed token");
  }
  return `0x${tokenTopic.slice(-40)}`;
}

async function createRealisticLaunch(accounts) {
  createdLaunchCount += 1;
  const sequence = createdLaunchCount;
  const creator = accounts[1 + ((sequence - 1) % 6)];
  const name = `Robyn Soak ${sequence}`;
  const symbol = realisticSoakSymbol(sequence);
  const cookie = await authenticateCreator(creator);
  const artworkNames = [
    "token-soak.webp",
    "token-orbit.webp",
    "token-signal.webp",
    "token-lucky.webp",
    "token-robyn.webp",
  ];
  const artworkPath = path.join(
    releasePath,
    "apps/web/public/assets/launchpad",
    artworkNames[(sequence - 1) % artworkNames.length],
  );
  const media = await authenticatedJson("/media?purpose=token", cookie, {
    method: "POST",
    headers: { "content-type": "image/webp" },
    body: fs.readFileSync(artworkPath),
  });
  const preparation = await authenticatedJson(
    "/launch-metadata/prepare",
    cookie,
    {
      method: "POST",
      body: JSON.stringify({
        mediaId: media.data.media_id,
        name,
        symbol,
        description:
          "A realistic-use soak launch with immutable reward-basket metadata.",
      }),
    },
  );
  metadataPreparationCount += 1;
  const salt = `0x${randomBytes(32).toString("hex")}`;
  const coordinator = deployment.contracts.atomicLaunchCoordinator;
  const tuple = `(${name},${symbol},[${deployment.contracts.rewardAssets.join(",")}],[4000,4000,2000],${preparation.data.metadata_uri},${salt})`;
  const receipt = castSendReceipt(
    creator,
    coordinator,
    "createLaunch((string,string,address[],uint16[],string,bytes32))",
    tuple,
  );
  const token = coordinatorLaunchFromReceipt(receipt, coordinator);
  const market = castCall(
    deployment.contracts.marketFactory,
    "marketByToken(address)(address)",
    token,
  );
  const vault = castCall(
    deployment.contracts.factory,
    "vaultByToken(address)(address)",
    token,
  );
  const onchainMetadataUri = castStringCall(token, "tokenURI()(string)");
  if (onchainMetadataUri !== preparation.data.metadata_uri) {
    throw new Error(`tokenURI mismatch for realistic launch ${token}`);
  }
  await waitForLaunchIndex(token);
  const binding = await authenticatedJson(`/launches/${token}/metadata`, cookie, {
    method: "POST",
    body: JSON.stringify({
      mediaId: media.data.media_id,
      preparationId: preparation.data.preparation_id,
    }),
  });
  if (binding.data.verification_status !== "robyn-sanitized") {
    throw new Error(`metadata binding is not Robyn-sanitized for ${token}`);
  }
  if (sequence <= 6) {
    await authenticatedJson("/profile", cookie, {
      method: "PUT",
      body: JSON.stringify({
        displayName: `Soak Creator ${sequence}`,
        bio: "Automated realistic-use persona on the controlled development network.",
      }),
    });
    profileUpdateCount += 1;
  }
  const launch = {
    name,
    symbol,
    creator,
    token,
    market,
    vault,
    metadataUri: preparation.data.metadata_uri,
    metadataCid: preparation.data.metadata_cid,
    mediaId: media.data.media_id,
    preparationId: preparation.data.preparation_id,
    createdBySoak: true,
  };
  workloadLaunches.push(launch);
  appendWorkload({
    kind: "atomic-launch",
    sequence,
    creator,
    token,
    market,
    vault,
    transaction: receipt.transactionHash,
    metadataUri: launch.metadataUri,
    metadataCid: launch.metadataCid,
    localPinStatus: media.data.local_pin_status,
    remotePinStatus: media.data.remote_pin_status,
  });
  return launch;
}

function tradeLaunch(launch, trader, buyAmount, sellDivisor = 20n) {
  const baseAsset = deployment.contracts.baseAsset;
  const transactions = [];
  const baseAllowance = firstInteger(
    castCall(baseAsset, "allowance(address,address)(uint256)", trader, launch.market),
  );
  if (baseAllowance < buyAmount) {
    transactions.push(
      castSend(trader, baseAsset, "approve(address,uint256)", launch.market, maximumUint256),
    );
  }
  const buyQuote = castCall(
    launch.market,
    "quoteBuy(uint256)(uint256,uint256)",
    String(buyAmount),
  );
  const quotedTokenOutput = integerAt(buyQuote, 1);
  const minimumTokenOutput = (quotedTokenOutput * 99n) / 100n;
  if (minimumTokenOutput === 0n) {
    throw new Error(`buy quote is too small for ${launch.token}`);
  }
  transactions.push(
    castSend(
      trader,
      launch.market,
      "buy(uint256,uint256)",
      String(buyAmount),
      String(minimumTokenOutput),
    ),
  );
  const tokenBalance = firstInteger(
    castCall(launch.token, "balanceOf(address)(uint256)", trader),
  );
  const sellAmount = tokenBalance / sellDivisor;
  if (sellAmount > 0n) {
    const tokenAllowance = firstInteger(
      castCall(
        launch.token,
        "allowance(address,address)(uint256)",
        trader,
        launch.market,
      ),
    );
    if (tokenAllowance < sellAmount) {
      transactions.push(
        castSend(
          trader,
          launch.token,
          "approve(address,uint256)",
          launch.market,
          maximumUint256,
        ),
      );
    }
    const sellQuote = castCall(
      launch.market,
      "quoteSell(uint256)(uint256,uint256)",
      String(sellAmount),
    );
    const quotedBaseOutput = integerAt(sellQuote, 1);
    const minimumBaseOutput = (quotedBaseOutput * 99n) / 100n;
    if (minimumBaseOutput === 0n) {
      throw new Error(`sell quote is too small for ${launch.token}`);
    }
    transactions.push(
      castSend(
        trader,
        launch.market,
        "sell(uint256,uint256)",
        String(sellAmount),
        String(minimumBaseOutput),
      ),
    );
  }
  return { transactions, sellAmount };
}

async function runWriteWorkload() {
  if (workloadLaunches.length === 0) throw new Error("soak has no launch workload");
  const accounts = unlockedAccounts();
  if (accounts.length < 7) throw new Error("soak requires seven unlocked devnet accounts");
  const nextCycle = workloadCycleCount + 1;
  let lifecycleLaunch;
  if (shouldCreateLaunch(nextCycle, launchEveryWrites)) {
    lifecycleLaunch = await createRealisticLaunch(accounts);
    const graduate = shouldGraduateLaunch(
      createdLaunchCount,
      graduateEveryLaunches,
    );
    const lifecycleTrader = accounts[1 + (createdLaunchCount % 6)];
    const lifecycleTrade = tradeLaunch(
      lifecycleLaunch,
      lifecycleTrader,
      graduate ? 7_000n * 10n ** 18n : 25n * 10n ** 18n,
      50n,
    );
    const graduated =
      castCall(lifecycleLaunch.market, "graduated()(bool)") === "true";
    if (graduate && !graduated) {
      throw new Error(`realistic launch ${lifecycleLaunch.token} did not graduate`);
    }
    if (graduated) graduatedLaunchCount += 1;
    appendWorkload({
      kind: "launch-lifecycle",
      sequence: createdLaunchCount,
      actor: lifecycleTrader,
      token: lifecycleLaunch.token,
      market: lifecycleLaunch.market,
      transactions: lifecycleTrade.transactions,
      expectedGraduation: graduate,
      graduated,
      postTradeSell: lifecycleTrade.sellAmount > 0n,
    });
  }
  const launch = workloadLaunches[workloadCycleCount % workloadLaunches.length];
  const trader = accounts[1 + (workloadCycleCount % 6)];
  const buyAmount = 10n ** 18n;
  const { transactions, sellAmount } = tradeLaunch(
    launch,
    trader,
    buyAmount,
  );

  const rewardCount = Number(
    firstInteger(castCall(launch.token, "rewardAssetCount()(uint256)")),
  );
  let claimableHolderReward = 0n;
  for (let index = 0; index < rewardCount; index += 1) {
    claimableHolderReward += firstInteger(
      castCall(
        launch.token,
        "withdrawableRewardOf(address,uint256)(uint256)",
        trader,
        String(index),
      ),
    );
  }
  if (claimableHolderReward > 0n) {
    transactions.push(castSend(trader, launch.token, "claimAll()"));
  }

  const feeAccount = castCall(
    deployment.contracts.protocolFeeRouter,
    "launchAccount(address)(address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)",
    launch.token,
  )
    .split("\n")
    .map((entry) => entry.trim().split(/\s+/)[0]);
  const creator = feeAccount[0];
  const claimableCreator = BigInt(feeAccount[10] ?? "0");
  if (
    claimableCreator > 0n &&
    accounts.some((account) => account.toLowerCase() === creator.toLowerCase())
  ) {
    transactions.push(
      castSend(
        creator,
        deployment.contracts.protocolFeeRouter,
        "claimCreatorFees(address)",
        launch.token,
      ),
    );
  }

  const daoAccount = accounts[0];
  const claimableDao = firstInteger(
    castCall(
      deployment.contracts.daoToken,
      "claimableRewardOf(address)(uint256)",
      daoAccount,
    ),
  );
  if (claimableDao > 0n) {
    transactions.push(
      castSend(daoAccount, deployment.contracts.daoToken, "claimRewards()"),
    );
  }

  workloadCycleCount += 1;
  appendWorkload({
    kind: "write-cycle",
    cycle: workloadCycleCount,
    actor: trader,
    token: launch.token,
    market: launch.market,
    transactions,
    operations: {
      buy: true,
      sell: sellAmount > 0n,
      holderClaim: claimableHolderReward > 0n,
      creatorClaim: claimableCreator > 0n,
      daoClaim: claimableDao > 0n,
      conversion: "permissionless keeper continuously monitored",
    },
  });
}

async function runActorReads() {
  const token = workloadLaunches[actorCursor % workloadLaunches.length]?.token;
  const requests = [
    { base: "http://127.0.0.1:3002", path: "/" },
    { base: "http://127.0.0.1:3002", path: "/discover" },
    { base: "http://127.0.0.1:3002", path: "/portfolio" },
    { base: "http://127.0.0.1:3002", path: "/dao" },
    {
      base: "http://127.0.0.1:3002",
      path: token ? `/launches/${token}` : "/discover",
    },
    { base: "http://127.0.0.1:3101", path: "/launches?limit=20" },
    { base: "http://127.0.0.1:3101", path: "/dao" },
    { base: "http://127.0.0.1:3101", path: "/dao/activity" },
    { base: "http://127.0.0.1:3101", path: "/dao/members" },
    { base: "http://127.0.0.1:3101", path: "/assets" },
  ];
  await Promise.all(
    requests.map(async (request, offset) => {
      const actor = (actorCursor + offset) % actorCount;
      const result = await timedFetch(
        `actor:${request.path.split("?")[0]}`,
        `${request.base}${request.path}`,
        {
          headers: {
            "user-agent": `robyn-soak-actor/${actor}`,
            "x-robyn-soak-actor": String(actor),
          },
        },
      );
      await result.response.arrayBuffer();
      actorRequestCount += 1;
    }),
  );
  actorCursor = (actorCursor + requests.length) % actorCount;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)];
}

async function collectSample() {
  const selectedRelease = fs.realpathSync(currentLink);
  if (selectedRelease !== releasePath) {
    throw new Error(`release changed from ${releasePath} to ${selectedRelease}`);
  }

  const [
    webHealth,
    discovery,
    apiHealth,
    statusResult,
    rpcHealth,
    rpcBlockResult,
    artifactHealth,
    alertsResult,
  ] = await Promise.all([
    timedFetch("webHealth", "http://127.0.0.1:3002/api/health"),
    timedFetch("discovery", "http://127.0.0.1:3002/discover"),
    timedFetch("apiHealth", "http://127.0.0.1:3101/health"),
    timedFetch("status", "http://127.0.0.1:3101/status"),
    timedFetch("rpcHealth", "http://127.0.0.1:8547/health"),
    timedFetch("rpcBlock", "http://127.0.0.1:8547", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}',
    }),
    timedFetch("artifactHealth", "http://127.0.0.1:3200/health"),
    timedFetch("alerts", "http://127.0.0.1:9090/api/v1/alerts"),
  ]);
  await runActorReads();

  const discoveryBody = await discovery.response.text();
  const hasApprovedNetworkDisclosure = [
    "Controlled development network",
    "Development network only",
  ].some((label) => discoveryBody.includes(label));
  if (!hasApprovedNetworkDisclosure) {
    throw new Error("discovery response is missing an approved development network label");
  }

  const status = await statusResult.response.json();
  const rpcBlockPayload = await rpcBlockResult.response.json();
  const chainBlock = Number.parseInt(rpcBlockPayload.result, 16);
  const alertsPayload = await alertsResult.response.json();
  const firingAlerts = alertsPayload.data.alerts.filter(
    (alert) => alert.state === "firing",
  ).length;

  const processes = pm2State();
  const expectedCwds = new Map([
    ["robyn-web", path.join(releasePath, "apps/web")],
    ["robyn-rpc-gateway", releasePath],
    ["robyn-api", releasePath],
    ["robyn-indexer", releasePath],
    ["robyn-keeper", releasePath],
    ["robyn-artifacts", releasePath],
  ]);
  if (processes.length !== expectedCwds.size) {
    throw new Error(`expected six PM2 processes, found ${processes.length}`);
  }

  const processState = processes.map((processEntry) => {
    const expectedCwd = expectedCwds.get(processEntry.name);
    if (!expectedCwd) throw new Error(`unexpected PM2 app ${processEntry.name}`);
    if (processEntry.pm2_env.status !== "online") {
      throw new Error(`${processEntry.name} is ${processEntry.pm2_env.status}`);
    }
    if (processEntry.pm2_env.pm_cwd !== expectedCwd) {
      throw new Error(`${processEntry.name} cwd escaped the selected release`);
    }
    return {
      name: processEntry.name,
      restartCount: processEntry.pm2_env.restart_time,
      rssBytes: processEntry.monit.memory,
      cwd: processEntry.pm2_env.pm_cwd,
    };
  });
  if (baseline) {
    assertProcessContinuity(baseline.processes, processState);
  }

  const availableMemoryBytes = memAvailableBytes();
  const availableDiskBytes = diskAvailableBytes();
  const totalRssBytes = processState.reduce(
    (total, processEntry) => total + processEntry.rssBytes,
    0,
  );
  minimumObservedMemory = Math.min(minimumObservedMemory, availableMemoryBytes);
  minimumObservedDisk = Math.min(minimumObservedDisk, availableDiskBytes);
  maximumObservedRss = Math.max(maximumObservedRss, totalRssBytes);

  const indexedState = {
    asOfBlock: Number(status.asOfBlock),
    launchCount: Number(status.launchCount),
    rawLogCount: Number(status.rawLogCount),
  };
  if (
    lastIndexedState &&
    (indexedState.asOfBlock < lastIndexedState.asOfBlock ||
      indexedState.launchCount < lastIndexedState.launchCount ||
      indexedState.rawLogCount < lastIndexedState.rawLogCount)
  ) {
    throw new Error("indexed financial state moved backward");
  }
  lastIndexedState = indexedState;

  if (status.keeperStatus !== "ok" || status.artifactStatus !== "ok") {
    throw new Error("keeper or artifact status is degraded");
  }
  if (Number(status.asOfBlock) > chainBlock) {
    throw new Error("indexer is ahead of the chain head");
  }
  if (firingAlerts !== 0) {
    throw new Error(`${firingAlerts} Prometheus alerts are firing`);
  }
  if (availableMemoryBytes < minimumMemoryBytes) {
    throw new Error("available memory dropped below the release threshold");
  }
  if (availableDiskBytes < minimumDiskBytes) {
    throw new Error("available disk dropped below the release threshold");
  }

  return {
    sampledAt: new Date().toISOString(),
    releasePath,
    gitSha: manifest.gitSha,
    chainBlock,
    status,
    firingAlerts,
    availableMemoryBytes,
    availableDiskBytes,
    totalRssBytes,
    processes: processState,
    latenciesMs: {
      webHealth: webHealth.latencyMs,
      discovery: discovery.latencyMs,
      apiHealth: apiHealth.latencyMs,
      status: statusResult.latencyMs,
      rpcHealth: rpcHealth.latencyMs,
      rpcBlock: rpcBlockResult.latencyMs,
      artifactHealth: artifactHealth.latencyMs,
      alerts: alertsResult.latencyMs,
    },
  };
}

let baseline;
let finalSample;
try {
  initialProtocolVerification = execFileSync(
    path.join(releasePath, "scripts/verify-devnet-deployment.sh"),
    [path.join(releasePath, "deployments/31337.json")],
    { encoding: "utf8", env: { ...process.env, HOME: "/home/hendo420" } },
  ).trim();
  baseline = await collectSample();
  fs.appendFileSync(samplesPath, `${JSON.stringify(baseline)}\n`, {
    mode: 0o600,
  });
  sampleCount += 1;
  finalSample = baseline;

  const finishAt = startedAt.getTime() + durationSeconds * 1000;
  while (!aborted && Date.now() < finishAt) {
    const waitMs = Math.min(intervalSeconds * 1000, finishAt - Date.now());
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    if (Date.now() > finishAt + intervalSeconds * 1000) {
      rememberError("soak sampling delay exceeded one interval");
    }
    if (aborted) break;
    try {
      if (sampleCount > 0 && sampleCount % writeEverySamples === 0) {
        await runWriteWorkload();
      }
      finalSample = await collectSample();
      fs.appendFileSync(samplesPath, `${JSON.stringify(finalSample)}\n`);
      sampleCount += 1;
    } catch (error) {
      const message = `${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}`;
      rememberError(message);
      fatalFailure = true;
      fs.appendFileSync(
        samplesPath,
        `${JSON.stringify({ sampledAt: new Date().toISOString(), error: message })}\n`,
      );
      break;
    }
  }
  if (!aborted) {
    finalProtocolVerification = execFileSync(
      path.join(releasePath, "scripts/verify-devnet-deployment.sh"),
      [path.join(releasePath, "deployments/31337.json")],
      { encoding: "utf8", env: { ...process.env, HOME: "/home/hendo420" } },
    ).trim();
  }
} catch (error) {
  rememberError(error instanceof Error ? error.message : String(error));
} finally {
  const finishedAt = new Date();
  const elapsedSeconds = (finishedAt.getTime() - startedAt.getTime()) / 1000;
  const baselineRestarts =
    baseline?.processes.reduce(
      (total, processEntry) => total + processEntry.restartCount,
      0,
    ) ?? null;
  const finalRestarts =
    finalSample?.processes.reduce(
      (total, processEntry) => total + processEntry.restartCount,
      0,
    ) ?? null;
  const rssGrowthBytes =
    baseline && finalSample
      ? finalSample.totalRssBytes - baseline.totalRssBytes
      : null;
  const completedDuration = elapsedSeconds >= durationSeconds;
  const endpointP95Ms = Object.fromEntries(
    [...endpointLatencies].map(([name, values]) => [
      name,
      percentile(values, 0.95),
    ]),
  );
  const p95WithinThreshold = Object.values(endpointP95Ms).every(
    (value) => value !== null && value <= maximumEndpointP95Ms,
  );
  const passed =
    !aborted &&
    !fatalFailure &&
    completedDuration &&
    errorCount === 0 &&
    baselineRestarts === finalRestarts &&
    rssGrowthBytes !== null &&
    rssGrowthBytes <= maximumRssGrowthBytes &&
    p95WithinThreshold &&
    Boolean(initialProtocolVerification) &&
    Boolean(finalProtocolVerification);

  const summary = {
    schemaVersion: 1,
    releaseId,
    gitSha: manifest.gitSha,
    releasePath,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    requestedDurationSeconds: durationSeconds,
    elapsedSeconds,
    intervalSeconds,
    writeEverySamples,
    launchEveryWrites,
    graduateEveryLaunches,
    maximumPlannedCreatedLaunches: maximumCreatedLaunches(
      durationSeconds,
      intervalSeconds,
      writeEverySamples,
      launchEveryWrites,
    ),
    sampleCount,
    actorCount,
    actorRequestCount,
    workloadCycleCount,
    createdLaunchCount,
    graduatedLaunchCount,
    metadataPreparationCount,
    profileUpdateCount,
    workloadTransactionCount,
    workloadNonceRetryCount,
    workloadPath,
    errorCount,
    errors,
    aborted,
    fatalFailure,
    completedDuration,
    baselineRestarts,
    finalRestarts,
    rssGrowthBytes,
    maximumObservedRss,
    maximumEndpointP95Ms,
    p95WithinThreshold,
    initialProtocolVerification,
    finalProtocolVerification,
    minimumObservedMemory,
    minimumObservedDisk,
    endpointP95Ms,
    baseline,
    finalSample,
    passed,
  };
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
    mode: 0o600,
  });
  const checksums = [samplesPath, workloadPath, summaryPath].map((filePath) => {
    const digest = createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex");
    return `${digest}  ${path.basename(filePath)}`;
  });
  fs.writeFileSync(checksumPath, `${checksums.join("\n")}\n`, { mode: 0o600 });
  fs.closeSync(lock);
  fs.rmSync(lockPath, { force: true });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (!passed) process.exitCode = 1;
}

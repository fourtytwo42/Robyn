#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { assertProcessContinuity } from "./soak-policy.mjs";

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

if (
  !Number.isFinite(durationSeconds) ||
  durationSeconds <= 0 ||
  !Number.isFinite(intervalSeconds) ||
  intervalSeconds <= 0 ||
  !Number.isInteger(writeEverySamples) ||
  writeEverySamples <= 0
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
const castBinary = "/home/hendo420/.foundry/bin/cast";
const operatorRpc = "http://127.0.0.1:8545";
const maximumUint256 =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const actorCount = 100;
let actorCursor = 0;
let actorRequestCount = 0;
let workloadTransactionCount = 0;
let workloadCycleCount = 0;
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

function castSend(sender, address, signature, ...args) {
  const receipt = JSON.parse(
    execFileSync(
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
    ),
  );
  if (receipt.status !== "0x1" && receipt.status !== 1) {
    throw new Error(`workload transaction reverted: ${signature}`);
  }
  workloadTransactionCount += 1;
  return receipt.transactionHash;
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

function runWriteWorkload() {
  if (manifestLaunches.length === 0) throw new Error("soak has no launch workload");
  const accounts = unlockedAccounts();
  if (accounts.length < 7) throw new Error("soak requires seven unlocked devnet accounts");
  const launch = manifestLaunches[workloadCycleCount % manifestLaunches.length];
  const trader = accounts[1 + (workloadCycleCount % 6)];
  const baseAsset = deployment.contracts.baseAsset;
  const transactions = [];
  const baseAllowance = firstInteger(
    castCall(baseAsset, "allowance(address,address)(uint256)", trader, launch.market),
  );
  if (baseAllowance < 10n ** 18n) {
    transactions.push(
      castSend(trader, baseAsset, "approve(address,uint256)", launch.market, maximumUint256),
    );
  }
  const buyAmount = 10n ** 18n;
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
  const sellAmount = tokenBalance / 20n;
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
  const token = manifestLaunches[actorCursor % manifestLaunches.length]?.token;
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
        runWriteWorkload();
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
    sampleCount,
    actorCount,
    actorRequestCount,
    workloadCycleCount,
    workloadTransactionCount,
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

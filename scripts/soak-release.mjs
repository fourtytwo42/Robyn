#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const durationSeconds = Number(process.env.SOAK_DURATION_SECONDS ?? "86400");
const intervalSeconds = Number(process.env.SOAK_INTERVAL_SECONDS ?? "15");
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

if (
  !Number.isFinite(durationSeconds) ||
  durationSeconds <= 0 ||
  !Number.isFinite(intervalSeconds) ||
  intervalSeconds <= 0
) {
  throw new Error("soak duration and interval must be positive numbers");
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
const releaseId = manifest.releaseId;
const startedAt = new Date();
const runId = startedAt.toISOString().replaceAll(/[-:.]/g, "");
const outputDir = path.join(outputBase, releaseId);
const samplesPath = path.join(outputDir, `soak-${runId}.jsonl`);
const summaryPath = path.join(outputDir, `soak-${runId}-summary.json`);
const lockPath = path.join(outputDir, "active.lock");

fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
const lock = fs.openSync(lockPath, "wx", 0o600);
fs.writeFileSync(lock, `${process.pid}\n${startedAt.toISOString()}\n`);

const pm2Binary = path.join(releasePath, "node_modules/.bin/pm2");
const endpointLatencies = new Map();
const errors = [];
let errorCount = 0;
let sampleCount = 0;
let minimumObservedMemory = Number.POSITIVE_INFINITY;
let minimumObservedDisk = Number.POSITIVE_INFINITY;
let maximumObservedRss = 0;
let lastIndexedState;
let initialProtocolVerification;
let finalProtocolVerification;
let aborted = false;

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

  const discoveryBody = await discovery.response.text();
  if (!discoveryBody.includes("Controlled devnet")) {
    throw new Error("discovery response is missing the controlled-devnet label");
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
      finalSample = await collectSample();
      fs.appendFileSync(samplesPath, `${JSON.stringify(finalSample)}\n`);
      sampleCount += 1;
    } catch (error) {
      const message = `${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}`;
      rememberError(message);
      fs.appendFileSync(
        samplesPath,
        `${JSON.stringify({ sampledAt: new Date().toISOString(), error: message })}\n`,
      );
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
    sampleCount,
    errorCount,
    errors,
    aborted,
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
  fs.closeSync(lock);
  fs.rmSync(lockPath, { force: true });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (!passed && !aborted) process.exitCode = 1;
}

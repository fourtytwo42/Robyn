#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function hasFlag(name) {
  return args.includes(name);
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function numericOption(name, fallback) {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(percentileValue * sorted.length) - 1,
  );
  return sorted[index];
}

function parseJson(pathname) {
  return JSON.parse(fs.readFileSync(pathname, "utf8"));
}

function fail(message) {
  throw new Error(message);
}

const samplesPath = path.resolve(requiredOption("--samples"));
const summaryOption = option("--summary");
const summaryPath = summaryOption ? path.resolve(summaryOption) : undefined;
const expectedSha = requiredOption("--expected-sha");
const expectedRelease = path.resolve(requiredOption("--expected-release"));
const allowActive = hasFlag("--allow-active");
const minimumDurationSeconds = numericOption("--minimum-duration", 86_400);
const minimumMemoryBytes = numericOption("--minimum-memory", 1024 ** 3);
const minimumDiskBytes = numericOption("--minimum-disk", 10 * 1024 ** 3);
const maximumRssGrowthBytes = numericOption(
  "--maximum-rss-growth",
  256 * 1024 ** 2,
);
const maximumEndpointP95Ms = numericOption("--maximum-endpoint-p95", 500);
const maximumCadenceMultiplier = numericOption("--maximum-cadence-multiplier", 2);

if (!fs.existsSync(samplesPath)) fail(`samples do not exist: ${samplesPath}`);
if (!summaryPath && !allowActive) {
  fail("a final audit requires --summary; use --allow-active only for observation");
}
if (summaryPath && !fs.existsSync(summaryPath)) {
  fail(`summary does not exist: ${summaryPath}`);
}

const rawLines = fs
  .readFileSync(samplesPath, "utf8")
  .split("\n")
  .filter((line) => line.length > 0);
if (rawLines.length === 0) fail("sample stream is empty");

const rows = rawLines.map((line, index) => {
  try {
    return JSON.parse(line);
  } catch (error) {
    fail(
      `sample ${index + 1} is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
});

const expectedCwds = new Map([
  ["robyn-web", path.join(expectedRelease, "apps/web")],
  ["robyn-rpc-gateway", expectedRelease],
  ["robyn-api", expectedRelease],
  ["robyn-indexer", expectedRelease],
  ["robyn-keeper", expectedRelease],
  ["robyn-artifacts", expectedRelease],
]);
const endpointNames = [
  "webHealth",
  "discovery",
  "apiHealth",
  "status",
  "rpcHealth",
  "rpcBlock",
  "artifactHealth",
  "alerts",
];
const endpointValues = new Map(endpointNames.map((name) => [name, []]));

let previous;
let maximumGapMs = 0;
let minimumGapMs = Number.POSITIVE_INFINITY;
let minimumAvailableMemoryBytes = Number.POSITIVE_INFINITY;
let minimumAvailableDiskBytes = Number.POSITIVE_INFINITY;
let maximumTotalRssBytes = 0;

for (let index = 0; index < rows.length; index += 1) {
  const sample = rows[index];
  const sampleNumber = index + 1;
  if (sample.error) fail(`sample ${sampleNumber} records error: ${sample.error}`);
  if (sample.gitSha !== expectedSha) fail(`sample ${sampleNumber} git SHA drift`);
  if (path.resolve(sample.releasePath) !== expectedRelease) {
    fail(`sample ${sampleNumber} release path drift`);
  }
  const sampledAtMs = Date.parse(sample.sampledAt);
  if (!Number.isFinite(sampledAtMs)) fail(`sample ${sampleNumber} timestamp invalid`);
  if (!Number.isInteger(sample.chainBlock) || sample.chainBlock < 0) {
    fail(`sample ${sampleNumber} chain block invalid`);
  }
  const indexedBlock = Number(sample.status?.asOfBlock);
  const launchCount = Number(sample.status?.launchCount);
  const rawLogCount = Number(sample.status?.rawLogCount);
  if (![indexedBlock, launchCount, rawLogCount].every(Number.isFinite)) {
    fail(`sample ${sampleNumber} indexed state invalid`);
  }
  if (indexedBlock > sample.chainBlock) fail(`sample ${sampleNumber} index ahead of chain`);
  if (sample.status.keeperStatus !== "ok" || sample.status.artifactStatus !== "ok") {
    fail(`sample ${sampleNumber} keeper or artifact degraded`);
  }
  if (sample.firingAlerts !== 0) fail(`sample ${sampleNumber} has firing alerts`);
  if (sample.availableMemoryBytes < minimumMemoryBytes) {
    fail(`sample ${sampleNumber} available memory below threshold`);
  }
  if (sample.availableDiskBytes < minimumDiskBytes) {
    fail(`sample ${sampleNumber} available disk below threshold`);
  }
  if (!Array.isArray(sample.processes) || sample.processes.length !== 6) {
    fail(`sample ${sampleNumber} process set invalid`);
  }
  const seenProcesses = new Set();
  for (const processEntry of sample.processes) {
    if (seenProcesses.has(processEntry.name)) {
      fail(`sample ${sampleNumber} duplicates process ${processEntry.name}`);
    }
    seenProcesses.add(processEntry.name);
    const expectedCwd = expectedCwds.get(processEntry.name);
    if (!expectedCwd) fail(`sample ${sampleNumber} has unexpected process`);
    if (path.resolve(processEntry.cwd) !== expectedCwd) {
      fail(`sample ${sampleNumber} process cwd drift for ${processEntry.name}`);
    }
    if (processEntry.restartCount !== 0) {
      fail(`sample ${sampleNumber} restart count nonzero for ${processEntry.name}`);
    }
    if (!Number.isFinite(processEntry.rssBytes) || processEntry.rssBytes < 0) {
      fail(`sample ${sampleNumber} RSS invalid for ${processEntry.name}`);
    }
  }
  if (seenProcesses.size !== expectedCwds.size) {
    fail(`sample ${sampleNumber} process set incomplete`);
  }
  for (const endpoint of endpointNames) {
    const latency = sample.latenciesMs?.[endpoint];
    if (!Number.isFinite(latency) || latency < 0) {
      fail(`sample ${sampleNumber} latency invalid for ${endpoint}`);
    }
    endpointValues.get(endpoint).push(latency);
  }
  if (previous) {
    const gapMs = sampledAtMs - previous.sampledAtMs;
    if (gapMs <= 0) fail(`sample ${sampleNumber} timestamp did not advance`);
    maximumGapMs = Math.max(maximumGapMs, gapMs);
    minimumGapMs = Math.min(minimumGapMs, gapMs);
    if (sample.chainBlock < previous.chainBlock) fail("chain block moved backward");
    if (indexedBlock < previous.indexedBlock) fail("indexed block moved backward");
    if (launchCount < previous.launchCount) fail("launch count moved backward");
    if (rawLogCount < previous.rawLogCount) fail("raw log count moved backward");
  }
  previous = { sampledAtMs, chainBlock: sample.chainBlock, indexedBlock, launchCount, rawLogCount };
  minimumAvailableMemoryBytes = Math.min(
    minimumAvailableMemoryBytes,
    sample.availableMemoryBytes,
  );
  minimumAvailableDiskBytes = Math.min(
    minimumAvailableDiskBytes,
    sample.availableDiskBytes,
  );
  maximumTotalRssBytes = Math.max(maximumTotalRssBytes, sample.totalRssBytes);
}

const first = rows[0];
const last = rows.at(-1);
const observedSeconds = (Date.parse(last.sampledAt) - Date.parse(first.sampledAt)) / 1000;
const derivedRssGrowthBytes = last.totalRssBytes - first.totalRssBytes;
if (derivedRssGrowthBytes > maximumRssGrowthBytes) {
  fail("derived RSS growth exceeds threshold");
}
const endpointP95Ms = Object.fromEntries(
  endpointNames.map((name) => [name, percentile(endpointValues.get(name), 0.95)]),
);
for (const [name, value] of Object.entries(endpointP95Ms)) {
  if (value > maximumEndpointP95Ms) fail(`${name} p95 exceeds threshold`);
}

let summary;
let cadenceLimitMs;
if (summaryPath) {
  summary = parseJson(summaryPath);
  if (summary.passed !== true || summary.aborted !== false) fail("summary is not passed");
  if (summary.completedDuration !== true) fail("summary duration is incomplete");
  if (summary.errorCount !== 0 || summary.errors?.length !== 0) {
    fail("summary contains errors");
  }
  if (summary.gitSha !== expectedSha || path.resolve(summary.releasePath) !== expectedRelease) {
    fail("summary release identity drift");
  }
  if (summary.requestedDurationSeconds < minimumDurationSeconds) {
    fail("summary requested duration is below the required duration");
  }
  if (summary.elapsedSeconds < summary.requestedDurationSeconds) {
    fail("summary elapsed duration is incomplete");
  }
  if (summary.sampleCount !== rows.length) fail("summary sample count mismatch");
  if (summary.baselineRestarts !== 0 || summary.finalRestarts !== 0) {
    fail("summary restart totals are nonzero");
  }
  if (summary.rssGrowthBytes !== derivedRssGrowthBytes) {
    fail("summary RSS growth does not match raw samples");
  }
  if (summary.rssGrowthBytes > maximumRssGrowthBytes) fail("summary RSS growth too high");
  if (!summary.initialProtocolVerification || !summary.finalProtocolVerification) {
    fail("summary protocol verification is incomplete");
  }
  const expectedMinimumSamples =
    Math.floor(summary.requestedDurationSeconds / summary.intervalSeconds) - 1;
  if (rows.length < expectedMinimumSamples) fail("sample count is below cadence floor");
  cadenceLimitMs = summary.intervalSeconds * 1000 * maximumCadenceMultiplier;
  if (maximumGapMs > cadenceLimitMs) fail("sample cadence gap exceeds threshold");
  for (const endpoint of endpointNames) {
    if (summary.endpointP95Ms?.[endpoint] > maximumEndpointP95Ms) {
      fail(`summary ${endpoint} p95 exceeds threshold`);
    }
  }
} else {
  const inferredIntervalMs = rows.length > 1 ? observedSeconds * 1000 / (rows.length - 1) : null;
  cadenceLimitMs = inferredIntervalMs ? inferredIntervalMs * maximumCadenceMultiplier : null;
  if (cadenceLimitMs && maximumGapMs > cadenceLimitMs) {
    fail("active sample cadence gap exceeds inferred threshold");
  }
}

const result = {
  schemaVersion: 1,
  auditedAt: new Date().toISOString(),
  mode: summary ? "final" : "active-observation",
  passed: summary ? true : null,
  completionPending: !summary,
  samplesPath,
  summaryPath: summaryPath ?? null,
  expectedSha,
  expectedRelease,
  sampleCount: rows.length,
  observedSeconds,
  firstSampledAt: first.sampledAt,
  lastSampledAt: last.sampledAt,
  firstChainBlock: first.chainBlock,
  lastChainBlock: last.chainBlock,
  firstIndexedBlock: Number(first.status.asOfBlock),
  lastIndexedBlock: Number(last.status.asOfBlock),
  maximumGapMs,
  minimumGapMs: Number.isFinite(minimumGapMs) ? minimumGapMs : null,
  cadenceLimitMs,
  minimumAvailableMemoryBytes,
  minimumAvailableDiskBytes,
  maximumTotalRssBytes,
  derivedRssGrowthBytes,
  endpointP95Ms,
  allSamplesExactRelease: true,
  allProcessSetsComplete: true,
  allRestartCountsZero: true,
  allFiringAlertsZero: true,
  allIndexedStateMonotonic: true,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

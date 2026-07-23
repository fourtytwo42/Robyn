#!/usr/bin/env node
import os from "node:os";
import { writeFile } from "node:fs/promises";

function positiveNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(name + " must be a positive number");
  }
  return value;
}

const durationSeconds = positiveNumber("LOAD_DURATION_SECONDS", 60);
const requestsPerSecond = positiveNumber("LOAD_REQUESTS_PER_SECOND", 25);
const concurrency = Math.floor(positiveNumber("LOAD_CONCURRENCY", 25));
const virtualUsers = Math.floor(positiveNumber("LOAD_VIRTUAL_USERS", concurrency));
const p95LimitMs = positiveNumber("LOAD_P95_LIMIT_MS", 500);
const timeoutMs = positiveNumber("LOAD_REQUEST_TIMEOUT_MS", 5_000);
const baseHost = process.env.LOAD_BASE_HOST ?? "127.0.0.1";
const useInternalBackends = process.env.LOAD_USE_INTERNAL_BACKENDS === "true";
const webPort = useInternalBackends ? 3002 : 3000;
const apiPort = useInternalBackends ? 3101 : 3100;
const rpcPort = useInternalBackends ? 8547 : 8546;
const outputPath = process.env.LOAD_OUTPUT;
const endpoints = [
  {
    name: "web-discover",
    url: "http://" + baseHost + ":" + webPort + "/discover",
    init: { method: "GET" },
    validate: (status, body) =>
      status === 200 &&
      body.includes("<title>Robyn") &&
      body.includes("24h reward markets"),
  },
  {
    name: "api-status",
    url: "http://" + baseHost + ":" + apiPort + "/status",
    init: { method: "GET" },
    validate: (status, body) => {
      if (status !== 200) return false;
      const value = JSON.parse(body);
      return value.chainId === 31337 && value.asOfBlock !== null;
    },
  },
  {
    name: "api-launches",
    url: "http://" + baseHost + ":" + apiPort + "/launches?limit=20",
    init: { method: "GET" },
    validate: (status, body) => {
      if (status !== 200) return false;
      const value = JSON.parse(body);
      return Array.isArray(value.data) && value.data.length >= 1;
    },
  },
  {
    name: "rpc-chain",
    url: "http://" + baseHost + ":" + rpcPort + "/",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
    },
    validate: (status, body) =>
      status === 200 && JSON.parse(body).result === "0x7a69",
  },
  {
    name: "rpc-head",
    url: "http://" + baseHost + ":" + rpcPort + "/",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "eth_blockNumber",
        params: [],
      }),
    },
    validate: (status, body) =>
      status === 200 && /^0x[0-9a-f]+$/i.test(JSON.parse(body).result ?? ""),
  },
];

const results = new Map(
  endpoints.map((endpoint) => [
    endpoint.name,
    { latencies: [], ok: 0, failed: 0, statuses: {} },
  ]),
);
let nextEndpoint = 0;
let scheduled = 0;
let active = 0;
let schedulerDone = false;

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(fraction * ordered.length) - 1)];
}

function resources() {
  return {
    freeMemoryBytes: os.freemem(),
    totalMemoryBytes: os.totalmem(),
    loadAverage: os.loadavg(),
  };
}

async function requestOnce(endpoint, virtualUser) {
  const result = results.get(endpoint.name);
  const started = performance.now();
  let status = 0;
  try {
    const response = await fetch(endpoint.url, {
      ...endpoint.init,
      headers: {
        ...endpoint.init.headers,
        "user-agent": "robyn-system-simulation/" + virtualUser,
        "x-robyn-simulated-user": String(virtualUser),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = response.status;
    const body = await response.text();
    if (!endpoint.validate(status, body)) throw new Error("validation failed");
    result.ok += 1;
  } catch {
    result.failed += 1;
  } finally {
    result.latencies.push(performance.now() - started);
    result.statuses[status] = (result.statuses[status] ?? 0) + 1;
  }
}

const before = resources();
const startedAt = new Date();
const startMs = Date.now();
const durationMs = durationSeconds * 1_000;
const intervalMs = 1_000 / requestsPerSecond;

await new Promise((resolve) => {
  const timer = setInterval(() => {
    const elapsed = Date.now() - startMs;
    const shouldHaveScheduled = Math.min(
      Math.floor(elapsed / intervalMs),
      Math.floor(durationMs / intervalMs),
    );
    while (scheduled < shouldHaveScheduled && active < concurrency) {
      const endpoint = endpoints[nextEndpoint % endpoints.length];
      const virtualUser = scheduled % virtualUsers;
      nextEndpoint += 1;
      scheduled += 1;
      active += 1;
      void requestOnce(endpoint, virtualUser).finally(() => {
        active -= 1;
        if (schedulerDone && active === 0) resolve();
      });
    }
    if (elapsed >= durationMs) {
      schedulerDone = true;
      clearInterval(timer);
      if (active === 0) resolve();
    }
  }, Math.max(1, Math.min(20, intervalMs)));
});

const finishedAt = new Date();
const after = resources();
const endpointSummaries = Object.fromEntries(
  [...results].map(([name, result]) => [
    name,
    {
      requests: result.ok + result.failed,
      ok: result.ok,
      failed: result.failed,
      statuses: result.statuses,
      p50Ms: percentile(result.latencies, 0.5),
      p95Ms: percentile(result.latencies, 0.95),
      p99Ms: percentile(result.latencies, 0.99),
      maxMs: result.latencies.length ? Math.max(...result.latencies) : null,
    },
  ]),
);
const totals = Object.values(endpointSummaries).reduce(
  (sum, result) => ({
    requests: sum.requests + result.requests,
    ok: sum.ok + result.ok,
    failed: sum.failed + result.failed,
  }),
  { requests: 0, ok: 0, failed: 0 },
);
const passed =
  totals.requests > 0 &&
  totals.failed === 0 &&
  Object.values(endpointSummaries).every(
    (result) => result.p95Ms !== null && result.p95Ms <= p95LimitMs,
  );
const summary = {
  schemaVersion: 1,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  configuration: {
    baseHost,
    useInternalBackends,
    durationSeconds,
    requestsPerSecond,
    concurrency,
    virtualUsers,
    p95LimitMs,
    timeoutMs,
  },
  totals,
  endpoints: endpointSummaries,
  resources: { before, after },
  passed,
};
const encoded = JSON.stringify(summary, null, 2) + "\n";
if (outputPath) await writeFile(outputPath, encoded, { encoding: "utf8" });
process.stdout.write(encoded);
if (!passed) process.exitCode = 1;

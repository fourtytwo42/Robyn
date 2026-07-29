#!/usr/bin/env node
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadConfig(relativePath, environment = {}) {
  Object.assign(process.env, environment);
  const configPath = path.join(repoRoot, relativePath);
  delete require.cache[require.resolve(configPath)];
  return require(configPath);
}

const devnet = loadConfig("infrastructure/pm2/ecosystem.config.cjs");
const testnet = loadConfig("infrastructure/pm2/ecosystem.testnet.config.cjs", {
  ROBYN_TESTNET_RELEASE_ROOT: "/opt/robyn/releases/validation",
  ROBYN_TESTNET_MANIFEST: "/etc/robyn/testnet-validation.json",
  ROBYN_OPERATOR_KEY_FILE: "/etc/robyn/testnet-operator-key",
  ROBYN_TESTNET_AUTH_ORIGINS: "https://testnet.sherwoodforest.trade",
  ROBYN_TESTNET_SERVER_RPC_URL: "http://192.0.2.10:8547",
  ROBYN_TESTNET_WS_RPC_URL: "wss://example.invalid/testnet",
});

const minimums = new Map([
  ["robyn-web", 512],
  ["robyn-rpc-gateway", 256],
  ["robyn-api", 384],
  ["robyn-indexer", 384],
  ["robyn-keeper", 256],
  ["robyn-artifacts", 384],
  ["robyn-web-testnet", 512],
  ["robyn-api-testnet", 384],
  ["robyn-indexer-testnet", 384],
  ["robyn-projector-testnet", 384],
  ["robyn-keeper-testnet", 512],
  ["robyn-artifacts-testnet", 384],
]);

function memoryMegabytes(value) {
  const match = /^(\d+)M$/.exec(value ?? "");
  if (!match) throw new Error(`invalid PM2 memory budget: ${String(value)}`);
  return Number.parseInt(match[1], 10);
}

const apps = [...devnet.apps, ...testnet.apps];
const names = new Set();

for (const app of apps) {
  if (names.has(app.name)) throw new Error(`duplicate PM2 app: ${app.name}`);
  names.add(app.name);
  const minimum = minimums.get(app.name);
  if (!minimum) throw new Error(`missing reviewed memory floor: ${app.name}`);
  const configured = memoryMegabytes(app.max_memory_restart);
  if (configured < minimum) {
    throw new Error(
      `${app.name} memory budget ${configured}M is below reviewed floor ${minimum}M`,
    );
  }
  if (app.autorestart !== true) {
    throw new Error(`${app.name} must have PM2 autorestart enabled`);
  }
  if (
    (app.name === "robyn-api" || app.name === "robyn-api-testnet") &&
    app.env?.NODE_OPTIONS !== "--max-old-space-size=256"
  ) {
    throw new Error(`${app.name} must use the reviewed V8 heap limit`);
  }
  if (
    (app.name === "robyn-api" || app.name === "robyn-api-testnet") &&
    (app.env?.MALLOC_ARENA_MAX !== "2" ||
      app.env?.MALLOC_TRIM_THRESHOLD_ !== "65536")
  ) {
    throw new Error(`${app.name} must use the reviewed native allocator bounds`);
  }
  if (
    app.name === "robyn-api-testnet" &&
    (app.env?.ROBYN_AUTH_ORIGINS !== "https://testnet.sherwoodforest.trade" ||
      app.env?.API_CORS_ORIGIN !== "https://testnet.sherwoodforest.trade")
  ) {
    throw new Error(
      "robyn-api-testnet must restrict authentication and CORS to the testnet hostname",
    );
  }
  if (
    app.name === "robyn-indexer-testnet" &&
    (app.env?.ROBYN_OPERATOR_WS_RPC_URL !==
      "wss://example.invalid/testnet" ||
      app.env?.INDEXER_RECONCILIATION_MS !== "900000" ||
      app.env?.INDEXER_HEARTBEAT_MS !== "30000" ||
      app.env?.INDEXER_WS_DEBOUNCE_MS !== "500")
  ) {
    throw new Error(
      "robyn-indexer-testnet must use filtered WebSocket wakes with 15-minute reconciliation",
    );
  }
}

for (const name of minimums.keys()) {
  if (!names.has(name)) throw new Error(`reviewed PM2 app is missing: ${name}`);
}

const privateTestnetRpc = "http://192.0.2.10:8547";
for (const name of [
  "robyn-api-testnet",
  "robyn-indexer-testnet",
  "robyn-projector-testnet",
  "robyn-keeper-testnet",
]) {
  const app = testnet.apps.find((candidate) => candidate.name === name);
  if (app?.env?.ROBYN_OPERATOR_RPC_URL !== privateTestnetRpc) {
    throw new Error(`${name} must use the server-only testnet RPC`);
  }
}
const testnetWeb = testnet.apps.find((app) => app.name === "robyn-web-testnet");
if (testnetWeb?.env?.RPC_GATEWAY_HEALTH_URL !== privateTestnetRpc) {
  throw new Error("robyn-web-testnet health checks must use the server-only testnet RPC");
}

delete require.cache[
  require.resolve(
    path.join(repoRoot, "infrastructure/pm2/ecosystem.testnet.config.cjs"),
  )
];
const mainnetHttpRpc = "https://example.invalid/mainnet";
const mainnetWebSocketRpc = "wss://example.invalid/mainnet";
const mainnet = loadConfig("infrastructure/pm2/ecosystem.mainnet.config.cjs", {
  ROBYN_MAINNET_RELEASE_ROOT: "/opt/robyn/mainnet-releases/validation",
  ROBYN_MAINNET_MANIFEST: "/etc/robyn/mainnet-validation.json",
  ROBYN_MAINNET_SERVER_RPC_URL: mainnetHttpRpc,
  ROBYN_MAINNET_WS_RPC_URL: mainnetWebSocketRpc,
  ROBYN_MAINNET_OPERATOR_KEY_FILE: "/etc/robyn/mainnet-operator-key",
});
const mainnetIndexer = mainnet.apps.find(
  (app) => app.name === "robyn-indexer-mainnet",
);
if (
  mainnetIndexer?.env?.ROBYN_OPERATOR_RPC_URL !== mainnetHttpRpc ||
  mainnetIndexer?.env?.ROBYN_OPERATOR_WS_RPC_URL !== mainnetWebSocketRpc ||
  mainnetIndexer?.env?.INDEXER_RECONCILIATION_MS !== "900000" ||
  mainnetIndexer?.env?.INDEXER_HEARTBEAT_MS !== "30000"
) {
  throw new Error(
    "robyn-indexer-mainnet must mirror the filtered WebSocket and 15-minute reconciliation policy",
  );
}
if (
  mainnet.apps.some(
    (app) =>
      app.name !== "robyn-indexer-mainnet" &&
      app.env?.ROBYN_OPERATOR_WS_RPC_URL,
  )
) {
  throw new Error("mainnet WebSocket credentials must be indexer-only");
}

process.stdout.write(
  `${JSON.stringify({
    schemaVersion: 1,
    checkedApps: apps.length,
    checkedMainnetApps: mainnet.apps.length,
    memoryBudgetsMiB: Object.fromEntries(
      apps.map((app) => [app.name, memoryMegabytes(app.max_memory_restart)]),
    ),
    passed: true,
  })}\n`,
);

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
  ["robyn-keeper-testnet", 256],
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
}

for (const name of minimums.keys()) {
  if (!names.has(name)) throw new Error(`reviewed PM2 app is missing: ${name}`);
}

process.stdout.write(
  `${JSON.stringify({
    schemaVersion: 1,
    checkedApps: apps.length,
    memoryBudgetsMiB: Object.fromEntries(
      apps.map((app) => [app.name, memoryMegabytes(app.max_memory_restart)]),
    ),
    passed: true,
  })}\n`,
);

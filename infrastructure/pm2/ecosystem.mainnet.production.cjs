const path = require("node:path");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required production setting: ${name}`);
  return value;
}

for (const name of [
  "PRIVATE_KEY",
  "DEPLOYER_PRIVATE_KEY",
  "MNEMONIC",
  "ROBYN_OPERATOR_KEY_FILE",
  "ROBYN_MAINNET_OPERATOR_KEYSTORE",
  "ROBYN_MAINNET_OPERATOR_PASSWORD_FILE",
  "ROBYN_MAINNET_OPERATOR_KEY_FIFO",
]) {
  if (process.env[name]) {
    throw new Error(
      `Forbidden signer setting on keyless production host: ${name}`,
    );
  }
}

const releaseRoot =
  process.env.ROBYN_PRODUCTION_RELEASE_ROOT || "/opt/robyn/current";
const manifest = path.join(releaseRoot, "deployments/4663-mainnet.json");
const primaryRpcUrl = required("ROBYN_MAINNET_PRIMARY_RPC_URL");
const probeRpcUrl = required("ROBYN_MAINNET_PROBE_RPC_URL");
const database = process.env.ROBYN_MAINNET_DATABASE || "robyn_mainnet_prod";
const authOrigins =
  process.env.ROBYN_MAINNET_AUTH_ORIGINS ||
  "https://sherwoodforest.trade,https://www.sherwoodforest.trade";
const nodeBinary = "/opt/node-v24.18.0-linux-x64/bin/node";
const backendRpcUrl = "http://127.0.0.1:18549";
const commonDatabase = {
  PGHOST: "/var/run/postgresql",
  PGDATABASE: database,
  PGUSER: "robynapp",
};

module.exports = {
  apps: [
    {
      name: "robyn-web-mainnet-prod",
      cwd: path.join(releaseRoot, "apps/web"),
      script: nodeBinary,
      args: `${path.join(releaseRoot, "apps/web/node_modules/next/dist/bin/next")} start --hostname 127.0.0.1`,
      env: {
        NODE_ENV: "production",
        ROBYN_ENV: "robinhood-mainnet",
        ROBYN_NETWORK_MODE: "mainnet",
        CHAIN_ID: "4663",
        HOSTNAME: "127.0.0.1",
        PORT: "3022",
        ROBYN_RELEASE_SHA: required("ROBYN_RELEASE_SHA"),
        RPC_GATEWAY_HEALTH_URL: backendRpcUrl,
        DATA_API_STATUS_URL: "http://127.0.0.1:3121/status",
        DATA_API_URL: "http://127.0.0.1:3121",
      },
      autorestart: true,
      max_memory_restart: "1024M",
      time: true,
    },
    {
      name: "robyn-api-mainnet-prod",
      cwd: releaseRoot,
      script: "/bin/bash",
      args: path.join(releaseRoot, "scripts/start-production-api.sh"),
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=512",
        HOST: "127.0.0.1",
        PORT: "3121",
        CHAIN_ID: "4663",
        ROBYN_QUEUE_NAME: "robyn-conversions-mainnet-prod",
        ROBYN_AUTH_ORIGINS: authOrigins,
        API_CORS_ORIGIN: authOrigins,
        ROBYN_ARTIFACT_SERVICE_URL: "http://127.0.0.1:3220",
        ROBYN_IPFS_API_URL: "http://127.0.0.1:5001",
        ROBYN_OPERATOR_RPC_URL: backendRpcUrl,
        ROBYN_RPC_FAILOVER_STATUS_FILE:
          "/var/lib/robyn/mainnet-rpc-gateway/status.json",
        ROBYN_MANIFEST: manifest,
        ROBYN_RELEASE_SHA: required("ROBYN_RELEASE_SHA"),
        ROBYN_PROTOCOL_AUDIT_INTERVAL_MS: "900000",
        ROBYN_KEEPER_EXPECTED: "false",
        ROBYN_ENDURANCE_STATUS_FILE: "",
        ROBYN_CAMPAIGN_OPERATOR_TOKEN_FILE: "",
        REDIS_URL: "redis://127.0.0.1:6379/2",
        ...commonDatabase,
      },
      autorestart: true,
      max_memory_restart: "768M",
      time: true,
    },
    {
      name: "robyn-indexer-mainnet-prod",
      cwd: releaseRoot,
      script: nodeBinary,
      args: path.join(releaseRoot, "apps/indexer/dist/server.js"),
      env: {
        NODE_ENV: "production",
        ROBYN_OPERATOR_RPC_URL: backendRpcUrl,
        ROBYN_OPERATOR_WS_RPC_URL: "",
        ROBYN_MANIFEST: manifest,
        ROBYN_INDEXER_ROLE: "ingester",
        INDEXER_RECONCILIATION_MS: "900000",
        INDEXER_HEARTBEAT_MS: "5000",
        INDEXER_MAXIMUM_OBSERVED_LAG_BLOCKS: "25",
        INDEXER_BLOCK_RANGE: "10000",
        INDEXER_BLOCK_READ_CONCURRENCY: "3",
        INDEXER_MAXIMUM_CONSECUTIVE_FAILURES: "24",
        ROBYN_RPC_RETRY_COUNT: "5",
        ROBYN_RPC_RETRY_DELAY_MS: "500",
        ROBYN_RPC_TIMEOUT_MS: "15000",
        ...commonDatabase,
      },
      autorestart: true,
      max_memory_restart: "768M",
      time: true,
    },
    {
      name: "robyn-projector-mainnet-prod",
      cwd: releaseRoot,
      script: nodeBinary,
      args: path.join(releaseRoot, "apps/indexer/dist/server.js"),
      env: {
        NODE_ENV: "production",
        ROBYN_OPERATOR_RPC_URL: backendRpcUrl,
        ROBYN_MANIFEST: manifest,
        ROBYN_INDEXER_ROLE: "projector",
        PROJECTOR_POLL_MS: "1000",
        INDEXER_MAXIMUM_CONSECUTIVE_FAILURES: "24",
        ROBYN_RPC_RETRY_COUNT: "5",
        ROBYN_RPC_RETRY_DELAY_MS: "500",
        ROBYN_RPC_TIMEOUT_MS: "15000",
        ...commonDatabase,
      },
      autorestart: true,
      max_memory_restart: "768M",
      time: true,
    },
    {
      name: "robyn-artifacts-mainnet-prod",
      cwd: releaseRoot,
      script: "/bin/bash",
      args: path.join(releaseRoot, "scripts/start-production-artifacts.sh"),
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3220",
        MAX_ARTIFACT_BYTES: "8388608",
        ...commonDatabase,
      },
      autorestart: true,
      max_memory_restart: "768M",
      time: true,
    },
    {
      name: "robyn-rpc-gateway-mainnet-prod",
      cwd: releaseRoot,
      script: nodeBinary,
      args: path.join(releaseRoot, "apps/rpc-gateway/dist/failover-server.js"),
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "18549",
        EXPECTED_CHAIN_ID: "4663",
        PRIMARY_RPC_URL: primaryRpcUrl,
        FALLBACK_RPC_URL: probeRpcUrl,
        RPC_ACTIVE_PROVIDER: "primary",
        RPC_FALLBACK_TRAFFIC_AUTHORIZED: "false",
        RPC_TRANSACTION_SUBMISSION_AUTHORIZED:
          process.env.ROBYN_MAINNET_TRANSACTION_SUBMISSION_AUTHORIZED ||
          "false",
        RPC_PROBE_INTERVAL_MS: "30000",
        RPC_MAX_HEAD_LAG_BLOCKS: "50",
        RPC_RECOVERY_HEAD_LAG_BLOCKS: "10",
        RPC_RECOVERY_CONSECUTIVE_PROBES: "2",
        RPC_UPSTREAM_TIMEOUT_MS: "15000",
        RPC_UPSTREAM_RETRY_COUNT: "3",
        RPC_UPSTREAM_RETRY_DELAY_MS: "250",
        RPC_STATUS_FILE: "/var/lib/robyn/mainnet-rpc-gateway/status.json",
        RPC_SERVICE_NAME: "robyn-mainnet-production-rpc-gateway",
      },
      autorestart: true,
      max_memory_restart: "384M",
      time: true,
    },
  ],
};

const path = require("node:path");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required testnet setting: ${name}`);
  return value;
}

const releaseRoot = required("ROBYN_TESTNET_RELEASE_ROOT");
const releaseSha = path.basename(releaseRoot);
const manifest = required("ROBYN_TESTNET_MANIFEST");
const rpcUrl =
  process.env.ROBYN_TESTNET_SERVER_RPC_URL ||
  process.env.ROBYN_TESTNET_RPC_URL ||
  "https://rpc.testnet.chain.robinhood.com";
const primaryRpcUrl = process.env.ROBYN_TESTNET_PRIMARY_RPC_URL || "";
const failoverEnabled = primaryRpcUrl.length > 0;
const backendRpcUrl = failoverEnabled ? "http://127.0.0.1:18547" : rpcUrl;
const wsRpcUrl = process.env.ROBYN_TESTNET_WS_RPC_URL || "";
const operatorKeyFile = required("ROBYN_OPERATOR_KEY_FILE");
const nodeBinary = "/opt/node-v24.18.0-linux-x64/bin/node";
const database = process.env.ROBYN_TESTNET_DATABASE || "robyn_testnet";
const authOrigins =
  process.env.ROBYN_TESTNET_AUTH_ORIGINS || "http://127.0.0.1:3012";

module.exports = {
  apps: [
    ...(failoverEnabled
      ? [
          {
            name: "robyn-rpc-gateway-testnet",
            cwd: releaseRoot,
            script: nodeBinary,
            args: path.join(
              releaseRoot,
              "apps/rpc-gateway/dist/failover-server.js",
            ),
            env: {
              NODE_ENV: "production",
              HOST: "127.0.0.1",
              PORT: "18547",
              EXPECTED_CHAIN_ID: "46630",
              PRIMARY_RPC_URL: primaryRpcUrl,
              FALLBACK_RPC_URL: rpcUrl,
              RPC_PROBE_INTERVAL_MS: "30000",
              RPC_MAX_HEAD_LAG_BLOCKS: "50",
              RPC_RECOVERY_HEAD_LAG_BLOCKS: "10",
              RPC_RECOVERY_CONSECUTIVE_PROBES: "2",
              RPC_UPSTREAM_TIMEOUT_MS: "15000",
              RPC_STATUS_FILE: "/var/lib/robyn/testnet-rpc-gateway/status.json",
            },
            autorestart: true,
            max_memory_restart: "256M",
            time: true,
          },
        ]
      : []),
    {
      name: "robyn-web-testnet",
      cwd: path.join(releaseRoot, "apps/web"),
      script: nodeBinary,
      args: `${path.join(releaseRoot, "apps/web/node_modules/next/dist/bin/next")} start --hostname 127.0.0.1`,
      env: {
        NODE_ENV: "production",
        ROBYN_ENV: "robinhood-testnet",
        ROBYN_NETWORK_MODE: "testnet",
        CHAIN_ID: "46630",
        HOSTNAME: "127.0.0.1",
        ROBYN_RELEASE_SHA: releaseSha,
        RPC_GATEWAY_HEALTH_URL: backendRpcUrl,
        DATA_API_STATUS_URL: "http://127.0.0.1:3111/status",
        DATA_API_URL: "http://127.0.0.1:3111",
        PORT: "3012",
      },
      autorestart: true,
      max_memory_restart: "512M",
      time: true,
    },
    {
      name: "robyn-api-testnet",
      cwd: releaseRoot,
      script: "/bin/bash",
      args: path.join(releaseRoot, "scripts/start-testnet-api.sh"),
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=256",
        MALLOC_ARENA_MAX: "2",
        MALLOC_TRIM_THRESHOLD_: "65536",
        HOST: "127.0.0.1",
        PORT: "3111",
        CHAIN_ID: "46630",
        ROBYN_QUEUE_NAME: "robyn-conversions-testnet",
        ROBYN_AUTH_ORIGINS: authOrigins,
        API_CORS_ORIGIN: authOrigins,
        ROBYN_ARTIFACT_SERVICE_URL: "http://127.0.0.1:3210",
        ROBYN_OPERATOR_RPC_URL: backendRpcUrl,
        ROBYN_RPC_FAILOVER_STATUS_FILE:
          "/var/lib/robyn/testnet-rpc-gateway/status.json",
        ROBYN_MANIFEST: manifest,
        ROBYN_RELEASE_SHA: releaseSha,
        ROBYN_PROTOCOL_AUDIT_INTERVAL_MS: "900000",
        ROBYN_ENDURANCE_STATUS_FILE:
          process.env.ROBYN_ENDURANCE_STATUS_FILE ||
          "/var/lib/robyn/testnet-endurance/active/state.json",
        ROBYN_CAMPAIGN_OPERATOR_TOKEN_FILE:
          process.env.ROBYN_CAMPAIGN_OPERATOR_TOKEN_FILE || "",
        ROBYN_TESTNET_RELEASE_ROOT: releaseRoot,
        ROBYN_TESTNET_API_ENV_FILE:
          process.env.ROBYN_TESTNET_API_ENV_FILE ||
          "/etc/robyn/testnet-api.env",
        ROBYN_TESTNET_REQUIRE_REMOTE_PIN:
          process.env.ROBYN_TESTNET_REQUIRE_REMOTE_PIN || "true",
        REDIS_URL: "redis://127.0.0.1:6379/1",
        PGHOST: "/var/run/postgresql",
        PGDATABASE: database,
        PGUSER: "hendo420",
      },
      autorestart: true,
      max_memory_restart: "384M",
      time: true,
    },
    {
      name: "robyn-indexer-testnet",
      cwd: releaseRoot,
      script: nodeBinary,
      args: path.join(releaseRoot, "apps/indexer/dist/server.js"),
      env: {
        NODE_ENV: "production",
        ROBYN_OPERATOR_RPC_URL: backendRpcUrl,
        ROBYN_OPERATOR_WS_RPC_URL: wsRpcUrl,
        ROBYN_MANIFEST: manifest,
        ROBYN_INDEXER_ROLE: "ingester",
        INDEXER_RECONCILIATION_MS: "900000",
        INDEXER_HEARTBEAT_MS: "30000",
        INDEXER_WS_DEBOUNCE_MS: "500",
        INDEXER_BLOCK_RANGE: "10000",
        INDEXER_BLOCK_READ_CONCURRENCY: "3",
        INDEXER_MAXIMUM_CONSECUTIVE_FAILURES: "24",
        ROBYN_RPC_RETRY_COUNT: "5",
        ROBYN_RPC_RETRY_DELAY_MS: "500",
        ROBYN_RPC_TIMEOUT_MS: "15000",
        PGHOST: "/var/run/postgresql",
        PGDATABASE: database,
        PGUSER: "hendo420",
      },
      autorestart: true,
      max_memory_restart: "384M",
      time: true,
    },
    {
      name: "robyn-projector-testnet",
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
        PGHOST: "/var/run/postgresql",
        PGDATABASE: database,
        PGUSER: "hendo420",
      },
      autorestart: true,
      max_memory_restart: "384M",
      time: true,
    },
    {
      name: "robyn-keeper-testnet",
      cwd: releaseRoot,
      script: nodeBinary,
      args: path.join(releaseRoot, "apps/keeper/dist/server.js"),
      env: {
        NODE_ENV: "production",
        ROBYN_ENV: "robinhood-testnet",
        ROBYN_OPERATOR_RPC_URL: backendRpcUrl,
        ROBYN_OPERATOR_KEY_FILE: operatorKeyFile,
        ROBYN_MANIFEST: manifest,
        ROBYN_QUEUE_NAME: "robyn-conversions-testnet",
        REDIS_URL: "redis://127.0.0.1:6379/1",
        KEEPER_SCAN_MS: "900000",
        KEEPER_REQUEST_POLL_MS: "1000",
        KEEPER_HEARTBEAT_MS: "10000",
        ROBYN_RPC_RETRY_COUNT: "5",
        ROBYN_RPC_RETRY_DELAY_MS: "500",
        ROBYN_RPC_TIMEOUT_MS: "15000",
        PGHOST: "/var/run/postgresql",
        PGDATABASE: database,
        PGUSER: "hendo420",
      },
      autorestart: true,
      max_memory_restart: "512M",
      time: true,
    },
    {
      name: "robyn-artifacts-testnet",
      cwd: releaseRoot,
      script: "/bin/bash",
      args: "scripts/start-artifact-service.sh",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3210",
        MAX_ARTIFACT_BYTES: "2097152",
        PGHOST: "/var/run/postgresql",
        PGDATABASE: database,
        PGUSER: "hendo420",
      },
      autorestart: true,
      max_memory_restart: "384M",
      time: true,
    },
  ],
};

const path = require("node:path");

const releaseRoot =
  process.env.ROBYN_RELEASE_ROOT || path.resolve(__dirname, "../..");
const nodeBinary = "/opt/node-v24.18.0-linux-x64/bin/node";
const database =
  process.env.ROBYN_SCHEMA20_DATABASE ||
  "robyn_devnet_schema20_marketing_dd7afcf";

module.exports = {
  apps: [
    {
      name: "robyn-schema20-web-preview",
      cwd: path.join(releaseRoot, "apps/web"),
      script: nodeBinary,
      args: `${path.join(releaseRoot, "apps/web/node_modules/next/dist/bin/next")} start --hostname 127.0.0.1`,
      env: {
        NODE_ENV: "production",
        ROBYN_ENV: "robyn-devnet",
        ROBYN_NETWORK_MODE: "devnet",
        NEXT_PUBLIC_ROBYN_NETWORK_MODE: "devnet",
        NEXT_PUBLIC_ROBYN_RPC_URL: "/rpc",
        NEXT_PUBLIC_APP_URL: "http://192.168.50.250:33000",
        HOSTNAME: "127.0.0.1",
        RPC_GATEWAY_HEALTH_URL: "http://127.0.0.1:28547/health",
        DATA_API_STATUS_URL: "http://127.0.0.1:33101/status",
        DATA_API_URL: "http://127.0.0.1:33101",
        PORT: "33002",
      },
      autorestart: true,
      max_memory_restart: "512M",
      time: true,
    },
    {
      name: "robyn-schema20-rpc-preview",
      cwd: releaseRoot,
      script: nodeBinary,
      args: path.join(releaseRoot, "apps/rpc-gateway/dist/server.js"),
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "28547",
        RAW_RPC_URL: "http://127.0.0.1:28549",
        REDIS_URL: "redis://127.0.0.1:6379",
      },
      autorestart: true,
      max_memory_restart: "256M",
      time: true,
    },
    {
      name: "robyn-schema20-api-preview",
      cwd: releaseRoot,
      script: nodeBinary,
      args: path.join(releaseRoot, "apps/api/dist/server.js"),
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "33101",
        CHAIN_ID: "31337",
        ROBYN_MANIFEST: path.join(releaseRoot, "deployments/31337.json"),
        ROBYN_OPERATOR_RPC_URL: "http://127.0.0.1:28549",
        REDIS_URL: "redis://127.0.0.1:6379",
        ROBYN_AUTH_ORIGINS:
          "http://192.168.50.250:33000,http://127.0.0.1:33002",
        ROBYN_ARTIFACT_SERVICE_URL: "http://127.0.0.1:33200",
        PGHOST: "/var/run/postgresql",
        PGDATABASE: database,
        PGUSER: "hendo420",
      },
      autorestart: true,
      max_memory_restart: "384M",
      time: true,
    },
    {
      name: "robyn-schema20-indexer-preview",
      cwd: releaseRoot,
      script: nodeBinary,
      args: path.join(releaseRoot, "apps/indexer/dist/server.js"),
      env: {
        NODE_ENV: "production",
        ROBYN_OPERATOR_RPC_URL: "http://127.0.0.1:28549",
        ROBYN_MANIFEST: path.join(releaseRoot, "deployments/31337.json"),
        INDEXER_POLL_MS: "1000",
        INDEXER_HEARTBEAT_MS: "1000",
        PGHOST: "/var/run/postgresql",
        PGDATABASE: database,
        PGUSER: "hendo420",
      },
      autorestart: true,
      max_memory_restart: "384M",
      time: true,
    },
    {
      name: "robyn-schema20-artifacts-preview",
      cwd: releaseRoot,
      script: "/bin/bash",
      args: "scripts/start-artifact-service.sh",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "33200",
        MAX_ARTIFACT_BYTES: "8388608",
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

const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");
const nodeBinary = "/opt/node-v24.18.0-linux-x64/bin/node";

module.exports = {
  apps: [
    {
      name: "robyn-api-preview",
      cwd: repoRoot,
      script: nodeBinary,
      args: path.join(repoRoot, "apps/api/dist/server.js"),
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3103",
        CHAIN_ID: "31337",
        PGHOST: "/var/run/postgresql",
        PGDATABASE: "robyn",
        PGUSER: "hendo420",
        ROBYN_DEMO_MARKET_CHANGES: "true",
        REDIS_URL: "redis://127.0.0.1:6379",
        ROBYN_AUTH_ORIGINS:
          "https://fridge-bikini-arrangement-cottage.trycloudflare.com,http://127.0.0.1:3003,http://localhost:3003",
        ROBYN_ARTIFACT_SERVICE_URL: "http://127.0.0.1:3200",
      },
      autorestart: true,
      max_memory_restart: "1024M",
      time: true,
    },
    {
      name: "robyn-web-preview",
      cwd: path.join(repoRoot, "apps/web"),
      script: nodeBinary,
      args: `${path.join(repoRoot, "apps/web/node_modules/next/dist/bin/next")} start --hostname 127.0.0.1`,
      env: {
        NODE_ENV: "production",
        ROBYN_ENV: "robyn-devnet",
        ROBYN_NETWORK_MODE: "devnet",
        NEXT_PUBLIC_ROBYN_NETWORK_MODE: "devnet",
        NEXT_PUBLIC_ROBYN_RPC_URL: "/rpc",
        HOSTNAME: "127.0.0.1",
        RPC_GATEWAY_HEALTH_URL: "http://127.0.0.1:8547/health",
        DATA_API_STATUS_URL: "http://127.0.0.1:3103/status",
        DATA_API_URL: "http://127.0.0.1:3103",
        PORT: "3003",
      },
      autorestart: true,
      max_memory_restart: "384M",
      time: true,
    },
  ],
};

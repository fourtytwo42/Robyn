const path = require("node:path");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required mainnet setting: ${name}`);
  return value;
}

const releaseRoot = required("ROBYN_MAINNET_RELEASE_ROOT");
const manifest = required("ROBYN_MAINNET_MANIFEST");
const primaryRpcUrl = required("ROBYN_MAINNET_PRIMARY_RPC_URL");
const fallbackRpcUrl = required("ROBYN_MAINNET_SERVER_RPC_URL");
const backendRpcUrl = "http://127.0.0.1:18549";
const wsRpcUrl = required("ROBYN_MAINNET_WS_RPC_URL");
const toolingRoot = required("ROBYN_MAINNET_TOOLING_ROOT");
const operatorKeystore = required("ROBYN_MAINNET_OPERATOR_KEYSTORE");
const operatorPasswordFile = required("ROBYN_MAINNET_OPERATOR_PASSWORD_FILE");
const operatorKeyFile =
  process.env.ROBYN_MAINNET_OPERATOR_KEY_FIFO ||
  `/run/user/${process.getuid()}/robyn-mainnet-keeper-key.fifo`;
const database = process.env.ROBYN_MAINNET_DATABASE || "robyn_mainnet";
const authOrigins =
  process.env.ROBYN_MAINNET_AUTH_ORIGINS || "https://sherwoodforest.trade";

// Reuse the audited public-service process topology while replacing every
// environment identity, port, queue and datastore namespace before export.
process.env.ROBYN_TESTNET_RELEASE_ROOT = releaseRoot;
process.env.ROBYN_TESTNET_MANIFEST = manifest;
process.env.ROBYN_TESTNET_PRIMARY_RPC_URL = primaryRpcUrl;
process.env.ROBYN_TESTNET_SERVER_RPC_URL = fallbackRpcUrl;
process.env.ROBYN_TESTNET_RPC_ACTIVE_PROVIDER =
  process.env.ROBYN_MAINNET_RPC_ACTIVE_PROVIDER || "primary";
process.env.ROBYN_TESTNET_RPC_FALLBACK_TRAFFIC_AUTHORIZED =
  process.env.ROBYN_MAINNET_RPC_FALLBACK_TRAFFIC_AUTHORIZED || "false";
process.env.ROBYN_TESTNET_WS_RPC_URL = wsRpcUrl;
process.env.ROBYN_OPERATOR_KEY_FILE = operatorKeyFile;
process.env.ROBYN_TESTNET_DATABASE = database;
process.env.ROBYN_TESTNET_AUTH_ORIGINS = authOrigins;
process.env.ROBYN_TESTNET_API_ENV_FILE =
  process.env.ROBYN_MAINNET_API_ENV_FILE || "/etc/robyn/mainnet-api.env";
process.env.ROBYN_TESTNET_REQUIRE_REMOTE_PIN =
  process.env.ROBYN_MAINNET_REQUIRE_REMOTE_PIN || "true";
process.env.ROBYN_CAMPAIGN_OPERATOR_TOKEN_FILE = "";

const topology = require("./ecosystem.testnet.config.cjs");
const ports = {
  web: "3022",
  api: "3121",
  artifacts: "3220",
};

module.exports = {
  apps: topology.apps.map((app) => {
    const name = app.name.replace(/-testnet$/, "-mainnet");
    const env = {
      ...app.env,
      ROBYN_ENV: "robinhood-mainnet",
      ROBYN_NETWORK_MODE: "mainnet",
      CHAIN_ID: "4663",
      ROBYN_RELEASE_SHA: app.env.ROBYN_RELEASE_SHA,
      ROBYN_OPERATOR_RPC_URL: backendRpcUrl,
      ROBYN_OPERATOR_WS_RPC_URL:
        name === "robyn-indexer-mainnet" ? wsRpcUrl : "",
      RPC_GATEWAY_HEALTH_URL: backendRpcUrl,
      ROBYN_RPC_FAILOVER_STATUS_FILE:
        "/var/lib/robyn/mainnet-rpc-gateway/status.json",
      ROBYN_MANIFEST: manifest,
      PGDATABASE: database,
      REDIS_URL: "redis://127.0.0.1:6379/2",
      ROBYN_QUEUE_NAME: "robyn-conversions-mainnet",
      ROBYN_AUTH_ORIGINS: authOrigins,
      API_CORS_ORIGIN: authOrigins,
      ROBYN_ARTIFACT_SERVICE_URL: `http://127.0.0.1:${ports.artifacts}`,
      DATA_API_STATUS_URL: `http://127.0.0.1:${ports.api}/status`,
      DATA_API_URL: `http://127.0.0.1:${ports.api}`,
      ROBYN_ENDURANCE_STATUS_FILE:
        "/var/lib/robyn/mainnet-operations/status.json",
      ROBYN_CAMPAIGN_OPERATOR_TOKEN_FILE: "",
      ROBYN_TESTNET_API_ENV_FILE:
        process.env.ROBYN_MAINNET_API_ENV_FILE || "/etc/robyn/mainnet-api.env",
      ROBYN_TESTNET_REQUIRE_REMOTE_PIN:
        process.env.ROBYN_MAINNET_REQUIRE_REMOTE_PIN || "true",
    };

    if (name === "robyn-rpc-gateway-mainnet") {
      Object.assign(env, {
        ROBYN_ENV: "robinhood-mainnet",
        CHAIN_ID: "4663",
        HOST: "127.0.0.1",
        PORT: "18549",
        EXPECTED_CHAIN_ID: "4663",
        PRIMARY_RPC_URL: primaryRpcUrl,
        FALLBACK_RPC_URL: fallbackRpcUrl,
        RPC_ACTIVE_PROVIDER:
          process.env.ROBYN_MAINNET_RPC_ACTIVE_PROVIDER || "primary",
        RPC_FALLBACK_TRAFFIC_AUTHORIZED:
          process.env.ROBYN_MAINNET_RPC_FALLBACK_TRAFFIC_AUTHORIZED || "false",
        RPC_SERVICE_NAME: "robyn-mainnet-rpc-gateway",
        RPC_STATUS_FILE: "/var/lib/robyn/mainnet-rpc-gateway/status.json",
      });
    }

    if (name === "robyn-web-mainnet") env.PORT = ports.web;
    if (name === "robyn-api-mainnet") env.PORT = ports.api;
    if (name === "robyn-artifacts-mainnet") env.PORT = ports.artifacts;

    if (name === "robyn-keeper-mainnet") {
      Object.assign(env, {
        ROBYN_MAINNET_RELEASE_ROOT: releaseRoot,
        ROBYN_MAINNET_TOOLING_ROOT: toolingRoot,
        ROBYN_MAINNET_OPERATOR_KEYSTORE: operatorKeystore,
        ROBYN_MAINNET_OPERATOR_PASSWORD_FILE: operatorPasswordFile,
        ROBYN_MAINNET_OPERATOR_KEY_FIFO: operatorKeyFile,
      });
    }

    return {
      ...app,
      name,
      env,
      ...(name === "robyn-keeper-mainnet"
        ? {
            cwd: toolingRoot,
            script: "/bin/bash",
            args: path.join(
              toolingRoot,
              "scripts/start-schema18-mainnet-keeper-secure.sh",
            ),
          }
        : {}),
    };
  }),
};

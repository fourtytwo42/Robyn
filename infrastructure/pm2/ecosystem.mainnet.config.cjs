function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required mainnet setting: ${name}`);
  return value;
}

const releaseRoot = required("ROBYN_MAINNET_RELEASE_ROOT");
const manifest = required("ROBYN_MAINNET_MANIFEST");
const rpcUrl = required("ROBYN_MAINNET_SERVER_RPC_URL");
const wsRpcUrl = required("ROBYN_MAINNET_WS_RPC_URL");
const operatorKeyFile = required("ROBYN_MAINNET_OPERATOR_KEY_FILE");
const database = process.env.ROBYN_MAINNET_DATABASE || "robyn_mainnet";
const authOrigins =
  process.env.ROBYN_MAINNET_AUTH_ORIGINS || "https://sherwoodforest.trade";

// Reuse the audited public-service process topology while replacing every
// environment identity, port, queue and datastore namespace before export.
process.env.ROBYN_TESTNET_RELEASE_ROOT = releaseRoot;
process.env.ROBYN_TESTNET_MANIFEST = manifest;
process.env.ROBYN_TESTNET_SERVER_RPC_URL = rpcUrl;
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
      ROBYN_OPERATOR_RPC_URL: rpcUrl,
      ROBYN_OPERATOR_WS_RPC_URL:
        name === "robyn-indexer-mainnet" ? wsRpcUrl : "",
      RPC_GATEWAY_HEALTH_URL: rpcUrl,
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

    if (name === "robyn-web-mainnet") env.PORT = ports.web;
    if (name === "robyn-api-mainnet") env.PORT = ports.api;
    if (name === "robyn-artifacts-mainnet") env.PORT = ports.artifacts;

    return {
      ...app,
      name,
      env,
    };
  }),
};

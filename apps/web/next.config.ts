import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const networkMode = process.env.ROBYN_NETWORK_MODE ?? "devnet";
if (networkMode !== "devnet" && networkMode !== "testnet") {
  throw new Error(`Unsupported ROBYN_NETWORK_MODE: ${networkMode}`);
}
const deploymentPath =
  process.env.ROBYN_DEPLOYMENT_PATH ??
  path.resolve(webRoot, "../../deployments/31337.json");
const suffix = networkMode === "testnet" ? "testnet" : "devnet";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  webpack(config) {
    config.resolve.alias["@robyn/deployment"] = deploymentPath;
    config.resolve.alias["@robyn/network-console"] = path.resolve(
      webRoot,
      `src/components/network-console.${suffix}.tsx`,
    );
    config.resolve.alias["@robyn/network-launchpad"] = path.resolve(
      webRoot,
      `src/components/network-launchpad.${suffix}.tsx`,
    );
    config.resolve.alias["@robyn/network-portfolio"] = path.resolve(
      webRoot,
      `src/components/network-portfolio.${suffix}.tsx`,
    );
    config.resolve.alias["@robyn/network-token-trade"] = path.resolve(
      webRoot,
      `src/components/token-trade-panel.${suffix}.tsx`,
    );
    return config;
  },
};

export default nextConfig;

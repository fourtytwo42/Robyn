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
const publicRpcUrl =
  process.env.NEXT_PUBLIC_ROBYN_RPC_URL ??
  "https://rpc.testnet.chain.robinhood.com";
const rpcOrigin = new URL(publicRpcUrl, "http://localhost").origin;

const reproducibleBuildId = process.env.ROBYN_BUILD_ID;
const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(reproducibleBuildId
    ? { generateBuildId: async () => reproducibleBuildId }
    : {}),
  // Exact releases are intentionally read-only. Disable the runtime image
  // optimizer so Next never attempts to create .next/cache/images inside an
  // immutable release; uploaded artwork is already sanitized and re-encoded.
  images: {
    unoptimized: true,
  },
  async headers() {
    if (networkMode !== "testnet") return [];
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "connect-src 'self'",
              rpcOrigin,
              "https://relay.walletconnect.com",
              "wss://relay.walletconnect.com",
              "https://*.walletconnect.com",
              "wss://*.walletconnect.com",
              "https://*.walletconnect.org",
              "wss://*.walletconnect.org",
            ].join(" "),
          },
        ],
      },
    ];
  },
  webpack(config) {
    if (networkMode === "testnet") {
      // Optional React Native persistence and pretty-print logging are not
      // browser capabilities. Their callers provide web-safe fallbacks.
      config.resolve.alias["@react-native-async-storage/async-storage"] = false;
      config.resolve.alias["pino-pretty"] = false;
    }
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
    config.resolve.alias["@robyn/network-creator-portfolio"] = path.resolve(
      webRoot,
      `src/components/network-creator-portfolio.${suffix}.tsx`,
    );
    config.resolve.alias["@robyn/network-creator-rewards"] = path.resolve(
      webRoot,
      `src/components/network-creator-rewards.${suffix}.tsx`,
    );
    config.resolve.alias["@robyn/network-dao"] = path.resolve(
      webRoot,
      `src/components/network-dao.${suffix}.tsx`,
    );
    config.resolve.alias["@robyn/network-token-trade"] = path.resolve(
      webRoot,
      `src/components/token-trade-panel.${suffix}.tsx`,
    );
    config.resolve.alias["@robyn/network-wallet-provider"] = path.resolve(
      webRoot,
      `src/components/network-wallet-provider.${suffix}.tsx`,
    );
    config.resolve.alias["@robyn/network-wallet-control"] = path.resolve(
      webRoot,
      `src/components/network-wallet-control.${suffix}.tsx`,
    );
    return config;
  },
};

export default nextConfig;

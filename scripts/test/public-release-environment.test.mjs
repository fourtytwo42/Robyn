import test from "node:test";
import assert from "node:assert/strict";
import { validatePublicReleaseEnvironment } from "../validate-public-release-environment.mjs";

const addresses = {
  factory: "0x0000000000000000000000000000000000000001",
};

test("accepts the isolated testnet profile", () => {
  assert.deepEqual(
    validatePublicReleaseEnvironment({
      mode: "testnet",
      manifest: {
        chainId: 46630,
        environment: "robinhood-testnet",
        contracts: addresses,
      },
      appUrl: "https://testnet.sherwoodforest.trade",
      rpcUrl: "https://rpc.testnet.chain.robinhood.com",
      explorerUrl: "https://explorer.testnet.chain.robinhood.com",
    }),
    [],
  );
});

test("accepts a clean mainnet profile", () => {
  assert.deepEqual(
    validatePublicReleaseEnvironment({
      mode: "mainnet",
      manifest: {
        chainId: 4663,
        environment: "robinhood-mainnet",
        contracts: addresses,
        assetCatalog: { assets: [{ mockOnly: false }] },
      },
      appUrl: "https://sherwoodforest.trade",
      rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
      explorerUrl: "https://robinhoodchain.blockscout.com",
    }),
    [],
  );
});

test("rejects cross-wired chains, hosts and test assets", () => {
  const errors = validatePublicReleaseEnvironment({
    mode: "mainnet",
    manifest: {
      chainId: 46630,
      environment: "robinhood-testnet",
      contracts: addresses,
      assetCatalog: {
        assets: [{ mockOnly: true, verification: "robyn-testnet-mock" }],
      },
    },
    appUrl: "https://testnet.sherwoodforest.trade",
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorerUrl: "https://explorer.testnet.chain.robinhood.com",
  });
  assert.ok(errors.length >= 4);
});

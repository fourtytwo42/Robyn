import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSchema17BootstrapCalls,
  predictSchema17Deployments,
  SCHEMA17_DEPLOYMENT_SEQUENCE,
} from "../lib/schema17-deployment.mjs";

const deployer = "0x0000000000000000000000000000000000000011";
const hook = "0x0000000000000000000000000000000000000022";
const route = {
  fee: 10_000,
  tickSpacing: 200,
  hooks: "0x0000000000000000000000000000000000000000",
  minimumLiquidity: 1n,
  maximumNativeInput: 1_000_000_000_000n,
  referenceTick: 0,
  maximumReferenceTickDeviation: 198,
  enforceReferencePrice: true,
  verificationClass: `0x${"33".repeat(32)}`,
  enabled: true,
};

test("predicts every direct deployment and accounts for the CREATE2 hook transaction", () => {
  const prediction = predictSchema17Deployments({
    deployer,
    startingNonce: 7,
    oracleHook: hook,
  });
  assert.equal(
    prediction.transactions.length,
    SCHEMA17_DEPLOYMENT_SEQUENCE.length,
  );
  assert.equal(prediction.contracts.oracleHook, hook);
  assert.equal(
    prediction.transactions.find((entry) => entry.label === "oracleHook").nonce,
    14,
  );
  assert.equal(
    prediction.transactions.find((entry) => entry.label === "timelock").nonce,
    20,
  );
  assert.equal(prediction.endingNonceExclusive, 22);
  assert.equal(
    new Set(Object.values(prediction.contracts)).size,
    prediction.transactions.length,
  );
});

test("builds exact Canary and Public bootstrap call sets", () => {
  const prediction = predictSchema17Deployments({
    deployer,
    startingNonce: 7,
    oracleHook: hook,
  });
  const [first, second] = buildSchema17BootstrapCalls({
    contracts: prediction.contracts,
    deployer,
    routes: [
      {
        symbol: "GOOGL",
        asset: "0x0000000000000000000000000000000000000044",
        canary: route,
        public: { ...route, maximumNativeInput: 100_000_000_000n },
      },
    ],
    wrappedNativeCanaryCapWei: "1000000000000",
    wrappedNativePublicCapWei: "100000000000",
  });
  assert.deepEqual(
    first.map((call) => call.label),
    [
      "resume-asset-conversions",
      "resume-fee-conversions",
      "enable-GOOGL-canary-route",
      "enable-WETH-canary-route",
      "enter-canary-mode",
    ],
  );
  assert.equal(second[0].label, "install-production-profile");
  assert.equal(second.at(-1).label, "enter-public-mode");
  assert.ok(first.every((call) => call.valueWei === "0"));
  assert.ok(second.every((call) => call.valueWei === "0"));
});

test("requires exact 10% public caps", () => {
  const prediction = predictSchema17Deployments({
    deployer,
    startingNonce: 7,
    oracleHook: hook,
  });
  const common = {
    contracts: prediction.contracts,
    deployer,
    wrappedNativeCanaryCapWei: "1000",
    wrappedNativePublicCapWei: "100",
  };
  assert.throws(
    () =>
      buildSchema17BootstrapCalls({
        ...common,
        routes: [
          {
            symbol: "GOOGL",
            asset: "0x0000000000000000000000000000000000000044",
            canary: route,
            public: { ...route, maximumNativeInput: 2_000_000_000_000n },
          },
        ],
      }),
    /must equal 10%/,
  );
  assert.throws(
    () =>
      buildSchema17BootstrapCalls({
        ...common,
        wrappedNativePublicCapWei: "101",
        routes: [
          {
            symbol: "GOOGL",
            asset: "0x0000000000000000000000000000000000000044",
            canary: route,
            public: { ...route, maximumNativeInput: 100_000_000_000n },
          },
        ],
      }),
    /WETH public cap must equal 10%/,
  );
});

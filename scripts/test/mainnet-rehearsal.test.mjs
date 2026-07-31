import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  intendedMainnetAssets,
  poolIdForRoute,
  validateMainnetRehearsalConfig,
} from "../lib/mainnet-rehearsal.mjs";

const config = JSON.parse(
  await readFile(
    resolve("config/protocol/robinhood-mainnet-rehearsal.json"),
    "utf8",
  ),
);
const supportPolicy = JSON.parse(
  await readFile(
    resolve("config/protocol/robinhood-mainnet-support-policy.json"),
    "utf8",
  ),
);

test("the production rehearsal config freezes the schema-16 v4-only candidate universe", () => {
  assert.deepEqual(validateMainnetRehearsalConfig(config, supportPolicy), []);
  const assets = intendedMainnetAssets(config, supportPolicy);
  assert.equal(assets.length, 11);
  assert.equal(
    new Set(assets.map(({ address }) => address.toLowerCase())).size,
    11,
  );
  assert.deepEqual(
    assets.filter(({ required }) => required).map(({ symbol }) => symbol),
    config.requiredSymbols,
  );
  assert.equal(
    assets.filter(
      ({ executionClass }) => executionClass === "canonical-v4-single-hop",
    ).length,
    10,
  );
  assert.equal(
    assets.filter(
      ({ executionClass }) => executionClass === "direct-native-wrap",
    ).length,
    1,
  );
});

test("the schema-16 config freezes canary, production, and funding safeguards", () => {
  assert.equal(config.market.initialLaunchMode, "Paused");
  assert.deepEqual(config.market.canaryProfile, {
    targetGraduationNative: "10000000000000000",
    actualGraduationNative: "10000000000000000",
    maximumCurvePurchase: "1000000000000000",
  });
  assert.deepEqual(config.market.productionProfile, {
    targetGraduationNative: "6000000000000000000",
    actualGraduationNative: "6000000000000000001",
    maximumCurvePurchase: "500000000000000000",
  });
  assert.deepEqual(config.funding, {
    approvedCeilingWei: "47072920000000000",
    l1EmergencyReserveWei: "10000000000000000",
    l2OperationalReserveWei: "20000000000000000",
    canaryPrincipalWei: "10000000000000000",
    l2GasHeadroomBps: 15000,
    bridgeGasHeadroomBps: 20000,
  });
  assert.deepEqual(config.bridge, {
    method: "depositEth()",
    delayedInbox: {
      address: "0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D",
      runtimeCodeHash:
        "0x69a469ef198a7f785b09fb0783fe42576faef7635e2d56426ec8746bad638e64",
    },
    estimateOnlyUntilFundingGatePasses: true,
  });
});

test("pool IDs are deterministic and sensitive to route configuration", () => {
  const asset = supportPolicy.candidates[0].address;
  const first = poolIdForRoute(asset, config.route);
  const second = poolIdForRoute(asset, config.route);
  const changed = poolIdForRoute(asset, {
    ...config.route,
    fee: 3000,
    tickSpacing: 60,
  });
  assert.match(first, /^0x[0-9a-f]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test("all active Mainnet evidence and fork surfaces identify Schema 16", async () => {
  const files = [
    "scripts/estimate-schema16-mainnet-bridge.mjs",
    "scripts/measure-schema16-mainnet-funding.mjs",
    "scripts/verify-mainnet-production-routes.mjs",
    "scripts/verify-mainnet-governance-deployment.mjs",
    "scripts/validate-mainnet-support-policy.mjs",
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.match(source, /schemaVersion: 16/);
    assert.doesNotMatch(source, /schemaVersion: 14/);
  }
  assert.equal(config.schemaVersion, 16);
  assert.equal(supportPolicy.schemaVersion, 16);
  assert.equal(
    supportPolicy.executionClasses["canonical-v4-single-hop"]
      .supportedBySchema16,
    true,
  );
  assert.equal(
    supportPolicy.executionClasses["direct-native-wrap"].supportedBySchema16,
    true,
  );
  const fork = await readFile(
    "packages/contracts/test/RobinhoodMainnetSchema16Fork.t.sol",
    "utf8",
  );
  assert.match(fork, /contract RobinhoodMainnetSchema16ForkTest/);
});

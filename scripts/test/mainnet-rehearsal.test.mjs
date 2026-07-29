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

test("the production rehearsal config freezes the schema-12 candidate universe", () => {
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
      ({ executionClass }) => executionClass === "pinned-execution-adapter",
    ).length,
    4,
  );
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

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
const catalog = JSON.parse(
  await readFile(
    resolve("config/assets/robinhood-testnet-curated.json"),
    "utf8",
  ),
);

test("the production rehearsal config freezes 23 Stock Tokens and WETH", () => {
  assert.deepEqual(validateMainnetRehearsalConfig(config, catalog), []);
  const assets = intendedMainnetAssets(config, catalog);
  assert.equal(assets.length, 24);
  assert.equal(
    new Set(assets.map(({ address }) => address.toLowerCase())).size,
    24,
  );
  assert.equal(assets.at(-1).symbol, "WETH");
});

test("pool IDs are deterministic and sensitive to route configuration", () => {
  const asset = catalog.assets[0].mainnetAddress;
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

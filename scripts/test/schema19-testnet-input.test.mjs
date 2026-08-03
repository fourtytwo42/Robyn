import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(new URL("../..", import.meta.url).pathname);
const source = await readFile(
  path.join(repo, "scripts/prepare-schema19-testnet-input.mjs"),
  "utf8",
);

test("Testnet input is generated only from exact clean pushed identities", () => {
  assert.match(
    source,
    /Schema-18 governance and Schema-16 route source required/,
  );
  assert.match(source, /chain 46630 manifests required/);
  assert.match(source, /dirty Schema-19 checkout/);
  assert.match(source, /unpushed Schema-19 tooling/);
  assert.match(source, /a67288133f09bce68b7386009d702c14dfb8bbab/);
});

test("Testnet input uses LAN-only live runtime and route reads", () => {
  assert.match(source, /127\.0\.0\.1:18548/);
  assert.match(source, /loopback LAN gateway/);
  assert.match(source, /Testnet LAN RPC is syncing/);
  assert.match(source, /reusedRuntimeCodeHashes/);
  assert.match(source, /routeStatus/);
  assert.match(source, /executionRouteStatus/);
  assert.match(source, /unready Testnet route/);
  assert.match(source, /alchemyFallbackAuthorized: false/);
});

test("Testnet profile is accelerated but gas policy remains qualified", () => {
  assert.match(source, /rewardDuration: 600/);
  assert.match(source, /failureObservationSpacing: 60/);
  assert.match(source, /fallbackDelay: 180/);
  assert.match(source, /targetGraduationNative: "10000000000000000"/);
  assert.match(source, /maximumCurvePurchase: "1000000000000000"/);
  assert.match(source, /maintenanceTaskGas: 1500000/);
  assert.match(source, /maintenanceCallGas: 1550000/);
});

test("Testnet input uses fresh hook domain and exactly the required six routes", () => {
  assert.match(source, /ROByn Schema-19 Testnet/);
  for (const symbol of ["GOOGL", "MSFT", "NVDA", "SPCX", "SPY"]) {
    assert.match(source, new RegExp(symbol));
  }
  assert.match(source, /symbol: "WETH"/);
  assert.match(source, /routes: routes.length/);
  assert.match(source, /failureFixtureSymbol = "MSFT"/);
  assert.match(source, /testFailureFixture: symbol === failureFixtureSymbol/);
});

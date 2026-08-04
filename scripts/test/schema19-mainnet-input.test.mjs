import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(new URL("../..", import.meta.url).pathname);
const source = await readFile(
  path.join(repo, "scripts/prepare-schema19-mainnet-input.mjs"),
  "utf8",
);

test("Mainnet input is generated only from exact clean pushed identities", () => {
  assert.match(source, /Schema-18 governance and active route source required/);
  assert.match(source, /chain 4663 manifests required/);
  assert.match(source, /dirty Schema-19 checkout/);
  assert.match(source, /unpushed Schema-19 tooling/);
  assert.match(source, /a67288133f09bce68b7386009d702c14dfb8bbab/);
});

test("Mainnet input uses LAN-only live runtime and route reads", () => {
  assert.match(source, /127\.0\.0\.1:18549/);
  assert.match(source, /loopback LAN gateway/);
  assert.match(source, /Mainnet LAN RPC is syncing/);
  assert.match(source, /fallbackTrafficAuthorized !== false/);
  assert.match(source, /reusedRuntimeCodeHashes/);
  assert.match(source, /function stateView\(\) view returns \(address\)/);
  assert.match(source, /canonicalStateView/);
  assert.match(source, /stateView: canonicalStateView/);
  assert.match(source, /routeStatus/);
  assert.match(source, /executionRouteStatus/);
  assert.match(source, /mismatched Mainnet route/);
  assert.match(source, /getLiquidity/);
  assert.match(source, /getSlot0/);
  assert.match(source, /quoteExactInputSingle/);
  assert.match(source, /quoteExactOutputSingle/);
  assert.match(source, /quoteLadder/);
  assert.match(source, /entry\.amount >= 1_000_000_000_000_000n/);
  assert.match(source, /entry\.recoveryBps >= 9_500/);
  assert.match(source, /maximumNativeInput: cap\.toString\(\)/);
  assert.match(source, /minimumLiquidity = \(liquidity \* 9n\) \/ 10n/);
  assert.match(source, /liveQualification/);
  assert.match(source, /alchemyFallbackAuthorized: false/);
});

test("Mainnet profile uses production timing and qualified gas policy", () => {
  assert.match(source, /rewardDuration: 3600/);
  assert.match(source, /failureObservationSpacing: 86400/);
  assert.match(source, /fallbackDelay: 259200/);
  assert.match(source, /targetGraduationNative: "6000000000000000000"/);
  assert.match(source, /maximumCurvePurchase: "500000000000000000"/);
  assert.match(source, /maintenanceTaskGas: 1500000/);
  assert.match(source, /maintenanceCallGas: 1550000/);
});

test("Mainnet input uses fresh hook domain and exactly the required six routes", () => {
  assert.match(source, /ROByn Schema-19 Mainnet/);
  for (const symbol of ["GOOGL", "MSFT", "NVDA", "SPCX", "SPY"]) {
    assert.match(source, new RegExp(symbol));
  }
  assert.match(source, /symbol: "WETH"/);
  assert.match(source, /routes: routes.length/);
  assert.doesNotMatch(source, /testFailureFixture/);
  assert.match(source, /schema18RetirementPrecondition/);
  assert.match(source, /schema19-mainnet-assets-v1/);
  assert.match(source, /predecessorPolicyHash/);
});

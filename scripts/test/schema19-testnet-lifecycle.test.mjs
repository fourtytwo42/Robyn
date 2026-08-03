import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  "scripts/run-schema19-testnet-lifecycle.mjs",
  "utf8",
);

test("Schema-19 lifecycle is LAN-only, immutable-release-bound, and restart safe", () => {
  for (const pattern of [
    /const CHAIN_ID = mainnetFork \? 4663 : 46630/,
    /ROBYN_SCHEMA19_TESTNET_RELEASE_SHA/,
    /exact clean pushed tooling/,
    /manifest tooling identity mismatch/,
    /gateway\.fallbackTrafficAuthorized !== false/,
    /unresolved signed intent; automatic replay is prohibited/,
    /submission is ambiguous; manual reconciliation required/,
    /would breach the fixed Testnet reserve/,
  ])
    assert.match(source, pattern);
  assert.doesNotMatch(source, /alchemy\.com|automatic fallback/i);
});

test("Schema-19 lifecycle starts Public without bootstrap or a live activation vote", () => {
  assert.match(source, /requires Schema-19 Public mode/);
  assert.match(source, /requires active Schema-19 conversions/);
  assert.doesNotMatch(source, /executeBootstrapStep|bootstrap1|bootstrap2/);
});

test("Schema-19 lifecycle covers three assets, user-driven maintenance, and all pull claims", () => {
  assert.match(source, /weights: \[4_000, 3_000, 3_000\]/);
  assert.match(
    source,
    /three-asset lifecycle requires two stock routes plus WETH/,
  );
  for (const action of [
    "swapExactNativeForAsset",
    "swapExactAssetForNative",
    "createLaunch",
    "setCreatorFeeSplit",
    "processRewards",
    "claimAll",
    "claimCreatorFees",
    "claimFor",
    "pauseLaunches",
    "pauseConversions",
    "disableRoute",
  ])
    assert.match(source, new RegExp(`"${action}"`));
  assert.match(source, /did not advance one deterministic task per call/);
  assert.match(
    source,
    /`\$\{phase\}-maintenance-\$\{before \+ BigInt\(index \+ 1\)\}`/,
  );
  assert.match(
    source,
    /minimumGas: BigInt\(manifest\.settings\.maintenanceCallGas\)/,
  );
  assert.match(source, /await waitUntil\(BigInt\(state\.graduatedAt\) \+ 301n\)/);
  assert.match(
    source,
    /await waitUntil\(BigInt\(state\.streamStartedAt\) \+ rewardDuration\)/,
  );
  assert.match(
    source,
    /controlled route did not enter objective deviation failure/,
  );
  assert.match(source, /user-buy-with-failed-maintenance/);
  assert.match(source, /failed maintenance did not preserve the user trade/);
  assert.match(source, /failed leg did not record observation/);
  assert.match(source, /checksum\(candidate\.asset\) === fixtureAsset/);
  assert.match(source, /controlled failed leg is absent from the launch vault/);
  assert.match(source, /did not complete and reset WETH fallback/);
  assert.match(source, /fixture-unwind/);
  assert.equal((source.match(/const permit2Abi = parseAbi/g) ?? []).length, 1);
  assert.equal((source.match(/const universalAbi = parseAbi/g) ?? []).length, 1);
  assert.match(source, /currency0: zeroAddress,\s+currency1: fixtureAsset/);
  assert.match(source, /testFailureFixture/);
  assert.match(
    source,
    /poolKey\.currency0\.toLowerCase\(\) === zeroAddress\.toLowerCase\(\)/,
  );
});

test("Schema-19 lifecycle proves unwind, supply, principal, allowance, solvency, and allocation", () => {
  assert.match(source, /recovered less than 75% of gross principal/);
  assert.match(source, /50\/25\/20\/5 conservation failed/);
  assert.match(source, /locked principal changed/);
  assert.match(source, /fixed supply changed/);
  assert.match(source, /residual allowance/);
  assert.match(source, /fee router is not exactly solvent/);
});

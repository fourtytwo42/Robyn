import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  "scripts/run-schema17-testnet-lifecycle.mjs",
  "utf8",
);

test("Schema-17 Testnet lifecycle is LAN-only and release-bound", () => {
  assert.match(source, /const CHAIN_ID = 46630/);
  assert.match(source, /const RESERVE = 1_500_000_000_000_000n/);
  assert.match(source, /ROBYN_SCHEMA17_TESTNET_RELEASE_SHA/);
  assert.match(source, /const toolingSha = git\("rev-parse", "HEAD"\)/);
  assert.match(source, /exact clean pushed tooling/);
  assert.match(
    source,
    /const checksum = \(address\) => getAddress\(address\.toLowerCase\(\)\)/,
  );
  assert.match(source, /plan\.targets\.map\(checksum\)/);
  assert.match(source, /ROBYN_SCHEMA17_TESTNET_LOCAL_REHEARSAL/);
  assert.match(source, /anvil_nodeInfo/);
  assert.match(source, /releaseManifest\.gitSha !== releaseSha/);
  assert.match(source, /deploymentSha: manifest\.releaseSha/);
  assert.match(source, /gateway\.activeProvider !== "primary"/);
  assert.match(source, /gateway\.providerSelection !== "operator"/);
  assert.match(source, /gateway\.fallbackTrafficAuthorized !== false/);
  assert.doesNotMatch(
    source,
    /alchemy\.com|send.*fallback|automatic fallback/i,
  );
});

test("Schema-17 Testnet lifecycle journals and never replays ambiguous work", () => {
  assert.match(source, /classifyCanaryJournal/);
  assert.match(source, /type: "intent"/);
  assert.match(source, /type: "receipt"/);
  assert.match(
    source,
    /unresolved signed intent; automatic replay is prohibited/,
  );
  assert.match(
    source,
    /submission is ambiguous; manual reconciliation required/,
  );
  assert.match(source, /would breach the fixed Testnet reserve/);
  assert.match(source, /if \(!\(await paused\(\)\)\) await shutdown\(\)/);
  assert.match(source, /type: "shutdown-failed"/);
});

test("Schema-17 Testnet lifecycle binds both exact bootstrap plans", () => {
  assert.match(source, /manifest\.bootstrap\.steps\[step\]/);
  assert.match(source, /"executeBootstrapStep"/);
  assert.match(source, /bootstrap step one did not enter Canary/);
  assert.match(source, /bootstrap step two did not enter Public/);
  assert.match(
    source,
    /bootstrap step two did not install the production profile/,
  );
  assert.match(source, /canary profile snapshot changed/);
});

test("Schema-17 Testnet lifecycle covers routes, rewards, unwind, and shutdown", () => {
  for (const action of [
    "swapExactNativeForAsset",
    "swapExactAssetForNative",
    "createLaunch",
    "setCreatorFeeSplit",
    "convertTokenFees",
    "settleBasketFees",
    "settleDaoFees",
    "settleTreasuryFees",
    "claimAll",
    "claimCreatorFees",
    "claimRewards",
    "pauseLaunches",
    "pauseConversions",
    "disableRoute",
  ]) {
    assert.match(source, new RegExp(`"${action}"`));
  }
  assert.match(source, /one-hour reward release is not complete/);
  assert.match(source, /const boundedRouteInput = async/);
  assert.match(source, /amount > cap \? cap : amount/);
  assert.match(source, /launchProfile\.actualGraduationNative/);
  assert.match(
    source,
    /BigInt\(state\.roundTripRecoveredWei\) \+ unwindRecovered/,
  );
  assert.match(source, /recovered less than 75% of gross principal/);
  assert.match(source, /50\/25\/20\/5 conservation failed/);
  assert.match(source, /locked principal changed/);
});

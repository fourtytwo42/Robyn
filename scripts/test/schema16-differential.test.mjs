import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  "scripts/run-schema16-dual-anvil-differential.sh",
  "utf8",
);
const capture = readFileSync(
  "scripts/capture-schema16-differential-state.mjs",
  "utf8",
);
const compare = readFileSync(
  "scripts/compare-schema16-differential.mjs",
  "utf8",
);

test("dual-Anvil differential is exact-SHA, isolated, and evidence sealed", () => {
  assert.match(runner, /5899a5fc99dde04f60f1bba88bc9716e99dcd45f/);
  assert.match(runner, /28546/);
  assert.match(runner, /28547/);
  assert.match(runner, /--fork-block-number "\$fork_block"/);
  assert.match(runner, /git rev-parse '@\{u\}'/);
  assert.match(runner, /schemaVersion=16/);
  assert.match(runner, /anvil_impersonateAccount/);
  assert.match(runner, /ROBYN_CAMPAIGN_REHEARSAL_KEY_FILE="\$key_file"/);
  assert.match(runner, /--gas-price-wei 10000000000/);
  assert.match(runner, /for phase in preflight fund launches trading conversions governance claims/);
  assert.match(runner, /sha256sum -c SHA256SUMS/);
  assert.doesNotMatch(runner, /MAINNET|4663\b|docker/i);
});

test("state capture includes economic, reward, principal, event, and revert parity", () => {
  for (const marker of [
    "totalNativeLiabilities",
    "totalRewardsVested",
    "principalLiquidity",
    "graduationProfileHashByToken",
    "creatorRewardStream",
    "failureSelectors",
    "getLogs",
  ]) {
    assert.match(capture, new RegExp(marker));
  }
  assert.match(compare, /addressBook/);
  assert.match(compare, /passed: equal/);
  assert.match(compare, /firstDifference/);
});

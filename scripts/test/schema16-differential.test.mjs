import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  assert.match(runner, /start_timestamp=\$\(\(fork_timestamp \+ 86400\)\)/);
  assert.equal(
    (runner.match(/--timestamp "\$start_timestamp"/g) ?? []).length,
    2,
  );
  assert.match(runner, /git rev-parse '@\{u\}'/);
  assert.match(runner, /schemaVersion=16/);
  assert.match(runner, /anvil_impersonateAccount/);
  assert.match(runner, /ROBYN_CAMPAIGN_REHEARSAL_KEY_FILE="\$key_file"/);
  assert.match(runner, /--gas-price-wei 10000000000/);
  assert.match(runner, /prepare_graduations/);
  assert.match(runner, /graduationThresholdNative\(\)\(uint256\)/);
  assert.match(runner, /maximumCurvePurchase\(\)\(uint256\)/);
  assert.match(runner, /--json \| jq -er '\.\[0\]'/);
  assert.match(runner, /gross <= 100000000000000/);
  assert.match(
    runner,
    /for phase in preflight fund launches trading conversions governance claims/,
  );
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
  assert.match(capture, /value\.match\(\/0x\[0-9a-fA-F\]\{8,\}\//);
  assert.match(capture, /seen = new WeakSet\(\)/);
  assert.match(
    capture,
    /\["data", "cause", "details", "shortMessage", "message"\]/,
  );
  assert.match(compare, /addressBook/);
  assert.match(compare, /passed: equal/);
  assert.match(compare, /firstDifference/);
  for (const metadata of [
    "transactionHash",
    "seedTransaction",
    "assetCreationTransaction",
    "provenance",
  ]) {
    assert.match(compare, new RegExp(`"${metadata}"`));
  }
  for (const behavior of [
    "runtimeCodeHash",
    "poolId",
    "configurationHash",
    "currentProfileHash",
  ]) {
    assert.doesNotMatch(compare, new RegExp(`"${behavior}"`));
  }
});

test("comparator accepts three paths and normalizes logical addresses", () => {
  const directory = mkdtempSync(join(tmpdir(), "schema16-compare-"));
  try {
    const baseline = join(directory, "baseline.json");
    const candidate = join(directory, "candidate.json");
    const output = join(directory, "comparison.json");
    writeFileSync(
      baseline,
      JSON.stringify({
        addressBook: {
          coordinator: "0x1111111111111111111111111111111111111111",
        },
        fingerprint: "baseline",
        manifestIdentity: { assetRoutes: [] },
        launches: [{ index: 0, poolId: `0x${"11".repeat(32)}` }],
        state: {
          owner: "0x1111111111111111111111111111111111111111",
          lastUpdateTime: "1000",
          streamEnd: "1060",
        },
      }),
    );
    writeFileSync(
      candidate,
      JSON.stringify({
        addressBook: {
          coordinator: "0x2222222222222222222222222222222222222222",
        },
        fingerprint: "candidate",
        manifestIdentity: { assetRoutes: [] },
        launches: [{ index: 0, poolId: `0x${"22".repeat(32)}` }],
        state: {
          owner: "0x2222222222222222222222222222222222222222",
          lastUpdateTime: "2000",
          streamEnd: "2060",
        },
      }),
    );
    execFileSync(process.execPath, [
      "scripts/compare-schema16-differential.mjs",
      baseline,
      candidate,
      output,
    ]);
    assert.equal(JSON.parse(readFileSync(output, "utf8")).passed, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

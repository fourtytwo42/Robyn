import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync("scripts/run-schema15-devnet-torture.sh", "utf8");
const broadcast = readFileSync(
  "scripts/run-schema15-anvil-broadcast.mjs",
  "utf8",
);
const validator = readFileSync(
  "scripts/validate-schema15-torture-evidence.mjs",
  "utf8",
);

test("Schema-15 torture runner is isolated, reproducible, and fail closed", () => {
  assert.match(runner, /--tier/);
  assert.match(runner, /--seed/);
  assert.match(runner, /--release-sha/);
  assert.match(runner, /--output/);
  assert.match(runner, /git status --porcelain/);
  assert.match(runner, /git rev-parse '@\{u\}'/);
  assert.match(runner, /--port 28546/);
  assert.match(runner, /--chain-id 31337/);
  assert.match(runner, /\/tmp\/robyn-schema15-torture\.\*/);
  assert.match(runner, /fuzz_runs=1024/);
  assert.match(runner, /fuzz_runs=10000/);
  assert.match(runner, /invariant_runs=1024/);
  assert.match(runner, /simulation_actions=100000/);
  assert.match(runner, /sha256sum -c SHA256SUMS/);
  assert.doesNotMatch(
    runner,
    /docker|4663|46630|https?:\/\/.*(mainnet|testnet)/i,
  );
});

test("broadcast sequence cannot leave isolated Anvil", () => {
  assert.match(broadcast, /rpcUrl !== "http:\/\/127\.0\.0\.1:28546"/);
  assert.match(broadcast, /getChainId\(\)\) !== 31337/);
  assert.match(broadcast, /disposable development key/);
  assert.doesNotMatch(broadcast, /ALCHEMY|ROBYN_TESTNET|ROBYN_MAINNET/);
});

test("evidence validator enforces action and coverage gates", () => {
  assert.match(validator, /missingActions\.length === 0/);
  assert.match(validator, /linePercent >= 90/);
  assert.match(validator, /branchPercent >= 80/);
  assert.match(validator, /!source\.includes\("\/src\/devnet\/"\)/);
  assert.match(validator, /!source\.includes\("\/src\/testnet\/"\)/);
});

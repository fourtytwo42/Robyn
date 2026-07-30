import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Schema-13 deployment is fail-closed, Paused, and profile-pinned", async () => {
  const source = await readFile(
    "scripts/deploy-testnet-schema13-protocol.sh",
    "utf8",
  );
  assert.match(source, /ROBYN_TESTNET_SCHEMA13_BROADCAST/);
  assert.match(source, /http:\/\/127\.0\.0\.1:18548/);
  assert.match(
    source,
    /RobynV4LaunchCoordinatorV6\.sol:RobynV4LaunchCoordinatorV6/,
  );
  assert.match(
    source,
    /"\$launch_factory" "\$market_factory" "\$fee_router" "\$timelock" "\$guardian"/,
  );
  assert.match(source, /threshold_native="10000000000000000"/);
  assert.match(source, /maximum_curve_purchase="1000000000000000"/);
  assert.match(source, /initialMode: "Paused"/);
  assert.match(source, /targetGraduationNative: "6000000000000000000"/);
  assert.match(source, /maximumCurvePurchase: "500000000000000000"/);
  assert.doesNotMatch(source, /createLaunch\(/);
  assert.match(source, /verify-testnet-schema13-deployment\.mjs/);
});

test("Schema-13 verifier checks live mode, roles, and profile", async () => {
  const source = await readFile(
    "scripts/verify-testnet-schema13-deployment.mjs",
    "utf8",
  );
  assert.match(source, /RobynV4LaunchCoordinatorV6/);
  assert.match(source, /coordinator remains Paused/);
  assert.match(source, /Timelock governs launch activation/);
  assert.match(source, /Timelock governs graduation profiles/);
  assert.match(source, /currentGraduationProfileHash/);
  assert.match(source, /derived actual threshold meets target/);
});

test("launch receipt decoder supports both archived and Schema-13 events", async () => {
  const source = await readFile("scripts/decode-v4-launch-receipt.mjs", "utf8");
  assert.match(source, /RobynV4LaunchCoordinatorV\[56\]/);
  assert.match(source, /graduationProfileHash/);
});

test("Schema-13 rehearsal is isolated and emits exact-commit gas evidence", async () => {
  const source = await readFile(
    "scripts/rehearse-testnet-schema13-protocol.sh",
    "utf8",
  );
  assert.match(source, /--fork-url "\$upstream_rpc"/);
  assert.match(source, /--host 127\.0\.0\.1/);
  assert.match(source, /ROBYN_ALLOW_UNLOCKED_REHEARSAL=true/);
  assert.match(source, /ROBYN_TESTNET_SCHEMA13_BROADCAST=true/);
  assert.match(source, /measure-testnet-v4-deployment-gas\.sh/);
  assert.match(source, /headroomBps >= 2500/);
  assert.match(source, /reserveWei >= "1500000000000000"/);
  assert.match(source, /transactionCount >= "97"/);
  assert.match(source, /liveBroadcast:false/);
  assert.match(source, /rm -rf -- "\$work"/);
});

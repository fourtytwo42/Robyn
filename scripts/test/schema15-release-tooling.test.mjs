import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Schema-15 deployment is fail-closed, Paused, and profile-pinned", async () => {
  const source = await readFile(
    "scripts/deploy-testnet-schema15-protocol.sh",
    "utf8",
  );
  assert.match(source, /ROBYN_TESTNET_SCHEMA15_BROADCAST/);
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
  assert.match(
    source,
    /graduationProfileVersion\(\)\(uint64\).*awk '\{print \$1\}'/,
  );
  assert.match(source, /verify-testnet-schema15-deployment\.mjs/);
  assert.match(source, /configureWrappedNativeRoute\(uint128,bool\)/);
  assert.doesNotMatch(
    source,
    /PinnedAdapter|pinned-adapter|configureAdapterRoute|provider|priceGuard/,
  );
});

test("Schema-15 verifier checks live mode, roles, and profile", async () => {
  const source = await readFile(
    "scripts/verify-testnet-schema15-deployment.mjs",
    "utf8",
  );
  assert.match(source, /RobynV4LaunchCoordinatorV6/);
  assert.match(source, /coordinator remains Paused/);
  assert.match(source, /Timelock governs launch activation/);
  assert.match(source, /Timelock governs graduation profiles/);
  assert.match(source, /currentGraduationProfileHash/);
  assert.match(source, /derived actual threshold meets target/);
});

test("launch receipt decoder supports both archived and Schema-15 events", async () => {
  const source = await readFile("scripts/decode-v4-launch-receipt.mjs", "utf8");
  assert.match(source, /RobynV4LaunchCoordinatorV\[56\]/);
  assert.match(source, /graduationProfileHash/);
});

test("Schema-15 rehearsal is isolated and emits exact-commit gas evidence", async () => {
  const source = await readFile(
    "scripts/rehearse-testnet-schema15-protocol.sh",
    "utf8",
  );
  assert.match(source, /--fork-url "\$upstream_rpc"/);
  assert.match(source, /--host 127\.0\.0\.1/);
  assert.match(source, /ROBYN_ALLOW_UNLOCKED_REHEARSAL=true/);
  assert.match(source, /ROBYN_TESTNET_SCHEMA15_BROADCAST=true/);
  assert.match(source, /measure-testnet-v4-deployment-gas\.sh/);

  assert.match(source, /headroomBps >= 2500/);
  assert.match(source, /\.reserveWei \| tonumber/);
  assert.match(source, /\(\.transactionCount \| tonumber\) >= 80/);
  assert.match(source, /liveBroadcast:false/);
  assert.match(source, /rm -rf -- "\$work"/);
});

test("Testnet release pipeline binds the Schema-15 manifest", async () => {
  const build = await readFile("scripts/build-testnet-release.sh", "utf8");
  const promote = await readFile("scripts/promote-testnet-release.sh", "utf8");
  const verify = await readFile("scripts/verify-testnet-release.sh", "utf8");
  const installEndurance = await readFile(
    "scripts/install-testnet-endurance.sh",
    "utf8",
  );
  const endurance = await readFile("scripts/testnet-endurance.mjs", "utf8");
  assert.match(build, /deployments\/46630-v4-schema15\.json/);
  assert.match(
    build,
    /ROBYN_DEPLOYMENT_PATH="\$staging\/\$deployment_manifest"/,
  );
  assert.match(
    promote,
    /ROBYN_TESTNET_MANIFEST="\$selected\/deployments\/46630-v4-schema15\.json"/,
  );
  assert.match(verify, /\.schemaVersion == 15/);
  assert.match(verify, /verify-testnet-schema15-deployment\.mjs "\$manifest"/);
  assert.match(promote, /ROBYN_TESTNET_CREATE_DATABASE/);
  assert.match(promote, /refusing to reuse database requested as fresh/);
  assert.match(promote, /createdb --owner="\$operator"/);
  assert.match(promote, /expected 14 migrations/);
  assert.match(
    installEndurance,
    /ROBYN_ENDURANCE_MANIFEST=\/opt\/robyn\/testnet-current\/deployments\/46630-v4-schema15\.json/,
  );
  assert.doesNotMatch(
    installEndurance,
    /ROBYN_ENDURANCE_MANIFEST=.*46630-v4\.json/,
  );
  assert.match(endurance, /46630-v4-schema15\.json/);
  assert.doesNotMatch(endurance, /"46630-v4\.json"/);
});

test("Schema-15 runtime isolates keeper queues by database", async () => {
  const ecosystem = await readFile(
    "infrastructure/pm2/ecosystem.testnet.config.cjs",
    "utf8",
  );
  assert.ok(ecosystem.includes("`robyn-conversions-testnet-${database}`"));
  assert.equal(
    (ecosystem.match(/ROBYN_QUEUE_NAME: queueName/g) ?? []).length,
    2,
  );
});

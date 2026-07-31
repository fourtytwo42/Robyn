import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const files = {
  build: readFileSync("scripts/build-testnet-release.sh", "utf8"),
  promote: readFileSync("scripts/promote-testnet-release.sh", "utf8"),
  verify: readFileSync("scripts/verify-testnet-release.sh", "utf8"),
  endurance: readFileSync("scripts/testnet-endurance.mjs", "utf8"),
  recovery: readFileSync(
    "scripts/recover-failed-endurance-funding.mjs",
    "utf8",
  ),
  campaign: readFileSync("scripts/lib/campaign-plan.mjs", "utf8"),
  deploy: readFileSync("scripts/deploy-testnet-schema16-protocol.sh", "utf8"),
};

test("active Schema-16 tooling rejects archived manifests and wrong chains", () => {
  for (const [name, source] of Object.entries(files)) {
    assert.doesNotMatch(
      source,
      /46630-v4-schema15\.json/,
      `${name} retained an active Schema-15 manifest path`,
    );
  }
  assert.match(files.verify, /\.schemaVersion == 16/);
  assert.match(files.verify, /\.chainId == 46630/);
  assert.match(files.recovery, /manifest\.schemaVersion !== 16/);
  assert.match(files.recovery, /manifest\.chainId !== 46630/);
  assert.match(files.campaign, /manifest\?\.schemaVersion !== 16/);
  assert.match(files.campaign, /manifest\?\.chainId !== 46630/);
  assert.match(files.deploy, /cast chain-id/);
  assert.match(
    files.deploy,
    /Refusing Schema-16 protocol deployment outside chain 46630/,
  );
});

test("Schema-16 recovery remains journaled and does not replay confirmed work", () => {
  assert.match(files.recovery, /journal\.transactions/);
  assert.match(files.recovery, /getTransactionReceipt/);
  assert.match(files.recovery, /status === "confirmed"/);
  assert.match(files.recovery, /retryCount: 0/);
  assert.match(files.recovery, /failedRunStateSha256/);
});

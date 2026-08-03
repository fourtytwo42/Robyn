import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repo = resolve(new URL("../..", import.meta.url).pathname);
const validator = resolve(repo, "scripts/validate-mainnet-support-policy.mjs");
const source = resolve(
  repo,
  "config/protocol/robinhood-mainnet-support-policy.json",
);
const governanceSource = resolve(
  repo,
  "scripts/prepare-schema18-route-governance.mjs",
);
function run(mutator = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), "schema18-assets-"));
  const target = join(directory, "policy.json");
  const policy = JSON.parse(readFileSync(source, "utf8"));
  mutator(policy);
  writeFileSync(target, `${JSON.stringify(policy)}\n`);
  return execFileSync(process.execPath, [validator, "--write-hash"], {
    env: { ...process.env, ROBYN_MAINNET_SUPPORT_POLICY: target },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("accepts the frozen Schema-18 single-hop policy", () => {
  assert.match(run(), /"passed":true/);
});

test("governance binds current policy and immutable qualification evidence separately", () => {
  const governance = readFileSync(governanceSource, "utf8");
  assert.match(governance, /const POLICY_HASH = "ec5c8f9c/);
  assert.match(governance, /const QUALIFICATION_POLICY_HASH =/);
  assert.match(governance, /qualificationPolicyHash: QUALIFICATION_POLICY_HASH/);
  assert.doesNotMatch(
    governance,
    /qualification\.policyHash !== POLICY_HASH/,
  );
});

test("rejects noncanonical duplicate addresses", () => {
  assert.throws(
    () =>
      run((policy) => {
        policy.assets[1].address = policy.assets[0].address;
      }),
    /reuses an address/,
  );
});

test("rejects weakened loss and capacity thresholds", () => {
  assert.throws(
    () =>
      run((policy) => {
        policy.qualification.maximumRoundTripLossBps = 501;
        policy.qualification.minimumUsefulCapacityWei = "1";
      }),
    /round-trip loss must remain 5 percent/,
  );
});

test("rejects wrapped lookalikes with an address", () => {
  assert.throws(
    () =>
      run((policy) => {
        policy.provenanceWatchlist[1].address = policy.assets[1].address;
      }),
    /must remain unavailable without an address/,
  );
});

test("pins canonical token decimals and rejects invalid metadata", () => {
  assert.match(run(), /"passed":true/);
  assert.throws(
    () =>
      run((policy) => {
        policy.assets.find((asset) => asset.symbol === "USDG").decimals = 18.5;
      }),
    /invalid token decimals/,
  );
});

test("rejects pools the Schema-18 router cannot configure", () => {
  assert.throws(
    () =>
      run((policy) => {
        policy.assets[1].candidatePools[0].fee = 0;
        policy.assets[1].candidatePools[0].hooks =
          "0x0000000000000000000000000000000000000001";
      }),
    /invalid pool parameters/,
  );
});

test("rejects a selected pool or cap outside the qualified policy", () => {
  assert.throws(
    () =>
      run((policy) => {
        policy.assets[1].selectedPool =
          "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        policy.assets[1].capWei = "500000000000000000";
      }),
    /selected pool is not a candidate/,
  );
});

test("rejects missing observed route controls after qualification", () => {
  assert.throws(
    () => run((policy) => {
      delete policy.assets[1].selectedRoute.minimumLiquidity;
    }),
    /requires a nonzero observed liquidity floor/,
  );
});

test("rejects a stale qualified evidence timestamp", () => {
  assert.throws(
    () => run((policy) => {
      policy.lastVerifiedAt = null;
    }),
    /qualified policy requires lastVerifiedAt/,
  );
});

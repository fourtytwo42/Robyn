import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, keccak256, parseAbi, stringToHex } from "viem";
import {
  buildSchema18GovernanceManifest,
  normalizeBootstrapStep,
  SCHEMA18,
  validateSchema18GovernanceManifest,
} from "../lib/schema18-governance.mjs";

const addresses = {
  deployer: "0x0000000000000000000000000000000000000011",
  guardianSafe: "0x0000000000000000000000000000000000000022",
  daoToken: "0x0000000000000000000000000000000000000033",
  timelock: "0x0000000000000000000000000000000000000044",
  governor: "0x0000000000000000000000000000000000000055",
  assetRouter: "0x0000000000000000000000000000000000000066",
  coordinator: "0x0000000000000000000000000000000000000077",
};
const domain = keccak256(stringToHex("schema18-test"));
const coordinatorAbi = parseAbi([
  "function setCanaryMode(address)",
  "function setPublicMode()",
]);
const calls = [
  [
    {
      label: "enter-canary",
      target: addresses.coordinator,
      valueWei: "0",
      data: encodeFunctionData({
        abi: coordinatorAbi,
        functionName: "setCanaryMode",
        args: [addresses.deployer],
      }),
    },
  ],
  [
    {
      label: "enter-public",
      target: addresses.coordinator,
      valueWei: "0",
      data: encodeFunctionData({
        abi: coordinatorAbi,
        functionName: "setPublicMode",
      }),
    },
  ],
];

const input = () => ({
  schemaVersion: 18,
  chainId: 4663,
  releaseSha: "a".repeat(40),
  deployer: addresses.deployer,
  guardianSafe: addresses.guardianSafe,
  contracts: {
    daoToken: addresses.daoToken,
    timelock: addresses.timelock,
    governor: addresses.governor,
    assetRouter: addresses.assetRouter,
    coordinator: addresses.coordinator,
  },
  bootstrap: { domain, steps: calls },
});

test("builds exact two-step hour-scale governance manifest", () => {
  const manifest = buildSchema18GovernanceManifest(input());
  assert.equal(manifest.governance.bootstrapWindowSeconds, 172_800);
  assert.equal(manifest.governance.votingDelaySeconds, 3_600);
  assert.equal(manifest.governance.votingPeriodSeconds, 14_400);
  assert.equal(manifest.governance.timelockDelaySeconds, 3_600);
  assert.equal(manifest.governance.proposalThresholdBps, 100);
  assert.equal(manifest.governance.quorumBps, 1_000);
  assert.equal(manifest.bootstrap.steps.length, 2);
  assert.notEqual(
    manifest.bootstrap.steps[0].planHash,
    manifest.bootstrap.steps[1].planHash,
  );
  assert.equal(manifest.authorization.mainnetTransactionsAuthorized, false);
  validateSchema18GovernanceManifest(manifest);
});

test("hash is deterministic and binds chain, domain, order, and calldata", () => {
  const first = normalizeBootstrapStep({
    chainId: 4663,
    domain,
    step: 0,
    calls: calls[0],
  });
  const repeated = normalizeBootstrapStep({
    chainId: 4663,
    domain,
    step: 0,
    calls: calls[0],
  });
  const differentChain = normalizeBootstrapStep({
    chainId: 46630,
    domain,
    step: 0,
    calls: calls[0],
  });
  const differentStep = normalizeBootstrapStep({
    chainId: 4663,
    domain,
    step: 1,
    calls: calls[0],
  });
  assert.equal(first.planHash, repeated.planHash);
  assert.notEqual(first.planHash, differentChain.planHash);
  assert.notEqual(first.planHash, differentStep.planHash);
});

test("rejects arbitrary native value, Timelock self-call, mixed schemas, and authorization", () => {
  assert.throws(
    () =>
      normalizeBootstrapStep({
        chainId: 4663,
        domain,
        step: 0,
        calls: [{ ...calls[0][0], valueWei: "1" }],
      }),
    /cannot transfer native value/,
  );
  assert.throws(
    () =>
      normalizeBootstrapStep({
        chainId: 4663,
        domain,
        step: 0,
        calls: [{ ...calls[0][0], target: addresses.timelock }],
        timelock: addresses.timelock,
      }),
    /cannot target the bootstrap Timelock/,
  );
  assert.throws(
    () => buildSchema18GovernanceManifest({ ...input(), schemaVersion: 16 }),
    /Schema-18/,
  );
  const manifest = buildSchema18GovernanceManifest(input());
  manifest.authorization.mainnetTransactionsAuthorized = true;
  assert.throws(
    () => validateSchema18GovernanceManifest(manifest),
    /cannot authorize/,
  );
  assert.equal(SCHEMA18.fixedDaoSupplyWei, "1000000000000000000000000000");
});

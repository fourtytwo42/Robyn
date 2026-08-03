import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSchema19IndexingPolicy,
  schema19IndexingPolicyHash,
  schema19IndexingPolicyRoles,
} from "../lib/schema19-indexing-policy.mjs";

const address = (value) => `0x${value.toString(16).padStart(40, "0")}`;

function manifest() {
  const roleNames = schema19IndexingPolicyRoles.protocolRoots;
  const contracts = Object.fromEntries(
    roleNames.map((role, index) => [role, address(index + 1)]),
  );
  contracts.atomicLaunchCoordinator = address(2);
  contracts.poolManager = address(100);
  contracts.wrappedNative = address(101);
  contracts.permit2 = address(102);
  return { schemaVersion: 19, contracts };
}

test("Schema-19 manifest builds a deterministic scoped policy", () => {
  const source = manifest();
  const expected = buildSchema19IndexingPolicy(source);
  assert.match(expected.policyHash, /^[0-9a-f]{64}$/);
  assert.equal(expected.poolEventTopics.length, 4);
  assert.equal(
    expected.launchCoordinator,
    source.contracts.atomicLaunchCoordinator,
  );
});

test("policy roots contain no excluded global dependency", () => {
  const source = manifest();
  const policy = buildSchema19IndexingPolicy(source);
  const excluded = new Set(
    schema19IndexingPolicyRoles.excludedExternalSources.flatMap((role) => {
      const value = source.contracts[role];
      return (Array.isArray(value) ? value : [value])
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.toLowerCase());
    }),
  );
  assert.equal(
    policy.protocolRoots.some((root) => excluded.has(root.toLowerCase())),
    false,
  );
});

test("policy hash is stable under root and topic ordering", () => {
  const policy = buildSchema19IndexingPolicy(manifest());
  const { policyHash, ...unsigned } = policy;
  assert.equal(schema19IndexingPolicyHash(unsigned), policyHash);
  assert.equal(
    schema19IndexingPolicyHash({
      ...unsigned,
      protocolRoots: [...unsigned.protocolRoots].reverse(),
      poolEventTopics: [...unsigned.poolEventTopics].reverse(),
    }),
    policyHash,
  );
});

test("policy generation rejects archived schemas", () => {
  const source = manifest();
  source.schemaVersion = 18;
  assert.throws(() => buildSchema19IndexingPolicy(source), /Schema-19/);
});

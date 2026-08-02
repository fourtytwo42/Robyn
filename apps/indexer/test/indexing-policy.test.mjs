import assert from "node:assert/strict";
import test from "node:test";
import {
  backfillAllowed,
  chunkValues,
  indexingPolicyHash,
  uniqueLogs,
  validateIndexingPolicy,
} from "../dist/indexing-policy.js";

const address = (value) => `0x${value.toString(16).padStart(40, "0")}`;
const topic = (value) => `0x${value.toString(16).padStart(64, "0")}`;

function manifest() {
  const policy = {
    version: 1,
    protocolRoots: [address(1), address(2)],
    launchCoordinator: address(1),
    launchEventTopics: [
      "0xd74962c237728681433889a5419834cff77965f55668fb014ee28925e2cef5f1",
    ],
    poolManager: address(20),
    poolEventTopics: [
      "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438",
      "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec",
      "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
      "0x29ef05caaff9404b7cb6d1c0e9bbae9eaa7ab2541feba1a9c4248594c08156cb",
    ],
    addressBatchSize: 128,
    poolIdBatchSize: 64,
  };
  return {
    schemaVersion: 18,
    contracts: {
      atomicLaunchCoordinator: address(1),
      launchFactory: address(2),
      poolManager: address(20),
      wrappedNative: address(21),
      permit2: address(22),
    },
    indexingPolicy: {
      ...policy,
      policyHash: indexingPolicyHash(policy),
    },
  };
}

test("Schema-18 policy validates and normalizes its deterministic scope", () => {
  const result = validateIndexingPolicy(manifest());
  assert.equal(result.version, 1);
  assert.equal(result.protocolRoots.length, 2);
  assert.match(result.policyHash, /^[0-9a-f]{64}$/);
});

test("manifest validation rejects stale, zero, external, and altered policies", () => {
  const stale = manifest();
  stale.schemaVersion = 17;
  assert.throws(() => validateIndexingPolicy(stale), /Schema-18/);

  const zero = manifest();
  zero.indexingPolicy.protocolRoots[0] = address(0);
  assert.throws(() => validateIndexingPolicy(zero), /nonzero/);

  const external = manifest();
  external.indexingPolicy.protocolRoots[1] = external.contracts.wrappedNative;
  const unsigned = { ...external.indexingPolicy };
  delete unsigned.policyHash;
  external.indexingPolicy.policyHash = indexingPolicyHash(unsigned);
  assert.throws(() => validateIndexingPolicy(external), /External dependency/);

  const altered = manifest();
  altered.indexingPolicy.addressBatchSize = 8;
  assert.throws(() => validateIndexingPolicy(altered), /hash mismatch/);
});

test("address and pool queries are split into bounded batches", () => {
  assert.deepEqual(chunkValues([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.throws(() => chunkValues([1], 0), /positive integer/);
});

test("retained logs deduplicate by transaction hash and log index", () => {
  const hash = topic(99);
  const logs = uniqueLogs([
    { transactionHash: hash, logIndex: 0, value: "first" },
    { transactionHash: hash, logIndex: 0, value: "replacement" },
    { transactionHash: hash, logIndex: 1, value: "second" },
  ]);
  assert.equal(logs.length, 2);
  assert.equal(logs[0].value, "replacement");
  assert.throws(
    () => uniqueLogs([{ transactionHash: null, logIndex: null }]),
    /canonical identity/,
  );
});

test("85 percent disk guard blocks only material backfills", () => {
  assert.equal(backfillAllowed(101n, 100n, 99, 40n), true);
  assert.equal(backfillAllowed(90n, 100n, 85, 40n), true);
  assert.equal(backfillAllowed(1n, 100n, 85, 40n), false);
  assert.equal(backfillAllowed(1n, 100n, 84.99, 40n), true);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  buildSchema18IndexingPolicy,
  schema18IndexingPolicyHash,
  schema18IndexingPolicyRoles,
} from "../lib/schema18-indexing-policy.mjs";

const repo = path.resolve(new URL("../..", import.meta.url).pathname);

test("tracked Schema-18 manifest carries the deterministic scoped policy", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.join(repo, "deployments/46630-v4-schema18.json"),
      "utf8",
    ),
  );
  const expected = buildSchema18IndexingPolicy(manifest);
  assert.deepEqual(manifest.indexingPolicy, expected);
  assert.match(expected.policyHash, /^[0-9a-f]{64}$/);
  assert.equal(expected.poolEventTopics.length, 4);
});

test("policy roots contain no excluded global dependency", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.join(repo, "deployments/46630-v4-schema18.json"),
      "utf8",
    ),
  );
  const policy = buildSchema18IndexingPolicy(manifest);
  const excluded = new Set(
    schema18IndexingPolicyRoles.excludedExternalSources.flatMap((role) => {
      const value = manifest.contracts[role];
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

test("policy hash is stable under root and topic ordering", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.join(repo, "deployments/46630-v4-schema18.json"),
      "utf8",
    ),
  );
  const policy = buildSchema18IndexingPolicy(manifest);
  const { policyHash, ...unsigned } = policy;
  assert.equal(schema18IndexingPolicyHash(unsigned), policyHash);
  assert.equal(
    schema18IndexingPolicyHash({
      ...unsigned,
      protocolRoots: [...unsigned.protocolRoots].reverse(),
      poolEventTopics: [...unsigned.poolEventTopics].reverse(),
    }),
    policyHash,
  );
});

test("policy generation rejects an archived schema", () => {
  assert.throws(
    () =>
      buildSchema18IndexingPolicy({
        schemaVersion: 17,
        contracts: {},
      }),
    /Schema-18/,
  );
});

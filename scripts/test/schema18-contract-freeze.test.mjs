import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("Schema-18 frozen contract evidence matches the current source closure", () => {
  const output = execFileSync(
    "node",
    ["scripts/verify-schema18-contract-freeze.mjs"],
    {
      cwd: repo,
      encoding: "utf8",
    },
  );
  const result = JSON.parse(output);
  assert.equal(result.passed, true);
  assert.equal(result.contractSchema, 18);
});

test("freeze binds source, compiler config, dependencies, and full-gate evidence", () => {
  const freeze = JSON.parse(
    readFileSync(
      path.join(repo, "config/schema18-contract-freeze.json"),
      "utf8",
    ),
  );
  assert.match(freeze.sourceTreeGitObject, /^[0-9a-f]{40}$/);
  assert.match(freeze.foundryConfigGitObject, /^[0-9a-f]{40}$/);
  assert.match(freeze.securityEvidenceSha256, /^[0-9a-f]{64}$/);
  assert.match(freeze.releaseManifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.keys(freeze.contractDependencies).length, 6);
});

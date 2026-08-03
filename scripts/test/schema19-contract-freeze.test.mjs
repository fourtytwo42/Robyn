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

test("Schema-19 frozen closure matches its qualified evidence", () => {
  const result = JSON.parse(
    execFileSync("node", ["scripts/verify-schema19-contract-freeze.mjs"], {
      cwd: repo,
      encoding: "utf8",
    }),
  );
  assert.equal(result.passed, true);
  assert.equal(result.contractSchema, 19);
});

test("Schema-19 freeze binds code, dependencies, deep, security, and reproducibility evidence", () => {
  const freeze = JSON.parse(
    readFileSync(
      path.join(repo, "config/schema19-contract-freeze.json"),
      "utf8",
    ),
  );
  assert.match(freeze.sourceTreeGitObject, /^[0-9a-f]{40}$/);
  assert.match(freeze.scriptTreeGitObject, /^[0-9a-f]{40}$/);
  assert.match(freeze.deepEvidence.summarySha256, /^[0-9a-f]{64}$/);
  assert.match(freeze.securityEvidence.sha256, /^[0-9a-f]{64}$/);
  assert.match(freeze.reproducibilityEvidence.sha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.keys(freeze.contractDependencies).length, 6);
});

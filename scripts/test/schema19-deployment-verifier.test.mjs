import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(new URL("../..", import.meta.url).pathname);
const source = await readFile(
  path.join(repo, "scripts/verify-schema19-deployment.mjs"),
  "utf8",
);

test("verifier is Schema-19, chain, and loopback fail closed", () => {
  assert.match(source, /verified Schema-19 input required/);
  assert.match(source, /Schema-19 verification chain mismatch/);
  assert.match(source, /loopback LAN gateway or isolated fork/);
});

test("verifier compares immutable-normalized candidate and reused runtimes", () => {
  assert.match(source, /immutableReferences/);
  assert.match(source, /runtime length mismatch/);
  assert.match(source, /runtime mismatch/);
  assert.match(source, /reused runtime changed/);
  assert.match(source, /guardianSafe/);
  assert.match(source, /\.\.\.prepared\.external/);
});

test("verifier requires sole-owner governance and the one-hour Timelock", () => {
  assert.match(source, /Safe owner mismatch/);
  assert.match(source, /Safe threshold mismatch/);
  assert.match(source, /Safe modules changed/);
  assert.match(source, /RDAO ownership changed/);
  assert.match(source, /Timelock delay changed/);
  assert.match(source, /Governor Timelock changed/);
});

test("verifier requires Public zero-state accounting and ready routes", () => {
  assert.match(source, /Schema-19 is not active Public/);
  assert.match(source, /maintenance binding mismatch/);
  assert.match(source, /DAO reward binding mismatch/);
  assert.match(source, /graduation profile mismatch/);
  assert.match(source, /fallback policy mismatch/);
  assert.match(source, /nonzero Schema-19 genesis accounting/);
  assert.match(source, /route not ready/);
  assert.match(source, /unexpected native balance/);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "../..");
const address = (byte) => `0x${byte.repeat(40)}`;
const route = {
  fee: 10_000,
  tickSpacing: 200,
  hooks: address("0"),
  minimumLiquidity: "1",
  maximumNativeInput: "1000000000000",
  referenceTick: 0,
  maximumReferenceTickDeviation: 0,
  enforceReferencePrice: false,
  verificationClass: `0x${"44".repeat(32)}`,
  enabled: true,
};
const base = {
  schemaVersion: 17,
  chainId: 46630,
  releaseSha: "a".repeat(40),
  deployer: address("1"),
  guardianSafe: address("2"),
  startingNonce: 9,
  oracleHook: address("3"),
  bootstrapDomain: `0x${"55".repeat(32)}`,
  routes: [
    {
      symbol: "GOOGL",
      asset: address("4"),
      canary: route,
      public: { ...route, maximumNativeInput: "100000000000" },
    },
  ],
  wrappedNativeCanaryCapWei: "1000000000000",
  wrappedNativePublicCapWei: "100000000000",
};

const run = async (input) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "schema17-prepare-"));
  const inputPath = path.join(temporary, "input.json");
  const outputPath = path.join(temporary, "output.json");
  await writeFile(inputPath, JSON.stringify(input));
  execFileSync(
    "node",
    ["scripts/prepare-schema17-deployment.mjs", inputPath, outputPath],
    {
      cwd: repo,
    },
  );
  return JSON.parse(await readFile(outputPath, "utf8"));
};

test("prepares a deterministic exact two-step deployment manifest", async () => {
  const result = await run(base);
  assert.equal(result.schemaVersion, 17);
  assert.equal(result.deployment.transactions.length, 15);
  assert.equal(result.governance.bootstrap.steps.length, 2);
  assert.equal(
    result.governance.bootstrap.steps[0].calls.at(-1).label,
    "enter-canary-mode",
  );
  assert.equal(
    result.governance.bootstrap.steps[1].calls.at(-1).label,
    "enter-public-mode",
  );
});

test("rejects zero final hook and allows it only for explicit provisional prediction", async () => {
  await assert.rejects(
    () => run({ ...base, oracleHook: address("0") }),
    /nonzero oracle hook/,
  );
  const provisional = await run({
    ...base,
    oracleHook: address("0"),
    provisional: true,
  });
  assert.equal(provisional.provisional, true);
});

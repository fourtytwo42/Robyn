import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("deployment verifier reports missing contract addresses without an RPC call", () => {
  const directory = mkdtempSync(join(tmpdir(), "robyn-v4-verifier-"));
  const manifest = join(directory, "malformed.json");
  writeFileSync(
    manifest,
    JSON.stringify({
      chainId: 46630,
      schemaVersion: 10,
      liquidityVenue: "uniswap-v4",
      contracts: {},
    }),
  );
  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/verify-testnet-v4-deployment.mjs", manifest],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ROBYN_TESTNET_RPC_URL: "http://127.0.0.1:1",
        },
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.ok(output.failures.includes("manifest contains universalRouter"));
    assert.ok(output.failures.includes("manifest contains marketFactory"));
    assert.doesNotMatch(result.stdout, /eth_getCode/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

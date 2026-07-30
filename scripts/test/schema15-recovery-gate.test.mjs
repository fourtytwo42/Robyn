import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const scriptPath = resolve("scripts/schema15-recovery-gate.sh");
const source = readFileSync(scriptPath, "utf8");

describe("schema-15 recovery gate", () => {
  it("is valid shell and binds recovery to the active schema-15 database", () => {
    assert.doesNotThrow(() => execFileSync("bash", ["-n", scriptPath]));
    assert.match(source, /select\(\.name=="robyn-indexer-testnet"\)/);
    assert.match(
      source,
      /\.pm2_env\.PGDATABASE \/\/ \.pm2_env\.env\.PGDATABASE \/\/ empty/,
    );
    assert.match(source, /\^robyn_testnet_schema15_\[A-Za-z0-9_\]\+\$/);
    assert.match(source, /\.schemaVersion == 15/);
    assert.doesNotMatch(source, /database="robyn_testnet_rehearsal"/);
  });

  it("archives only public transaction journals and uses schema-15 backup identities", () => {
    assert.match(
      source,
      /\/home\/hendo420\/\.local\/state\/robyn-testnet-campaigns/,
    );
    assert.match(source, /\/var\/lib\/robyn\/testnet-endurance/);
    assert.match(source, /schema15-recovery-backups/);
    assert.match(source, /schema15-\$\{run_id\}\.tar\.zst/);
    assert.doesNotMatch(source, /schema11-recovery-backups/);
    assert.doesNotMatch(source, /schema11-one-hour/);
  });

  it("records expected health semantics during RPC interruption drills", () => {
    assert.match(source, /status_json_interrupted\(\)/);
    assert.match(source, /curl -sk --max-time 10 -o "\$\{output\}"/);
    assert.match(source, /"200" \|\| "\$\{http_status\}" == "503"/);
    assert.match(source, /\[\[ "\$\{http_status\}" == "503" \]\]/);
    assert.match(source, /if \$rpc_status=="degraded"/);
    assert.match(source, /\.rpc\.status==\$rpc_status/);
    assert.match(
      source,
      /status_json_interrupted "\$\{evidence\}\/lan-interruption-status\.json" ok/,
    );
    assert.match(
      source,
      /status_json_interrupted "\$\{evidence\}\/both-rpc-interruption-status\.json" degraded/,
    );
  });
});

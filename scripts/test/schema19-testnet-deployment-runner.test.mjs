import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(new URL("../..", import.meta.url).pathname);
const source = await readFile(
  path.join(repo, "scripts/run-schema19-testnet-deployment.mjs"),
  "utf8",
);

test("deployment runner is exact release, funding, chain, and LAN-policy bound", () => {
  assert.match(source, /exact clean pushed tooling/);
  assert.match(source, /passing exact Schema-19 funding report required/);
  assert.match(source, /wrong-chain or syncing/);
  assert.match(source, /fallbackTrafficAuthorized !== false/);
  assert.match(source, /loopback LAN gateway/);
});

test("deployment runner journals before submission and never replays ambiguity", () => {
  const intent = source.indexOf('type: "intent"');
  const send = source.indexOf("sendRawTransaction", intent);
  assert(intent > 0 && send > intent);
  assert.match(source, /unresolved signed intent; replay is prohibited/);
  assert.match(
    source,
    /submission is ambiguous; manual reconciliation required/,
  );
  assert.match(source, /confirmed receipt changed/);
  assert.match(source, /validateSchema19ForgeLedger/);
});

test("deployment runner doubles gas and preserves the Testnet reserve", () => {
  assert.match(source, /const gas = estimate \* 2n/);
  assert.match(source, /1_500_000_000_000_000n/);
  assert.match(source, /25_000_000_000_000n/);
  assert.match(source, /would breach the fixed Testnet reserve/);
});

test("deployment runner binds every signed transaction to chain 46630", () => {
  assert.match(source, /defineChain\(\{/);
  assert.match(source, /id: 46630/);
  assert.match(source, /createWalletClient\(\{[\s\S]*chain: testnetChain/);
});

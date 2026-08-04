import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deployment = await readFile(new URL("../run-schema19-mainnet-replacement.mjs", import.meta.url), "utf8");
const retirement = await readFile(new URL("../run-schema18-mainnet-public-live.mjs", import.meta.url), "utf8");
const sealer = await readFile(new URL("../seal-schema19-mainnet-replacement.mjs", import.meta.url), "utf8");

test("replacement deployment requires exact manifest authorization and LAN-only RPC", () => {
  assert.match(deployment, /schema19-deployment-schema18-archive-and-application-cutover/);
  assert.match(deployment, /fallbackTrafficAuthorized !== false/);
  assert.match(deployment, /unresolved signed intent; replay is prohibited/);
  assert.match(deployment, /20_000_000_000_000_000n/);
  assert.match(deployment, /exceeds sealed fee ceiling/);
});

test("legacy retirement accepts only the exact archived canary disposition", () => {
  assert.match(retirement, /schema19ReplacementRetirement && stage !== "shutdown"/);
  assert.match(retirement, /owner-accepted-test-canary-archive/);
  assert.match(retirement, /schema18ManifestSha256 !== manifestSha/);
  assert.match(retirement, /additionalBridgeAuthorized !== false/);
});

test("sealer binds frozen releases, funding, predicted addresses and disabled writes", () => {
  assert.match(sealer, /a67288133f09bce68b7386009d702c14dfb8bbab/);
  assert.match(sealer, /0873abd4332c6283b374c92de3ce244bc60f291c/);
  assert.match(sealer, /predicted Schema-19 address already contains code/);
  assert.match(sealer, /writesInitiallyDisabled: true/);
  assert.match(sealer, /bridgeAmountWei: "0"/);
});

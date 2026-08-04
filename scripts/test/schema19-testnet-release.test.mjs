import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Schema-19 Testnet release verifier persists qualified state evidence", async () => {
  const source = await readFile("scripts/verify-testnet-release.sh", "utf8");

  assert.match(
    source,
    /deployment_verify_file=\/tmp\/robyn-testnet-deployment-verify\.json/,
  );
  assert.match(source, /rm -f "\$deployment_verify_file"/);
  assert.match(
    source,
    /verify-schema19-qualified-testnet\.mjs[\s\\\n]+"\$manifest"[\s\\\n]+"\$deployment_verify_file"/,
  );
  assert.match(source, /jq -e '\.passed == true' "\$deployment_verify_file"/);
  assert.match(source, /\.launchCount <<<"\$status"\)" -eq 1/);
  assert.match(source, /\.trackedLaunches <<<"\$observed"\)" -eq 1/);
  assert.match(source, /\.trackedPoolIds <<<"\$observed"\)" -eq 1/);
  assert.doesNotMatch(
    source,
    /verify-schema19-qualified-testnet\.mjs "\$manifest"\s*>/,
  );
});

test("Schema-19 application releases attest frozen contracts without protocol recompilation", async () => {
  const source = await readFile("scripts/build-testnet-release.sh", "utf8");

  assert.match(source, /verify-schema19-contract-freeze\.mjs/);
  assert.match(source, /test:testnet-application-scope/);
  assert.match(source, /contractMode:\"frozen-schema19\"/);
  assert.match(source, /two-build-reproducibility/);
  assert.match(source, /cmp \"\$runtime_a\" \"\$runtime_b\"/);
  assert.match(source, /! -path '\*\/\.next\/cache\/\*' ! -name trace/);
  assert.doesNotMatch(source, /pnpm test(?:\s|$)/m);
  assert.doesNotMatch(source, /forge (?:build|test)/);
  assert.doesNotMatch(source, /--filter @robyn\/keeper/);
});

test("Schema-19 qualified verification requires maintenance and complete asset presentation", async () => {
  const source = await readFile(
    "scripts/verify-schema19-qualified-testnet.mjs",
    "utf8",
  );

  assert.match(source, /qualified Schema-19 maintenance policy mismatch/);
  assert.match(source, /qualified Schema-19 asset catalog mismatch/);
  assert.match(source, /tasksPerUserAction !== 1/);
  assert.match(source, /catalogAssets\.length !== rewardAssets\.length/);
});

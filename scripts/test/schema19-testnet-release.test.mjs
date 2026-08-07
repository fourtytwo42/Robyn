import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("Schema-19 and Schema-20 Testnet release verifier persists qualified state evidence", async () => {
  const source = await readFile("scripts/verify-testnet-release.sh", "utf8");

  assert.match(
    source,
    /deployment_verify_file=\/tmp\/robyn-testnet-deployment-verify\.json/,
  );
  assert.match(source, /rm -f "\$deployment_verify_file"/);
  assert.match(source, /verify-schema19-qualified-testnet\.mjs/);
  assert.match(source, /verify-schema20-qualified-testnet\.mjs/);
  assert.match(source, /jq -e '\.passed == true' "\$deployment_verify_file"/);
  assert.match(
    source,
    /\.launchCount <<<"\$status"\)" -eq "\$expected_launches"/,
  );
  assert.match(
    source,
    /\.trackedLaunches <<<"\$observed"\)" -eq "\$expected_launches"/,
  );
  assert.match(source, /\.trackedPoolIds <<<"\$observed"\)" -ge 1/);
  assert.doesNotMatch(
    source,
    /verify-schema19-qualified-testnet\.mjs "\$manifest"\s*>/,
  );
});

test("Schema-19 and Schema-20 application releases attest frozen contracts without protocol recompilation", async () => {
  const source = await readFile("scripts/build-testnet-release.sh", "utf8");

  assert.match(source, /verify-schema19-contract-freeze\.mjs/);
  assert.match(source, /verify-schema20-contract-freeze\.mjs/);
  assert.match(source, /test:testnet-application-scope/);
  assert.match(source, /contractMode:\$contractMode/);
  assert.match(source, /deploymentManifestPath:\$deploymentManifestPath/);
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

test("Schema-20 runtime verification is self-contained in protected releases", async () => {
  const source = await readFile(
    "scripts/verify-schema20-qualified-testnet.mjs",
    "utf8",
  );

  assert.match(source, /const factory = parseAbi/);
  assert.match(source, /const router = parseAbi/);
  assert.match(source, /executionRouteStatus\(address asset\)/);
  assert.doesNotMatch(source, /packages\/contracts\/out/);
  assert.doesNotMatch(source, /artifact\(/);
});

test("every numbered database migration records its own ledger version", async () => {
  const files = (await readdir("packages/db/migrations"))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const source = await readFile(`packages/db/migrations/${file}`, "utf8");
    assert.match(
      source,
      new RegExp(`INSERT\\s+INTO\\s+schema_migrations\\s*\\(version\\)`, "i"),
      `${file} must write the migration ledger`,
    );
    assert.match(source, new RegExp(`['\"]${version}['\"]`));
  }
});

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

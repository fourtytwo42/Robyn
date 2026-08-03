import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertAdditiveMigrations,
  assertReleaseTreeIntegrity,
  assertSecretFreeTree,
  classifyProductionChanges,
  validateProductionAcceptance,
  validateProductionRelease,
} from "../lib/production-release.mjs";

const policy = {
  chainId: 4663,
  contractClosureHash: "a".repeat(40),
  deploymentManifestHash: "b".repeat(64),
};
const valid = {
  schemaVersion: 1,
  sourceSha: "c".repeat(40),
  applicationArtifactHash: "d".repeat(64),
  runtimeArchiveHash: "9".repeat(64),
  changeScope: "ui",
  contractClosureHash: policy.contractClosureHash,
  deploymentManifestHash: policy.deploymentManifestHash,
  chainId: 4663,
  migrationSetHash: "e".repeat(64),
  processTopologyHash: "f".repeat(64),
  requiredPreviousRelease: "old",
  acceptanceReferences: [
    { environment: "devnet", sha256: "1".repeat(64) },
    { environment: "testnet", sha256: "2".repeat(64) },
    { environment: "mainnet-staging", sha256: "3".repeat(64) },
  ],
  rpcPolicy: { primary: "lan-only", probeOnly: true, automaticFallback: false },
};

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

test("classifies UI-only work without invoking contract qualification", () => {
  assert.equal(classifyProductionChanges(["apps/web/src/a.tsx"]), "ui");
  assert.equal(classifyProductionChanges(["apps/api/src/a.ts"]), "data");
  assert.equal(
    classifyProductionChanges(["apps/web/a", "apps/api/b"]),
    "mixed",
  );
  assert.equal(
    classifyProductionChanges(["packages/contracts/src/A.sol"]),
    "contracts",
  );
});
test("validates pinned chain, closure, prior release, and LAN-only policy", () => {
  assert.equal(
    validateProductionRelease(valid, policy, { currentRelease: "old" }),
    valid,
  );
  assert.throws(
    () => validateProductionRelease({ ...valid, chainId: 1 }, policy),
    /chainId/,
  );
  assert.throws(
    () =>
      validateProductionRelease(
        { ...valid, requiredPreviousRelease: "wrong" },
        policy,
        { currentRelease: "old" },
      ),
    /requiredPreviousRelease/,
  );
  assert.throws(
    () =>
      validateProductionRelease(
        { ...valid, rpcPolicy: { primary: "alchemy" } },
        policy,
      ),
    /rpcPolicy/,
  );
  const missingRuntimeHash = { ...valid };
  delete missingRuntimeHash.runtimeArchiveHash;
  assert.throws(
    () => validateProductionRelease(missingRuntimeHash, policy),
    /runtimeArchiveHash/,
  );
  assert.throws(
    () =>
      validateProductionRelease(
        {
          ...valid,
          acceptanceReferences: [
            valid.acceptanceReferences[0],
            valid.acceptanceReferences[0],
            valid.acceptanceReferences[2],
          ],
        },
        policy,
      ),
    /acceptanceReferences/,
  );
});
test("rejects secret-bearing runtime bundles and destructive migrations", () => {
  const root = mkdtempSync(path.join(tmpdir(), "robyn-prod-release-"));
  mkdirSync(path.join(root, "config"));
  writeFileSync(path.join(root, "config", "runtime.json"), "{}");
  assert.doesNotThrow(() => assertSecretFreeTree(root));
  writeFileSync(
    path.join(root, "deployer-private-key.txt"),
    "not-even-a-real-key",
  );
  assert.throws(() => assertSecretFreeTree(root), /Secret-bearing/);
  const migrations = path.join(root, "migrations");
  mkdirSync(migrations);
  writeFileSync(
    path.join(migrations, "0001_ok.sql"),
    "CREATE TABLE IF NOT EXISTS ok(id integer);",
  );
  assert.doesNotThrow(() => assertAdditiveMigrations(migrations));
  writeFileSync(path.join(migrations, "0002_bad.sql"), "DROP TABLE ok;");
  assert.throws(() => assertAdditiveMigrations(migrations), /Non-additive/);
});

test("requires exact, passing, fail-closed environment acceptance", () => {
  const expected = {
    environment: "mainnet-staging",
    sourceSha: valid.sourceSha,
    changeScope: "infrastructure",
    contractClosureHash: policy.contractClosureHash,
  };
  const acceptance = {
    schemaVersion: 1,
    ...expected,
    passed: true,
    completedAt: "2026-08-02T22:00:00Z",
    checks: [{ name: "read-only RPC policy", passed: true }],
    rpcPolicy: {
      automaticFallback: false,
      transactionSubmissionDefault: false,
    },
  };
  assert.equal(validateProductionAcceptance(acceptance, expected), acceptance);
  assert.throws(
    () =>
      validateProductionAcceptance(
        { ...acceptance, sourceSha: "0".repeat(40) },
        expected,
      ),
    /sourceSha/,
  );
  assert.throws(
    () => validateProductionAcceptance({ ...acceptance, checks: [] }, expected),
    /checks/,
  );
});

test("binds every runtime file and acceptance record to the signed manifest", () => {
  const root = mkdtempSync(path.join(tmpdir(), "robyn-prod-integrity-"));
  const evidenceRoot = path.join(root, "release-evidence");
  mkdirSync(evidenceRoot);
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  const acceptanceReferences = [];
  const checksumLines = [];
  writeFileSync(path.join(root, "runtime.txt"), "trusted runtime");
  checksumLines.push(sha256("trusted runtime") + "  ./runtime.txt");
  for (const environment of ["devnet", "testnet", "mainnet-staging"]) {
    const body = JSON.stringify({
      environment,
      passed: true,
      sourceSha: valid.sourceSha,
    });
    const relative = "release-evidence/" + environment + ".json";
    writeFileSync(path.join(root, relative), body);
    const hash = sha256(body);
    acceptanceReferences.push({ environment, sha256: hash });
    checksumLines.push(hash + "  ./" + relative);
  }
  const checksumBody = checksumLines.join("\n") + "\n";
  writeFileSync(path.join(root, "release-files.sha256"), checksumBody);
  const manifest = {
    ...valid,
    applicationArtifactHash: sha256(checksumBody),
    acceptanceReferences,
  };

  assert.doesNotThrow(() => assertReleaseTreeIntegrity(root, manifest));
  writeFileSync(path.join(root, "runtime.txt"), "tampered runtime");
  assert.throws(
    () => assertReleaseTreeIntegrity(root, manifest),
    /Release file checksum mismatch/,
  );
});

test("production updater follows authenticated asset redirects under the hardened service", () => {
  const updater = readFileSync(
    path.join(repositoryRoot, "scripts", "production-updater.sh"),
    "utf8",
  );
  const installer = readFileSync(
    path.join(repositoryRoot, "scripts", "install-production-mainnet-host.sh"),
    "utf8",
  );
  const updaterService = readFileSync(
    path.join(
      repositoryRoot,
      "infrastructure",
      "systemd",
      "robyn-prod-updater.service",
    ),
    "utf8",
  );
  const tunnelService = readFileSync(
    path.join(
      repositoryRoot,
      "infrastructure",
      "systemd",
      "robyn-production-tunnel.service",
    ),
    "utf8",
  );
  const productionNginx = readFileSync(
    path.join(
      repositoryRoot,
      "infrastructure",
      "nginx",
      "robyn-mainnet-production.conf",
    ),
    "utf8",
  );
  const stagingMainnetNginx = readFileSync(
    path.join(
      repositoryRoot,
      "infrastructure",
      "nginx",
      "robyn-schema18-mainnet-public.conf",
    ),
    "utf8",
  );
  const stagingRetentionService = readFileSync(
    path.join(
      repositoryRoot,
      "infrastructure",
      "systemd",
      "robyn-staging-retention.service",
    ),
    "utf8",
  );

  assert.match(
    updater,
    /curl -fsSL --proto '=https' --proto-redir '=https' --max-redirs 3/,
  );
  assert.match(
    updater,
    /headers=\(-H "X-GitHub-Api-Version: 2022-11-28"\)/,
  );
  assert.match(
    updater,
    /-H "Accept: application\/vnd\.github\+json" "\$\{api\}\/releases\?per_page=30"/,
  );
  assert.match(
    updater,
    /-H "Accept: application\/octet-stream" "\$\{url\}"/,
  );
  assert.match(
    updater,
    /tar --no-same-owner --zstd -xf "\$\{work\}\/runtime\.tar\.zst"/,
  );
  assert.match(
    updater,
    /case "\$\{staging\}" in \/opt\/robyn\/staging\/\*\) rm -rf -- "\$\{staging\}"/,
  );
  assert.match(updater, /release-agent config must use LF line endings/);
  const moveIndex = updater.indexOf('mv "${staging}" "${target}"');
  const readableIndex = updater.indexOf('chmod -R a+rX,go-w "${target}"');
  const immutableIndex = updater.indexOf('chmod -R a-w "${target}"');
  assert.ok(
    moveIndex >= 0 && readableIndex > moveIndex && immutableIndex > readableIndex,
  );
  assert.match(
    updaterService,
    /^CapabilityBoundingSet=CAP_SETUID CAP_SETGID$/m,
  );
  assert.doesNotMatch(updaterService, /CAP_DAC_OVERRIDE|CAP_CHOWN|CAP_NET_ADMIN/);
  assert.match(updaterService, /^WorkingDirectory=\/$/m);
  assert.match(updater, /HOME=\/var\/lib\/robynapp/);
  assert.match(
    updater,
    /ecosystem\.mainnet\.production\.config\.cjs/,
  );
  assert.match(
    updater,
    /ecosystem\.mainnet\.production\.cjs" \\\n+    "\$\{pm2_config\}"/,
  );
  assert.match(updater, /apply_migrations "\$\{target\}"/);
  assert.match(
    updater,
    /\/usr\/local\/bin\/pm2 delete "\$\{process_names\[@\]\}"/,
  );
  assert.match(updater, /\/usr\/local\/bin\/pm2 start "\$\{pm2_config\}" --update-env/);
  assert.doesNotMatch(updater, /startOrReload/);
  assert.match(updater, /curl -fsS http:\/\/127\.0\.0\.1:3121\/health/);
  assert.match(
    updater,
    /SELECT EXISTS \(SELECT 1 FROM schema_migrations WHERE version = '\$\{version\}'\)/,
  );
  assert.doesNotMatch(updater, /packages\/db\/dist\/migrate\.js/);
  assert.match(
    installer,
    /install -d -o root -g robyn-release -m 0750 \/var\/lib\/robyn-release \/var\/lib\/robyn-release\/downloads/,
  );
  assert.match(
    installer,
    /install -d -o root -g root -m 0751 \/var\/lib\/robyn/,
  );
  assert.match(
    tunnelService,
    /^ExecStart=\/usr\/bin\/cloudflared tunnel --no-autoupdate run --token \$\{TUNNEL_TOKEN\}$/m,
  );
  assert.match(productionNginx, /server_name www\.sherwoodforest\.trade;/);
  assert.match(
    productionNginx,
    /listen 192\.168\.50\.108:3082 default_server;/,
  );
  assert.match(
    productionNginx,
    /return 308 https:\/\/sherwoodforest\.trade\$request_uri;/,
  );
  assert.match(productionNginx, /proxy_pass http:\/\/127\.0\.0\.1:18549\/;/);
  assert.match(
    productionNginx,
    /location = \/internal\/health \{\s*return 404;\s*\}/,
  );
  assert.match(stagingMainnetNginx, /listen 192\.168\.50\.250:3082;/);
  assert.match(
    stagingMainnetNginx,
    /proxy_pass http:\/\/127\.0\.0\.1:18549\/;/,
  );
  assert.match(
    stagingRetentionService,
    /^ExecStart=\/usr\/local\/lib\/robyn\/prune-mainnet-staging-history\.sh --execute$/m,
  );
});

test("Mainnet application finalization is independent of contract build output", () => {
  const finalizer = readFileSync(
    path.join(
      repositoryRoot,
      "scripts",
      "finalize-schema18-mainnet-application-manifest.mjs",
    ),
    "utf8",
  );

  assert.match(finalizer, /const ROUTER_CONFIGURATION_ABI = \[/);
  assert.match(finalizer, /name: "configureRoute"/);
  assert.match(finalizer, /name: "configureWrappedNativeRoute"/);
  assert.doesNotMatch(finalizer, /packages\/contracts\/out/);
  assert.match(
    finalizer,
    /INDEXING_POLICY_HASH = "5e92d61940f39b05f7b61273b0a2d190d77cf204369a224822b098a4f5ca01e1"/,
  );
  assert.match(finalizer, /factory: lifecycle\.contracts\.launchFactory/);
  assert.match(finalizer, /factory: baseline\.contracts\.factory/);
});

test("production promotion reads but does not advance deployed-release state", () => {
  const promoter = readFileSync(
    path.join(repositoryRoot, "scripts", "promote-mainnet-production.mjs"),
    "utf8",
  );

  assert.match(
    promoter,
    /\["-u", "robyn-release", "cat", stateFile\]/,
  );
  assert.doesNotMatch(promoter, /sourceSha: sha, tag, publishedAt:/);
  assert.doesNotMatch(promoter, /candidateState,\s*stateFile,/);
});

test("mixed application releases reuse the frozen contract attestation", () => {
  const promoter = readFileSync(
    path.join(repositoryRoot, "scripts", "promote-mainnet-production.mjs"),
    "utf8",
  );
  const packageJson = JSON.parse(
    readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );

  assert.match(
    promoter,
    /mixed: \["pnpm", \["test:application-scope"\]\]/,
  );
  assert.match(
    packageJson.scripts["test:application-scope"],
    /^pnpm test:contracts:freeze /,
  );
  assert.doesNotMatch(
    packageJson.scripts["test:application-scope"],
    /(^|&&\s*)pnpm test:contracts(\s|$)/,
  );
  assert.doesNotMatch(packageJson.scripts["test:application-scope"], /forge/);
});

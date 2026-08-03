import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const ecosystem = path.join(
  repo,
  "infrastructure/pm2/ecosystem.mainnet.production.cjs",
);
const buildScript = readFileSync(
  path.join(repo, "scripts/build-mainnet-production-runtime.sh"),
  "utf8",
);
const promotionScript = readFileSync(
  path.join(repo, "scripts/promote-mainnet-production.mjs"),
  "utf8",
);
const baseEnv = {
  ...process.env,
  ROBYN_PRODUCTION_RELEASE_ROOT: "/opt/robyn/releases/candidate",
  ROBYN_MAINNET_MANIFEST: "/opt/robyn/current/deployments/4663-mainnet.json",
  ROBYN_MAINNET_PRIMARY_RPC_URL: "http://192.168.50.173:8547",
  ROBYN_MAINNET_PROBE_RPC_URL: "https://probe.invalid",
  ROBYN_RELEASE_SHA: "a".repeat(40),
};
const load = (environment = baseEnv) =>
  JSON.parse(
    execFileSync(
      "node",
      [
        "-e",
        "const x=require(process.argv[1]);process.stdout.write(JSON.stringify(x))",
        ecosystem,
      ],
      { cwd: repo, env: environment, encoding: "utf8" },
    ),
  );

test("production topology is six keyless services with no keeper", () => {
  const topology = load();
  assert.equal(topology.apps.length, 6);
  assert.deepEqual(
    new Set(topology.apps.map((app) => app.name)),
    new Set([
      "robyn-web-mainnet-prod",
      "robyn-api-mainnet-prod",
      "robyn-indexer-mainnet-prod",
      "robyn-projector-mainnet-prod",
      "robyn-artifacts-mainnet-prod",
      "robyn-rpc-gateway-mainnet-prod",
    ]),
  );
  assert.equal(
    topology.apps.some((app) => app.name.includes("keeper")),
    false,
  );
  const api = topology.apps.find((app) => app.name === "robyn-api-mainnet-prod");
  assert.equal(api.env.ROBYN_KEEPER_EXPECTED, "false");
  assert.equal(
    api.env.ROBYN_MANIFEST,
    "/opt/robyn/releases/candidate/deployments/4663-mainnet.json",
  );
  const indexer = topology.apps.find(
    (app) => app.name === "robyn-indexer-mainnet-prod",
  );
  assert.equal(indexer.env.ROBYN_MANIFEST, api.env.ROBYN_MANIFEST);
  const gateway = topology.apps.find((app) => app.name.includes("rpc-gateway"));
  assert.equal(gateway.env.RPC_ACTIVE_PROVIDER, "primary");
  assert.equal(gateway.env.RPC_FALLBACK_TRAFFIC_AUTHORIZED, "false");
  assert.equal(gateway.env.RPC_TRANSACTION_SUBMISSION_AUTHORIZED, "false");
});

test("production topology refuses signer-bearing environments", () => {
  assert.throws(
    () => load({ ...baseEnv, DEPLOYER_PRIVATE_KEY: "forbidden" }),
    /Forbidden signer setting/,
  );
});

test("production build consumes a hash-pinned builder-readable deployment manifest", () => {
  assert.match(buildScript, /ROBYN_RELEASE_MANIFEST_INPUT/);
  assert.match(buildScript, /deploymentManifestHash/);
  assert.match(buildScript, /release manifest input hash mismatch/);
  assert.match(
    promotionScript,
    /ROBYN_RELEASE_MANIFEST_INPUT=\/var\/lib\/robyn-release\/inputs\/4663-mainnet\.json/,
  );
  assert.doesNotMatch(buildScript, /package-import-method=copy/);
  assert.match(buildScript, /chmod 0444/);
  assert.match(promotionScript, /robyn-release-signing-/);
  assert.match(promotionScript, /production-release\.json\.sig/);
  assert.match(promotionScript, /\/var\/tmp\/robyn-release-out/);
  assert.match(buildScript, /rm -rf "\$\{runtime\}"/);
});

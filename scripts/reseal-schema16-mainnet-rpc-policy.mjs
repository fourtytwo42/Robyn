#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const EXPECTED_RELEASE = "a8d54bb125d091be0cea010262a68a2baaceda30";
const EXPECTED_OLD_MANIFEST_SHA =
  "030a049fb902bbce1fe78bff773aec3835ae99b7cdeb6337d69f8f19bd9fc980";
const EXPECTED_OLD_TOOLING = "af3663a38aca76eccc8e2edb483558f4c4c5725a";
const EXPECTED_GATEWAY = "17338466f55b3b5559d2248f3510681820d95834";
const EXPECTED_POLICY_EVIDENCE_SHA =
  "1f196d23b71c43e02d4c55ce2a881e9866b9cab6661fabf8df1917c9685400eb";
const EXPECTED_BRIDGE_AMOUNT = "32107112992656000";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return resolve(value);
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const sourceDirectory = required("ROBYN_MAINNET_SUPERSEDED_MANIFEST_DIRECTORY");
const policyEvidencePath = required("ROBYN_MAINNET_RPC_POLICY_EVIDENCE");
const outputDirectory = required("ROBYN_MAINNET_RESEALED_MANIFEST_DIRECTORY");
const sourceManifestPath = resolve(
  sourceDirectory,
  "schema16-mainnet-deployment-manifest.json",
);
const sourceManifestRaw = await readFile(sourceManifestPath, "utf8");
if (sha256(sourceManifestRaw) !== EXPECTED_OLD_MANIFEST_SHA) {
  throw new Error("superseded manifest identity mismatch");
}
const source = JSON.parse(sourceManifestRaw);
if (
  source.releaseSha !== EXPECTED_RELEASE ||
  source.operationalToolingSha !== EXPECTED_OLD_TOOLING ||
  source.funding?.bridgeAmountWei !== EXPECTED_BRIDGE_AMOUNT ||
  source.authorizationEligible !== true ||
  source.bridgeAuthorized !== false ||
  source.deploymentAuthorized !== false ||
  source.canaryAuthorized !== false ||
  source.publicActivationAuthorized !== false
) {
  throw new Error("superseded manifest does not match the authorized baseline");
}

const toolingSha = git("rev-parse", "HEAD");
if (git("status", "--porcelain") !== "") {
  throw new Error("policy reseal requires a clean tooling worktree");
}
let upstreamSha;
try {
  upstreamSha = git("rev-parse", "@{upstream}");
} catch {
  throw new Error("policy reseal requires a configured upstream");
}
if (toolingSha !== upstreamSha) {
  throw new Error("policy reseal requires the exact pushed tooling commit");
}
for (const commit of [EXPECTED_OLD_TOOLING, EXPECTED_GATEWAY, EXPECTED_RELEASE]) {
  execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
    stdio: "ignore",
  });
}

const policyRaw = await readFile(policyEvidencePath, "utf8");
if (sha256(policyRaw) !== EXPECTED_POLICY_EVIDENCE_SHA) {
  throw new Error("RPC policy evidence checksum mismatch");
}
const policy = JSON.parse(policyRaw);
const policyText = JSON.stringify(policy).toLowerCase();
if (
  !policyText.includes(EXPECTED_GATEWAY) ||
  !policyText.includes("fallbacktrafficauthorized") ||
  !policyText.includes("paidfallbackcu")
) {
  throw new Error("RPC policy evidence is incomplete");
}

const manifest = {
  ...source,
  sealedAt: new Date().toISOString(),
  deploymentToolingSha: toolingSha,
  rpcPolicy: {
    gatewayReleaseSha: EXPECTED_GATEWAY,
    evidenceSha256: EXPECTED_POLICY_EVIDENCE_SHA,
    activeProvider: "lan",
    fallbackSelection: "operator-only",
    alchemyPermittedMethods: ["eth_chainId", "eth_blockNumber", "eth_syncing"],
    automaticApplicationFallback: false,
    lanFailureBehavior: "degraded-and-financial-writes-disabled",
  },
  authorization: {
    scope: ["canonical-bridge", "paused-deployment"],
    source: "explicit-product-owner-instruction",
    inheritedFromManifestSha256: EXPECTED_OLD_MANIFEST_SHA,
    maximumBridgeAmountWei: EXPECTED_BRIDGE_AMOUNT,
    canaryExcluded: true,
    routeEnablementExcluded: true,
    conversionEnablementExcluded: true,
    applicationWritesExcluded: true,
    publicActivationExcluded: true,
  },
  policyOnlyReseal: true,
  bridgeAuthorized: true,
  deploymentAuthorized: true,
  canaryAuthorized: false,
  publicActivationAuthorized: false,
};

await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
const sourceSums = (await readFile(resolve(sourceDirectory, "SHA256SUMS"), "utf8"))
  .trim()
  .split("\n")
  .map((line) => line.trim().split(/\s+/).at(-1))
  .filter((name) => name && name !== basename(sourceManifestPath));
const checksumLines = [];
for (const name of sourceSums) {
  const raw = await readFile(resolve(sourceDirectory, name));
  await writeFile(resolve(outputDirectory, name), raw, { mode: 0o600, flag: "wx" });
  checksumLines.push(`${sha256(raw)}  ${name}`);
}
const policyName = "rpc-policy-verification.json";
await writeFile(resolve(outputDirectory, policyName), policyRaw, {
  mode: 0o600,
  flag: "wx",
});
checksumLines.push(`${sha256(policyRaw)}  ${policyName}`);
const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestName = "schema16-mainnet-deployment-manifest.json";
await writeFile(resolve(outputDirectory, manifestName), manifestRaw, {
  mode: 0o600,
  flag: "wx",
});
checksumLines.unshift(`${sha256(manifestRaw)}  ${manifestName}`);
await writeFile(
  resolve(outputDirectory, "SHA256SUMS"),
  `${checksumLines.join("\n")}\n`,
  { mode: 0o600, flag: "wx" },
);
process.stdout.write(
  `${JSON.stringify(
    {
      manifestPath: resolve(outputDirectory, manifestName),
      manifestSha256: sha256(manifestRaw),
      deploymentToolingSha: toolingSha,
      bridgeAuthorized: true,
      deploymentAuthorized: true,
      canaryAuthorized: false,
      publicActivationAuthorized: false,
    },
    null,
    2,
  )}\n`,
);

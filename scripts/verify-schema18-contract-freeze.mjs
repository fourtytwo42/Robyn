#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const freeze = JSON.parse(readFileSync(path.join(repo, "config/schema18-contract-freeze.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));

const gitObject = (spec) =>
  execFileSync("git", ["rev-parse", spec], { cwd: repo, encoding: "utf8" }).trim();
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const requireEqual = (label, actual, expected) => {
  if (actual !== expected) throw new Error(`${label} changed: expected ${expected}, received ${actual}`);
};

requireEqual("contract source tree", gitObject("HEAD:packages/contracts/src"), freeze.sourceTreeGitObject);
requireEqual(
  "Foundry configuration",
  gitObject("HEAD:packages/contracts/foundry.toml"),
  freeze.foundryConfigGitObject,
);
for (const [name, version] of Object.entries(freeze.contractDependencies)) {
  requireEqual(`contract dependency ${name}`, packageJson.devDependencies?.[name], version);
}

const releaseRoot = process.env.ROBYN_CONTRACT_QUALIFICATION_RELEASE
  ? path.resolve(process.env.ROBYN_CONTRACT_QUALIFICATION_RELEASE)
  : `/opt/robyn/releases/${freeze.qualificationReleaseId}`;
const securityEvidence = path.join(releaseRoot, "release-evidence/static-security-audit.json");
const releaseManifest = path.join(releaseRoot, "release-manifest.json");
requireEqual("contract security evidence", sha256(securityEvidence), freeze.securityEvidenceSha256);
requireEqual("qualification release manifest", sha256(releaseManifest), freeze.releaseManifestSha256);

const security = JSON.parse(readFileSync(securityEvidence, "utf8"));
if (
  security.passed !== true ||
  security.gitSha !== freeze.fullGateGitSha ||
  security.contracts?.foundrySuitesPassed !== true ||
  security.contracts?.unresolvedHigh !== 0 ||
  security.contracts?.unresolvedMedium !== 0
) {
  throw new Error("frozen contract qualification evidence is not passing or does not match the attested release");
}

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      passed: true,
      contractSchema: freeze.contractSchema,
      qualifiedContractGitSha: freeze.qualifiedContractGitSha,
      fullGateGitSha: freeze.fullGateGitSha,
      sourceTreeGitObject: freeze.sourceTreeGitObject,
      foundryConfigGitObject: freeze.foundryConfigGitObject,
      securityEvidenceSha256: freeze.securityEvidenceSha256,
      releaseManifestSha256: freeze.releaseManifestSha256,
      releaseRoot,
    },
    null,
    2,
  )}\n`,
);

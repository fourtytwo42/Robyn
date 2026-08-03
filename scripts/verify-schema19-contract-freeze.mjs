#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const freeze = JSON.parse(
  readFileSync(path.join(repo, "config/schema19-contract-freeze.json"), "utf8"),
);
const packageJson = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
const gitObject = (spec) =>
  execFileSync("git", ["rev-parse", spec], { cwd: repo, encoding: "utf8" }).trim();
const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const equal = (label, actual, expected) => {
  if (actual !== expected) {
    throw new Error(`${label} changed: expected ${expected}, received ${actual}`);
  }
};

equal("contract source tree", gitObject("HEAD:packages/contracts/src"), freeze.sourceTreeGitObject);
equal("deployment script tree", gitObject("HEAD:packages/contracts/script"), freeze.scriptTreeGitObject);
equal(
  "Foundry configuration",
  gitObject("HEAD:packages/contracts/foundry.toml"),
  freeze.foundryConfigGitObject,
);
for (const [name, version] of Object.entries(freeze.contractDependencies)) {
  equal(`contract dependency ${name}`, packageJson.devDependencies?.[name], version);
}

const deepSummaryPath = path.join(freeze.deepEvidence.directory, "summary.json");
const deepChecksumsPath = path.join(freeze.deepEvidence.directory, "SHA256SUMS");
const coverageScopePath = path.join(freeze.deepEvidence.directory, "coverage-scope.json");
equal("deep summary", sha256(deepSummaryPath), freeze.deepEvidence.summarySha256);
equal("deep checksums", sha256(deepChecksumsPath), freeze.deepEvidence.checksumsSha256);
equal("coverage scope", sha256(coverageScopePath), freeze.deepEvidence.coverageScopeSha256);
equal("security evidence", sha256(freeze.securityEvidence.path), freeze.securityEvidence.sha256);
equal(
  "reproducibility evidence",
  sha256(freeze.reproducibilityEvidence.path),
  freeze.reproducibilityEvidence.sha256,
);

const deep = JSON.parse(readFileSync(deepSummaryPath, "utf8"));
const security = JSON.parse(readFileSync(freeze.securityEvidence.path, "utf8"));
const reproducibility = JSON.parse(
  readFileSync(freeze.reproducibilityEvidence.path, "utf8"),
);
if (
  deep.passed !== true ||
  deep.schema !== 19 ||
  deep.tier !== "deep" ||
  deep.releaseSha !== freeze.qualifiedContractGitSha ||
  security.passed !== true ||
  security.contracts?.foundrySuitesPassed !== true ||
  security.contracts?.unresolvedHigh !== 0 ||
  security.contracts?.unresolvedMedium !== 0 ||
  reproducibility.passed !== true ||
  reproducibility.comparisons?.contractSemantics !== true
) {
  throw new Error("Schema-19 qualification evidence is not passing");
}

process.stdout.write(
  `${JSON.stringify({
    schemaVersion: 1,
    contractSchema: 19,
    qualifiedContractGitSha: freeze.qualifiedContractGitSha,
    sourceTreeGitObject: freeze.sourceTreeGitObject,
    scriptTreeGitObject: freeze.scriptTreeGitObject,
    foundryConfigGitObject: freeze.foundryConfigGitObject,
    deepSummarySha256: freeze.deepEvidence.summarySha256,
    securityEvidenceSha256: freeze.securityEvidence.sha256,
    reproducibilityEvidenceSha256: freeze.reproducibilityEvidence.sha256,
    passed: true,
  })}\n`,
);

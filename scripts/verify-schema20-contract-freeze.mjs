#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const freeze = JSON.parse(
  readFileSync(path.join(repo, "config/schema20-contract-freeze.json"), "utf8"),
);
const packageJson = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
const gitObject = (spec) =>
  execFileSync("git", ["rev-parse", spec], { cwd: repo, encoding: "utf8" }).trim();
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const equal = (label, actual, expected) => {
  if (actual !== expected) {
    throw new Error(`${label} changed: expected ${expected}, received ${actual}`);
  }
};

equal("contract source tree", gitObject("HEAD:packages/contracts/src"), freeze.sourceTreeGitObject);
equal("deployment script tree", gitObject("HEAD:packages/contracts/script"), freeze.scriptTreeGitObject);
equal("Foundry configuration", gitObject("HEAD:packages/contracts/foundry.toml"), freeze.foundryConfigGitObject);
for (const [name, version] of Object.entries(freeze.contractDependencies)) {
  equal(`contract dependency ${name}`, packageJson.devDependencies?.[name], version);
}

const evidence = freeze.deepEvidence.directory;
const summaryPath = path.join(evidence, "summary.json");
const checksumsPath = path.join(evidence, freeze.deepEvidence.checksumsFile);
const scopePath = path.join(evidence, "coverage-scope.json");
const validationPath = path.join(evidence, "validation.json");
equal("deep summary", sha256(summaryPath), freeze.deepEvidence.summarySha256);
equal("deep checksums", sha256(checksumsPath), freeze.deepEvidence.checksumsSha256);
equal("coverage scope", sha256(scopePath), freeze.deepEvidence.coverageScopeSha256);
equal("coverage validation", sha256(validationPath), freeze.deepEvidence.validationSha256);

for (const line of readFileSync(checksumsPath, "utf8").trim().split("\n")) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  if (!match) throw new Error(`invalid deep checksum line: ${line}`);
  const target = path.resolve(evidence, match[2]);
  if (!target.startsWith(`${path.resolve(evidence)}${path.sep}`)) {
    throw new Error(`deep checksum escapes evidence directory: ${match[2]}`);
  }
  equal(`deep evidence ${match[2]}`, sha256(target), match[1]);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const scope = JSON.parse(readFileSync(scopePath, "utf8"));
const validation = JSON.parse(readFileSync(validationPath, "utf8"));
if (
  summary.passed !== true ||
  summary.schema !== 20 ||
  summary.tier !== "deep" ||
  summary.releaseSha !== freeze.qualifiedContractGitSha ||
  validation.passed !== true ||
  validation.schema !== 20 ||
  validation.releaseSha !== freeze.qualifiedContractGitSha ||
  validation.coverage?.linePercent < 90 ||
  validation.coverage?.branchPercent < 80 ||
  scope.releaseSha !== freeze.qualifiedContractGitSha
) {
  throw new Error("Schema-20 qualification evidence is not passing");
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  contractSchema: 20,
  qualifiedContractGitSha: freeze.qualifiedContractGitSha,
  sourceTreeGitObject: freeze.sourceTreeGitObject,
  scriptTreeGitObject: freeze.scriptTreeGitObject,
  foundryConfigGitObject: freeze.foundryConfigGitObject,
  deepSummarySha256: freeze.deepEvidence.summarySha256,
  deepChecksumsSha256: freeze.deepEvidence.checksumsSha256,
  lineCoveragePercent: validation.coverage.linePercent,
  branchCoveragePercent: validation.coverage.branchPercent,
  passed: true,
})}\n`);

#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function hasFlag(name) {
  return args.includes(name);
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function git(repo, commandArgs) {
  return execFileSync("git", ["-C", repo, ...commandArgs], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

function getPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, segment) => current?.[segment], value);
}

function sameValue(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

const repo = path.resolve(requiredOption("--repo"));
const configPath = path.resolve(requiredOption("--config"));
const auditPath = path.resolve(requiredOption("--audit"));
const evidenceDir = path.resolve(requiredOption("--evidence-dir"));
const allowIncomplete = hasFlag("--allow-incomplete");
const config = readJson(configPath);
const blockers = [];
const checks = [];

function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), detail });
  if (!condition) blockers.push(`${name}: ${detail}`);
}

check("config schema", config.schemaVersion === 1, "schemaVersion must equal 1");
check(
  "expected SHA format",
  /^[0-9a-f]{40}$/.test(config.expectedReleaseGitSha),
  "expectedReleaseGitSha must be a full lowercase SHA",
);
check(
  "expected release path",
  config.expectedReleasePath === `/opt/robyn/releases/${config.expectedReleaseGitSha}`,
  "release path must be commit-addressed",
);

const auditText = fs.readFileSync(auditPath, "utf8");
const auditRows = auditText
  .split("\n")
  .filter((line) => line.startsWith("|"))
  .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
  .filter(
    (cells) =>
      cells.length === 3 &&
      cells[0] !== "Requirement" &&
      !/^[-:]+$/.test(cells[0]),
  )
  .map(([requirement, status, evidence]) => ({ requirement, status, evidence }));
const statusCounts = Object.fromEntries(
  [...new Set(auditRows.map((row) => row.status))]
    .sort()
    .map((status) => [status, auditRows.filter((row) => row.status === status).length]),
);
const unknownStatuses = auditRows.filter(
  (row) => !config.allowedFinalAuditStatuses.includes(row.status),
);
check(
  "audit row floor",
  auditRows.length >= config.minimumAuditRows,
  `found ${auditRows.length}, require at least ${config.minimumAuditRows}`,
);
check(
  "audit final statuses",
  unknownStatuses.length === 0,
  unknownStatuses.length
    ? unknownStatuses.map((row) => `${row.requirement}=${row.status}`).join("; ")
    : "all statuses are final",
);
check(
  "audit evidence populated",
  auditRows.every((row) => row.evidence.length >= 12),
  "every row must carry material evidence text",
);
check(
  "audit headline final",
  !/^Status:.*(incomplete|active|pending|post-soak)/im.test(auditText),
  "headline must not describe an incomplete state",
);

const checksumPath = path.join(evidenceDir, "SHA256SUMS");
check("checksum manifest exists", fs.existsSync(checksumPath), checksumPath);
let checksumEntries = [];
if (fs.existsSync(checksumPath)) {
  checksumEntries = fs
    .readFileSync(checksumPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([0-9a-f]{64})\s+(.+)$/);
      if (!match) return { valid: false, line };
      const [, expected, relative] = match;
      const filename = path.resolve(evidenceDir, relative.replace(/^\.\//, ""));
      if (!filename.startsWith(`${evidenceDir}${path.sep}`)) {
        return { valid: false, line, reason: "path escape" };
      }
      if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        return { valid: false, line, reason: "missing file" };
      }
      const actual = crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
      return { valid: actual === expected, line, expected, actual, relative };
    });
  check(
    "evidence checksums",
    checksumEntries.length > 0 && checksumEntries.every((entry) => entry.valid),
    checksumEntries.filter((entry) => !entry.valid).map((entry) => entry.line).join("; ") ||
      `${checksumEntries.length} entries match`,
  );
}

for (const requirement of config.requiredEvidence) {
  const filename = path.join(evidenceDir, requirement.file);
  const exists = fs.existsSync(filename) && fs.statSync(filename).isFile();
  check(`evidence file ${requirement.file}`, exists, exists ? "present" : "missing");
  if (!exists || requirement.kind === "text") continue;
  let payload;
  try {
    payload = readJson(filename);
  } catch (error) {
    check(
      `evidence JSON ${requirement.file}`,
      false,
      error instanceof Error ? error.message : String(error),
    );
    continue;
  }
  for (const assertion of requirement.assertions ?? []) {
    const actual = getPath(payload, assertion.path);
    const expected = assertion.expectedSha
      ? config.expectedReleaseGitSha
      : assertion.equals;
    check(
      `${requirement.file}:${assertion.path}`,
      sameValue(actual, expected),
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
  if (requirement.emptyArray === true) {
    check(
      `${requirement.file}:empty array`,
      Array.isArray(payload) && payload.length === 0,
      "browser diagnostic log must be an empty array",
    );
  }
  if (requirement.allReceiptStatuses === "0x1") {
    check(
      `${requirement.file}:receipt statuses`,
      Array.isArray(payload) &&
        payload.length > 0 &&
        payload.every((receipt) =>
          String(receipt.status ?? receipt.receipt?.status).toLowerCase() === "0x1"),
      "all final browser receipts must succeed",
    );
  }
}

const manifestPath = path.join(evidenceDir, "manifest.json");
if (fs.existsSync(manifestPath)) {
  const manifest = readJson(manifestPath);
  check(
    "manifest release SHA",
    manifest.releaseGitSha === config.expectedReleaseGitSha,
    `manifest=${manifest.releaseGitSha}`,
  );
  check("manifest passed", manifest.passed === true, "manifest passed must be true");
  check(
    "manifest soak passed",
    manifest.soak?.status === "passed" && manifest.soak?.completionPending === false,
    `soak status=${manifest.soak?.status ?? "missing"}`,
  );
}

let localHead;
let remoteEvidenceHead;
let remoteMainHead;
let localTagType;
let localTagTarget;
let remoteTagTarget;
try {
  localHead = git(repo, ["rev-parse", "HEAD"]);
  check(
    "evidence branch name",
    git(repo, ["branch", "--show-current"]) === config.evidenceBranch,
    `expected ${config.evidenceBranch}`,
  );
  check("evidence worktree clean", git(repo, ["status", "--porcelain"]) === "", "uncommitted files");
  remoteEvidenceHead = git(repo, ["ls-remote", "origin", `refs/heads/${config.evidenceBranch}`])
    .split(/\s+/)[0];
  check(
    "evidence branch pushed",
    remoteEvidenceHead === localHead,
    `local=${localHead}, remote=${remoteEvidenceHead || "missing"}`,
  );
  remoteMainHead = git(repo, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0];
  check(
    "remote main exact release",
    remoteMainHead === config.expectedReleaseGitSha,
    `remote main=${remoteMainHead}`,
  );
  localTagType = git(repo, ["cat-file", "-t", `refs/tags/${config.releaseTag}`]);
  check("release tag annotated", localTagType === "tag", `tag type=${localTagType}`);
  localTagTarget = git(repo, ["rev-parse", `${config.releaseTag}^{}`]);
  check(
    "local tag target",
    localTagTarget === config.expectedReleaseGitSha,
    `tag target=${localTagTarget}`,
  );
  remoteTagTarget = git(repo, ["ls-remote", "origin", `refs/tags/${config.releaseTag}^{}`])
    .split(/\s+/)[0];
  check(
    "remote tag target",
    remoteTagTarget === config.expectedReleaseGitSha,
    `remote tag=${remoteTagTarget || "missing"}`,
  );
} catch (error) {
  check("Git publication state", false, error instanceof Error ? error.message : String(error));
}

const result = {
  schemaVersion: 1,
  verifiedAt: new Date().toISOString(),
  passed: blockers.length === 0,
  completionPending: blockers.length !== 0,
  expectedReleaseGitSha: config.expectedReleaseGitSha,
  expectedReleasePath: config.expectedReleasePath,
  evidenceBranch: config.evidenceBranch,
  releaseTag: config.releaseTag,
  auditRowCount: auditRows.length,
  auditStatusCounts: statusCounts,
  checksumEntryCount: checksumEntries.length,
  checks,
  blockers,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (blockers.length > 0 && !allowIncomplete) process.exitCode = 1;

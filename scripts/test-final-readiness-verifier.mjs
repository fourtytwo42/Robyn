#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function run(command, commandArgs, settings = {}) {
  return execFileSync(command, commandArgs, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...settings,
  }).trim();
}

function writeJson(filename, value) {
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function setPath(target, dottedPath, value) {
  const segments = dottedPath.split(".");
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    current[segment] ??= {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

function assertionValue(assertion, expectedSha) {
  if (assertion.expectedSha) return expectedSha;
  if (Object.hasOwn(assertion, "equals")) return assertion.equals;
  if (Object.hasOwn(assertion, "minimum")) return assertion.minimum;
  if (Object.hasOwn(assertion, "minimumLength")) {
    return Array.from({ length: assertion.minimumLength }, (_, index) => `fixture-${index + 1}`);
  }
  if (assertion.nonEmpty) return "fixture-value";
  throw new Error(`Unsupported fixture assertion: ${JSON.stringify(assertion)}`);
}

function sha256(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

const sourceRepo = path.resolve(option("--source-repo", process.cwd()));
const releasePath = path.resolve(
  option(
    "--release-path",
    "/opt/robyn/releases/8def270b1856c2bcfcd69d429a8d88def4ab15a8",
  ),
);
const configTemplatePath = path.resolve(
  option(
    "--config-template",
    path.join(
      sourceRepo,
      "artifacts/browser-uat/2026-07-21-8def270/closure-requirements.json",
    ),
  ),
);
const verifierPath = path.join(sourceRepo, "scripts/verify-final-readiness.mjs");
const template = JSON.parse(fs.readFileSync(configTemplatePath, "utf8"));
const expectedSha = template.expectedReleaseGitSha;
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robyn-final-verifier-test-"));

try {
  const remote = path.join(temporaryRoot, "remote.git");
  const repo = path.join(temporaryRoot, "repo");
  run("git", ["clone", "--bare", "/home/hendo420/Robyn", remote]);
  run("git", ["clone", remote, repo]);
  run("git", ["-C", repo, "config", "user.name", "Robyn verifier fixture"]);
  run("git", ["-C", repo, "config", "user.email", "fixture@robyn.invalid"]);
  run("git", ["-C", repo, "switch", "-c", "fixture"]);

  const evidenceDir = path.join(repo, "fixture-evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const config = {
    ...template,
    expectedReleasePath: releasePath,
    evidenceBranch: "fixture",
    releaseTag: "vtest",
  };
  const configPath = path.join(repo, "fixture-config.json");
  writeJson(configPath, config);

  const auditPath = path.join(repo, "fixture-audit.md");
  const rows = Array.from(
    { length: Math.max(config.minimumAuditRows, 37) },
    (_, index) => `| Fixture requirement ${index + 1} | PROVEN | authoritative synthetic fixture evidence ${index + 1} |`,
  );
  fs.writeFileSync(
    auditPath,
    [
      "# Final readiness fixture",
      "",
      "Status: Proven final fixture",
      "",
      "| Requirement | Status | Evidence |",
      "| --- | --- | --- |",
      ...rows,
      "",
    ].join("\n"),
  );

  for (const requirement of config.requiredEvidence) {
    const filename = path.join(evidenceDir, requirement.file);
    if (requirement.kind === "text") {
      fs.writeFileSync(filename, "authoritative fixture evidence\n");
      continue;
    }
    if (requirement.emptyArray) {
      writeJson(filename, []);
      continue;
    }
    if (requirement.allReceiptStatuses) {
      writeJson(
        filename,
        Array.from({ length: requirement.minimumReceiptCount ?? 1 }, (_, index) => ({
          transactionHash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
          status: requirement.allReceiptStatuses,
        })),
      );
      continue;
    }
    const payload = {};
    for (const assertion of requirement.assertions ?? []) {
      setPath(payload, assertion.path, assertionValue(assertion, expectedSha));
    }
    writeJson(filename, payload);
  }

  const checksumEntries = fs
    .readdirSync(evidenceDir)
    .filter((name) => name !== "SHA256SUMS")
    .sort()
    .map((name) => `${sha256(path.join(evidenceDir, name))}  ${name}`);
  fs.writeFileSync(path.join(evidenceDir, "SHA256SUMS"), `${checksumEntries.join("\n")}\n`);

  run("git", ["-C", repo, "add", "fixture-audit.md", "fixture-config.json", "fixture-evidence"]);
  run("git", ["-C", repo, "commit", "-m", "test: complete readiness fixture"]);
  run("git", ["-C", repo, "push", "-u", "origin", "fixture"]);
  run("git", ["-C", repo, "tag", "-a", "vtest", expectedSha, "-m", "Verifier fixture tag"]);
  run("git", ["-C", repo, "push", "origin", "vtest"]);

  const verifierArgs = [
    verifierPath,
    "--repo",
    repo,
    "--config",
    configPath,
    "--audit",
    auditPath,
    "--evidence-dir",
    evidenceDir,
    "--synthetic-fixture",
  ];
  const success = JSON.parse(run("node", verifierArgs));
  if (!success.passed || success.completionPending || success.blockers.length !== 0) {
    throw new Error(`Complete fixture did not pass: ${JSON.stringify(success.blockers)}`);
  }
  if (success.checks.length !== 130 || !success.checks.every((check) => check.passed)) {
    throw new Error(`Expected 130 passing checks, got ${success.checks.length}`);
  }

  const browserAuditPath = path.join(evidenceDir, "post-reboot-browser-independent-audit.json");
  const browserAudit = JSON.parse(fs.readFileSync(browserAuditPath, "utf8"));
  browserAudit.liveReceiptsMatched = 7;
  writeJson(browserAuditPath, browserAudit);
  const updatedEntries = fs
    .readdirSync(evidenceDir)
    .filter((name) => name !== "SHA256SUMS")
    .sort()
    .map((name) => `${sha256(path.join(evidenceDir, name))}  ${name}`);
  fs.writeFileSync(path.join(evidenceDir, "SHA256SUMS"), `${updatedEntries.join("\n")}\n`);
  const rejected = JSON.parse(run("node", [...verifierArgs, "--allow-incomplete"]));
  const liveReceiptCheck = rejected.checks.find(
    (check) => check.name === "post-reboot-browser-independent-audit.json:liveReceiptsMatched",
  );
  if (rejected.passed || liveReceiptCheck?.passed !== false) {
    throw new Error("Tampered live-receipt count was not rejected");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        passed: true,
        expectedSha,
        successCheckCount: success.checks.length,
        successBlockerCount: success.blockers.length,
        tamperedLiveReceiptCountRejected: true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  if (!resolvedTemporaryRoot.startsWith(`${path.resolve(os.tmpdir())}${path.sep}robyn-final-verifier-test-`)) {
    throw new Error(`Refusing to remove unexpected fixture path: ${resolvedTemporaryRoot}`);
  }
  fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
}

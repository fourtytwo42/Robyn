#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function fail(message) {
  throw new Error(message);
}

function sha256(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

const samplesPath = path.resolve(requiredOption("--samples"));
const summaryPath = path.resolve(requiredOption("--summary"));
const expectedSha = requiredOption("--expected-sha");
const expectedRelease = path.resolve(requiredOption("--expected-release"));
const evidenceDir = path.resolve(requiredOption("--evidence-dir"));
const auditorPath = path.resolve(
  option("--auditor", path.join(path.dirname(new URL(import.meta.url).pathname), "audit-soak-evidence.mjs")),
);

if (!/^[0-9a-f]{40}$/.test(expectedSha)) fail("--expected-sha must be a full lowercase Git SHA");
for (const filename of [samplesPath, summaryPath, auditorPath]) {
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    fail(`Required regular file is missing: ${filename}`);
  }
}
if (!fs.existsSync(evidenceDir) || !fs.statSync(evidenceDir).isDirectory()) {
  fail(`Evidence directory is missing: ${evidenceDir}`);
}

const soakState = spawnSync("systemctl", ["is-active", "robyn-soak.service"], {
  encoding: "utf8",
}).stdout.trim();
if (soakState !== "inactive") {
  fail(`Soak service must be inactive before final evidence is preserved; state=${soakState || "unknown"}`);
}

const audit = JSON.parse(
  execFileSync(
    "node",
    [
      auditorPath,
      "--samples",
      samplesPath,
      "--summary",
      summaryPath,
      "--expected-sha",
      expectedSha,
      "--expected-release",
      expectedRelease,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  ),
);
if (audit.passed !== true || audit.completionPending !== false || audit.mode !== "final") {
  fail("Independent final soak audit did not pass");
}

const targets = {
  samples: path.join(evidenceDir, "soak-final-samples.jsonl"),
  summary: path.join(evidenceDir, "soak-final-summary.json"),
  audit: path.join(evidenceDir, "soak-final-independent-audit.json"),
};
for (const filename of Object.values(targets)) {
  if (fs.existsSync(filename)) fail(`Refusing to overwrite final evidence: ${filename}`);
}

fs.copyFileSync(samplesPath, targets.samples, fs.constants.COPYFILE_EXCL);
fs.copyFileSync(summaryPath, targets.summary, fs.constants.COPYFILE_EXCL);
fs.writeFileSync(targets.audit, `${JSON.stringify(audit, null, 2)}\n`, { flag: "wx" });

if (sha256(samplesPath) !== sha256(targets.samples)) fail("Preserved sample stream digest mismatch");
if (sha256(summaryPath) !== sha256(targets.summary)) fail("Preserved producer summary digest mismatch");

const result = {
  schemaVersion: 1,
  preservedAt: new Date().toISOString(),
  expectedSha,
  expectedRelease,
  soakState,
  sampleCount: audit.sampleCount,
  observedSeconds: audit.observedSeconds,
  targets,
  digests: {
    samples: sha256(targets.samples),
    summary: sha256(targets.summary),
    audit: sha256(targets.audit),
  },
  passed: true,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

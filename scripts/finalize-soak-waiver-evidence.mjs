#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function sha256(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

const samplesPath = path.resolve(requiredOption("--samples"));
const summaryPath = path.resolve(requiredOption("--summary"));
const expectedSha = requiredOption("--expected-sha");
const expectedRelease = path.resolve(requiredOption("--expected-release"));
const evidenceDir = path.resolve(requiredOption("--evidence-dir"));
const approvedAt = requiredOption("--approved-at");
const approvalNote = requiredOption("--approval-note");

if (!/^[0-9a-f]{40}$/.test(expectedSha)) {
  throw new Error("--expected-sha must be a full lowercase Git SHA");
}
if (Number.isNaN(Date.parse(approvedAt))) throw new Error("--approved-at must be an ISO timestamp");
if (approvalNote.trim().length < 12) throw new Error("--approval-note must be explicit");
for (const filename of [samplesPath, summaryPath]) {
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    throw new Error(`Required regular file is missing: ${filename}`);
  }
}
if (!fs.existsSync(evidenceDir) || !fs.statSync(evidenceDir).isDirectory()) {
  throw new Error(`Evidence directory is missing: ${evidenceDir}`);
}

const soakState = spawnSync("systemctl", ["is-active", "robyn-soak.service"], {
  encoding: "utf8",
}).stdout.trim();
if (soakState !== "inactive") {
  throw new Error(`Soak service must be inactive; state=${soakState || "unknown"}`);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const samples = fs
  .readFileSync(samplesPath, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON at sample line ${index + 1}`);
    }
  });

const requiredProcesses = [
  "robyn-api",
  "robyn-artifacts",
  "robyn-indexer",
  "robyn-keeper",
  "robyn-rpc-gateway",
  "robyn-web",
];
const checks = [];
const blockers = [];
function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), detail });
  if (!condition) blockers.push(`${name}: ${detail}`);
}

check("sample stream nonempty", samples.length > 0, `sampleCount=${samples.length}`);
check(
  "producer sample count",
  summary.sampleCount === samples.length,
  `summary=${summary.sampleCount}, observed=${samples.length}`,
);
check("producer recorded abort", summary.aborted === true, `aborted=${summary.aborted}`);
check(
  "producer did not claim duration",
  summary.completedDuration === false && summary.passed === false,
  `completedDuration=${summary.completedDuration}, passed=${summary.passed}`,
);
check(
  "producer error-free before waiver",
  summary.errorCount === 0 && Array.isArray(summary.errors) && summary.errors.length === 0,
  `errorCount=${summary.errorCount}`,
);
check(
  "producer exact release",
  summary.gitSha === expectedSha && path.resolve(summary.releasePath) === expectedRelease,
  `gitSha=${summary.gitSha}, releasePath=${summary.releasePath}`,
);
check(
  "producer restarts zero",
  summary.baselineRestarts === 0 && summary.finalRestarts === 0,
  `baseline=${summary.baselineRestarts}, final=${summary.finalRestarts}`,
);
check("producer latency threshold", summary.p95WithinThreshold === true, "p95WithinThreshold must be true");
check(
  "all samples exact release",
  samples.every(
    (sample) =>
      sample.gitSha === expectedSha && path.resolve(sample.releasePath) === expectedRelease,
  ),
  "every sample must bind to the exact immutable release",
);
check(
  "all process sets complete",
  samples.every(
    (sample) =>
      Array.isArray(sample.processes) &&
      sample.processes.map((process) => process.name).sort().join(",") ===
        requiredProcesses.join(","),
  ),
  "every sample must contain the exact six-process set",
);
check(
  "all restart counts zero",
  samples.every((sample) => sample.processes.every((process) => process.restartCount === 0)),
  "every sampled PM2 restart count must be zero",
);
check(
  "all firing alerts zero",
  samples.every((sample) => sample.firingAlerts === 0),
  "every sample must report zero firing alerts",
);
check(
  "indexed state monotonic",
  samples.every(
    (sample, index) =>
      index === 0 ||
      (Number(sample.chainBlock) >= Number(samples[index - 1].chainBlock) &&
        Number(sample.status?.asOfBlock) >= Number(samples[index - 1].status?.asOfBlock)),
  ),
  "chain and indexed block heights must not regress",
);

if (blockers.length > 0) {
  throw new Error(`Partial soak evidence is inconsistent: ${blockers.join("; ")}`);
}

const firstSampledAt = samples[0].sampledAt;
const lastSampledAt = samples.at(-1).sampledAt;
const observedSeconds = (Date.parse(lastSampledAt) - Date.parse(firstSampledAt)) / 1000;
const targets = {
  samples: path.join(evidenceDir, "soak-waived-samples.jsonl"),
  summary: path.join(evidenceDir, "soak-waived-summary.json"),
  audit: path.join(evidenceDir, "soak-waived-independent-audit.json"),
};
for (const filename of Object.values(targets)) {
  if (fs.existsSync(filename)) throw new Error(`Refusing to overwrite evidence: ${filename}`);
}

fs.copyFileSync(samplesPath, targets.samples, fs.constants.COPYFILE_EXCL);
fs.copyFileSync(summaryPath, targets.summary, fs.constants.COPYFILE_EXCL);

const audit = {
  schemaVersion: 1,
  auditedAt: new Date().toISOString(),
  mode: "waived",
  passed: true,
  completionPending: false,
  soakPassed: false,
  waiver: {
    approved: true,
    authority: "user",
    approvedAt,
    approvalNote,
  },
  expectedSha,
  expectedRelease,
  soakState,
  sampleCount: samples.length,
  observedSeconds,
  firstSampledAt,
  lastSampledAt,
  requestedDurationSeconds: summary.requestedDurationSeconds,
  producerElapsedSeconds: summary.elapsedSeconds,
  allSamplesExactRelease: true,
  allProcessSetsComplete: true,
  allRestartCountsZero: true,
  allFiringAlertsZero: true,
  allIndexedStateMonotonic: true,
  checks,
  digests: {
    samples: sha256(targets.samples),
    summary: sha256(targets.summary),
  },
};
fs.writeFileSync(targets.audit, `${JSON.stringify(audit, null, 2)}\n`, { flag: "wx" });

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      preservedAt: new Date().toISOString(),
      passed: true,
      soakPassed: false,
      releaseAcceptedByWaiver: true,
      expectedSha,
      sampleCount: samples.length,
      observedSeconds,
      targets,
      digests: { ...audit.digests, audit: sha256(targets.audit) },
    },
    null,
    2,
  )}\n`,
);

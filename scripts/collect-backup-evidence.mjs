#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
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

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function fail(message) {
  throw new Error(message);
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function parseKeyValues(filename) {
  const values = {};
  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    if (line.endsWith(": OK")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) fail(`Malformed restore-output line: ${line}`);
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function ghApi(repository, endpoint, binary = false) {
  return execFileSync(
    "gh",
    [
      "api",
      ...(binary ? ["-H", "Accept: application/octet-stream"] : []),
      `repos/${repository}/${endpoint}`,
    ],
    { encoding: binary ? null : "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
}

const releaseSha = requiredOption("--release-sha");
const backupPath = path.resolve(requiredOption("--backup"));
const checksumPath = path.resolve(requiredOption("--checksum"));
const restoreOutputPath = path.resolve(requiredOption("--restore-output"));
const outputPath = path.resolve(requiredOption("--output"));
const repository = option("--repository", "fourtytwo42/Robyn");
const releaseTag = option("--release-tag", "robyn-state-backups");

if (!/^[0-9a-f]{40}$/.test(releaseSha)) fail("--release-sha must be a full lowercase Git SHA");
for (const filename of [backupPath, checksumPath, restoreOutputPath]) {
  if (!fs.statSync(filename).isFile()) fail(`Required file is not regular: ${filename}`);
}

const backupName = path.basename(backupPath);
const checksumName = path.basename(checksumPath);
if (checksumName !== `${backupName}.sha256`) fail("Checksum filename must equal backup filename plus .sha256");
const checksumMatch = fs
  .readFileSync(checksumPath, "utf8")
  .trim()
  .match(/^([0-9a-f]{64})\s+(.+)$/);
if (!checksumMatch || checksumMatch[2] !== backupName) fail("Checksum file does not name the selected backup");

const backupBytes = fs.readFileSync(backupPath);
const backupDigest = sha256(backupBytes);
if (backupDigest !== checksumMatch[1]) fail("Local encrypted backup checksum mismatch");
if (!backupName.endsWith(".tar.zst.age")) fail("Backup is not an age-encrypted tar.zst artifact");

const release = JSON.parse(ghApi(repository, `releases/tags/${releaseTag}`));
const exactAssets = (name) => release.assets.filter((asset) => asset.name === name);
const backupAssets = exactAssets(backupName);
const checksumAssets = exactAssets(checksumName);
if (backupAssets.length !== 1 || checksumAssets.length !== 1) {
  fail("Off-VM release must contain exactly one matching backup and checksum asset");
}

const remoteBackupBytes = ghApi(repository, `releases/assets/${backupAssets[0].id}`, true);
const remoteChecksumBytes = ghApi(repository, `releases/assets/${checksumAssets[0].id}`, true);
if (remoteBackupBytes.length !== backupBytes.length) fail("Off-VM backup size mismatch");
if (sha256(remoteBackupBytes) !== backupDigest) fail("Off-VM backup digest mismatch");
const remoteChecksumMatch = remoteChecksumBytes
  .toString("utf8")
  .trim()
  .match(/^([0-9a-f]{64})\s+(.+)$/);
if (!remoteChecksumMatch || remoteChecksumMatch[1] !== backupDigest || remoteChecksumMatch[2] !== backupName) {
  fail("Off-VM checksum asset does not authenticate the selected backup");
}

const restore = parseKeyValues(restoreOutputPath);
if (restore.restore !== "passed") fail("Restore rehearsal did not pass");
if (restore.gitSha !== releaseSha) fail("Restored Git SHA does not match the exact release");
if (restore.liveStateTouched !== "false") fail("Restore rehearsal touched live state");
if (Number(restore.databaseTables) < 9) fail("Restore rehearsal recovered fewer than nine tables");
if (Number(restore.artifacts) < 1) fail("Restore rehearsal recovered no artifacts");
if (Number(restore.chainId) !== 31337) fail("Restore rehearsal chain ID is not 31337");

const timestampMatch = backupName.match(/^robyn-state-(\d{8}T\d{6}Z)\.tar\.zst\.age$/);
const createdAt = timestampMatch
  ? timestampMatch[1].replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")
  : new Date().toISOString();

const evidence = {
  schemaVersion: 1,
  createdAt,
  releaseGitSha: releaseSha,
  backup: {
    name: backupName,
    sizeBytes: backupBytes.length,
    sha256: backupDigest,
    encrypted: true,
    offVmRelease: releaseTag,
    offVmAssetCount: backupAssets.length,
    offVmChecksumAssetCount: checksumAssets.length,
    offVmSizeMatched: true,
    offVmDigestMatched: true,
  },
  restoreRehearsal: {
    passed: true,
    databaseTables: Number(restore.databaseTables),
    artifacts: Number(restore.artifacts),
    chainId: Number(restore.chainId),
    factory: restore.factory,
    gitSha: restore.gitSha,
    liveStateTouched: false,
  },
  passed: true,
};

fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify(evidence)}\n`);

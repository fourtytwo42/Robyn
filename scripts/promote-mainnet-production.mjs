#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  classifyProductionChanges,
  validateProductionAcceptance,
} from "./lib/production-release.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const shaIndex = args.indexOf("--sha");
if (shaIndex < 0 || !args[shaIndex + 1]) {
  throw new Error("usage: pnpm release:promote:mainnet --sha <qualified-sha>");
}
const sha = execFileSync("git", ["rev-parse", args[shaIndex + 1]], { cwd: repo, encoding: "utf8" }).trim();
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
if (sha !== head) throw new Error("qualified SHA must be the checked-out HEAD");
if (execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).trim()) {
  throw new Error("worktree must be clean");
}
execFileSync("git", ["fetch", "origin", "main", "--tags"], { cwd: repo, stdio: "inherit" });
try {
  execFileSync("git", ["merge-base", "--is-ancestor", sha, "origin/main"], { cwd: repo });
} catch {
  throw new Error("qualified SHA must be reachable from protected origin/main");
}

const stateFile = "/var/lib/robyn-release/last-production-release.json";
let previous = null;
try { previous = JSON.parse(readFileSync(stateFile, "utf8")); } catch {}
const base = previous?.sourceSha || `${sha}^`;
const changed = execFileSync("git", ["diff", "--name-only", `${base}..${sha}`], {
  cwd: repo, encoding: "utf8",
}).trim().split("\n").filter(Boolean);
const scope = classifyProductionChanges(changed);
const policy = JSON.parse(
  readFileSync(path.join(repo, "config/production-mainnet.json"), "utf8"),
);
const acceptanceRoot = path.join("/var/lib/robyn-release/acceptance", sha);
for (const environment of ["devnet", "testnet", "mainnet-staging"]) {
  const evidence = JSON.parse(
    execFileSync(
      "sudo",
      [
        "-u",
        "robyn-release",
        "cat",
        path.join(acceptanceRoot, environment + ".json"),
      ],
      { encoding: "utf8" },
    ),
  );
  validateProductionAcceptance(evidence, {
    environment,
    sourceSha: sha,
    changeScope: scope,
    contractClosureHash: policy.contractClosureHash,
  });
}
const gate = {
  ui: ["pnpm", ["test:ui-scope"]],
  data: ["pnpm", ["test:production-release"]],
  infrastructure: ["pnpm", ["test:production-release"]],
  mixed: ["pnpm", ["test"]],
  contracts: ["pnpm", ["test"]],
}[scope];
execFileSync(gate[0], gate[1], { cwd: repo, stdio: "inherit" });
execFileSync("pnpm", ["test:production-release"], { cwd: repo, stdio: "inherit" });

const tag = `mainnet-prod-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${sha.slice(0, 7)}`;
const buildRoot = path.join("/var/lib/robyn-release/builds", sha);
const outputRoot = path.join("/var/lib/robyn-release/out", tag);
execFileSync("sudo", ["rm", "-rf", buildRoot, outputRoot], { stdio: "inherit" });
execFileSync("sudo", ["install", "-d", "-o", "robyn-release", "-g", "robyn-release", buildRoot, outputRoot], { stdio: "inherit" });
const bundleDirectory = mkdtempSync(
  path.join(tmpdir(), "robyn-release-bundle-"),
);
const bundle = path.join(bundleDirectory, "source.bundle");
try {
  chmodSync(bundleDirectory, 0o755);
  execFileSync("git", ["bundle", "create", bundle, "HEAD"], {
    cwd: repo,
    stdio: "inherit",
  });
  execFileSync("git", ["bundle", "verify", bundle], {
    cwd: repo,
    stdio: "inherit",
  });
  chmodSync(bundle, 0o444);
  execFileSync("sudo", ["-u", "robyn-release", "git", "clone", "--no-checkout", bundle, buildRoot], { stdio: "inherit" });
} finally {
  rmSync(bundleDirectory, { force: true, recursive: true });
}
execFileSync("sudo", ["-u", "robyn-release", "git", "-C", buildRoot, "checkout", "--detach", sha], { stdio: "inherit" });
execFileSync("sudo", [
  "-u", "robyn-release", "env",
  `ROBYN_REQUIRED_PREVIOUS_RELEASE=${previous?.sourceSha || ""}`,
  "ROBYN_RELEASE_MANIFEST_INPUT=/var/lib/robyn-release/inputs/4663-mainnet.json",
  "bash", path.join(buildRoot, "scripts/build-mainnet-production-runtime.sh"),
  buildRoot, outputRoot, scope, acceptanceRoot,
], { stdio: "inherit" });

const signingKey = "/home/hendo420/.config/robyn/release-signing/id_ed25519";
execFileSync("ssh-keygen", ["-Y", "sign", "-f", signingKey, "-n", "file", path.join(outputRoot, "production-release.json")], { stdio: "inherit" });
execFileSync("git", [
  "-c", "gpg.format=ssh", "-c", `user.signingkey=${signingKey}`,
  "tag", "-s", "-m", `Sherwood Forest production release ${sha}`, tag, sha,
], { cwd: repo, stdio: "inherit" });
execFileSync("git", ["push", "origin", tag], { cwd: repo, stdio: "inherit" });
execFileSync("gh", [
  "release", "create", tag,
  path.join(outputRoot, "production-release.json"),
  path.join(outputRoot, "production-release.json.sig"),
  path.join(outputRoot, "runtime.tar.zst"),
  path.join(outputRoot, "runtime.tar.zst.sha256"),
  "--verify-tag", "--title", tag,
  "--notes", `Signed production release for ${sha}; scope=${scope}`,
], { cwd: repo, stdio: "inherit" });
process.stdout.write(`${JSON.stringify({ tag, sha, scope, outputRoot }, null, 2)}\n`);

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assertAdditiveMigrations,
  assertReleaseTreeIntegrity,
  assertSecretFreeTree,
  hashMigrationSet,
  sha256File,
  validateProductionRelease,
} from "./lib/production-release.mjs";

const [manifestArg, rootArg, currentRelease = ""] = process.argv.slice(2);
if (!manifestArg || !rootArg) {
  throw new Error("usage: validate-production-release.mjs <production-release.json> <release-root> [current-release]");
}
const root = path.resolve(rootArg);
const manifest = JSON.parse(readFileSync(path.resolve(manifestArg), "utf8"));
const policy = JSON.parse(readFileSync(path.resolve(root, "config/production-mainnet.json"), "utf8"));
validateProductionRelease(manifest, policy, { currentRelease: currentRelease || undefined });
assertSecretFreeTree(root);
assertReleaseTreeIntegrity(root, manifest);
assertAdditiveMigrations(path.join(root, "packages/db/migrations"));
if (hashMigrationSet(path.join(root, "packages/db/migrations")) !== manifest.migrationSetHash) {
  throw new Error("Migration set hash mismatch");
}
if (sha256File(path.join(root, "infrastructure/pm2/ecosystem.mainnet.production.cjs")) !== manifest.processTopologyHash) {
  throw new Error("Process topology hash mismatch");
}
process.stdout.write(`${JSON.stringify({ passed: true, sourceSha: manifest.sourceSha, scope: manifest.changeScope })}\n`);

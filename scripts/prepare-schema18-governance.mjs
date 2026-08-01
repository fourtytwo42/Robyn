#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSchema18GovernanceManifest } from "./lib/schema18-governance.mjs";

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error("usage: prepare-schema18-governance.mjs <protected-input.json> <output.json>");
}
const inputPath = path.resolve(inputArgument);
const outputPath = path.resolve(outputArgument);
if (inputPath === outputPath) throw new Error("input and output paths must differ");
const inputRaw = await readFile(inputPath, "utf8");
for (const forbidden of ["privateKey", "mnemonic", "password", "seedPhrase", "apiKey"]) {
  if (inputRaw.toLowerCase().includes(forbidden.toLowerCase())) {
    throw new Error(`protected governance input contains forbidden field ${forbidden}`);
  }
}
const manifest = buildSchema18GovernanceManifest(JSON.parse(inputRaw));
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(outputPath, serialized, { mode: 0o600, flag: "wx" });
process.stdout.write(
  `${JSON.stringify({
    output: outputPath,
    sha256: createHash("sha256").update(serialized).digest("hex"),
    planHashes: manifest.governance.bootstrapPlanHashes,
    mainnetTransactionsAuthorized: false,
  })}\n`,
);

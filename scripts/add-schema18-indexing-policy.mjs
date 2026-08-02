#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSchema18IndexingPolicy } from "./lib/schema18-indexing-policy.mjs";

const [inputArg, outputArg = inputArg] = process.argv.slice(2);
if (!inputArg) {
  throw new Error(
    "usage: add-schema18-indexing-policy.mjs <input-manifest.json> [output-manifest.json]",
  );
}
const inputPath = path.resolve(inputArg);
const outputPath = path.resolve(outputArg);
const manifest = JSON.parse(await readFile(inputPath, "utf8"));
const result = {
  ...manifest,
  indexingPolicy: buildSchema18IndexingPolicy(manifest),
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (inputPath === outputPath) {
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporary, serialized, { flag: "wx", mode: 0o600 });
  await rename(temporary, outputPath);
} else {
  await writeFile(outputPath, serialized, { flag: "wx", mode: 0o600 });
}
process.stdout.write(
  `${JSON.stringify({
    output: outputPath,
    policyHash: result.indexingPolicy.policyHash,
    manifestSha256: createHash("sha256").update(serialized).digest("hex"),
  })}\n`,
);

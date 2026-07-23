#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [sourceRoot, secretPath] = process.argv.slice(2);
if (!sourceRoot || !secretPath) {
  console.error("usage: prepare-next-build-inputs.mjs <source-root> <secret-json>");
  process.exit(2);
}

const secrets = JSON.parse(await readFile(secretPath, "utf8"));
if (
  typeof secrets.serverActionsEncryptionKey !== "string" ||
  Buffer.from(secrets.serverActionsEncryptionKey, "base64").length !== 32 ||
  !/^[a-f0-9]{32}$/.test(secrets.previewModeId) ||
  !/^[a-f0-9]{64}$/.test(secrets.previewModeSigningKey) ||
  !/^[a-f0-9]{64}$/.test(secrets.previewModeEncryptionKey)
) {
  throw new Error("invalid Next build secret configuration");
}

const cacheDirectory = join(sourceRoot, "apps/web/.next/cache");
await mkdir(cacheDirectory, { recursive: true });
await writeFile(
  join(cacheDirectory, ".previewinfo"),
  `${JSON.stringify({
    previewModeId: secrets.previewModeId,
    previewModeSigningKey: secrets.previewModeSigningKey,
    previewModeEncryptionKey: secrets.previewModeEncryptionKey,
    expireAt: 4_102_444_800_000,
  })}\n`,
  { mode: 0o600 },
);

process.stdout.write(secrets.serverActionsEncryptionKey);

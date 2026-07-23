#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";

const outputPath =
  process.argv[2] ?? "/home/hendo420/.config/robyn/next-build-secrets.json";

const validate = (value) => {
  if (
    typeof value?.serverActionsEncryptionKey !== "string" ||
    Buffer.from(value.serverActionsEncryptionKey, "base64").length !== 32 ||
    !/^[a-f0-9]{32}$/.test(value.previewModeId) ||
    !/^[a-f0-9]{64}$/.test(value.previewModeSigningKey) ||
    !/^[a-f0-9]{64}$/.test(value.previewModeEncryptionKey)
  ) {
    throw new Error("invalid Next build secret configuration");
  }
};

try {
  const existing = JSON.parse(await readFile(outputPath, "utf8"));
  validate(existing);
  await chmod(outputPath, 0o600);
  console.log(`next_build_secrets=existing path=${outputPath}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  const generated = {
    schemaVersion: 1,
    serverActionsEncryptionKey: randomBytes(32).toString("base64"),
    previewModeId: randomBytes(16).toString("hex"),
    previewModeSigningKey: randomBytes(32).toString("hex"),
    previewModeEncryptionKey: randomBytes(32).toString("hex"),
  };
  validate(generated);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  const handle = await open(outputPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(generated)}\n`, { mode: 0o600 });
  } finally {
    await handle.close();
  }
  console.log(`next_build_secrets=created path=${outputPath}`);
}

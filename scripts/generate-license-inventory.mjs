import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [, , sourceRoot, outputPath] = process.argv;
if (!sourceRoot || !outputPath) {
  throw new Error(
    "Usage: node scripts/generate-license-inventory.mjs <source-root> <output>",
  );
}

const virtualStore = resolve(sourceRoot, "node_modules/.pnpm");
const records = new Map();

async function recordPackage(directory) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  } catch {
    return;
  }
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string")
    return;
  const license =
    typeof manifest.license === "string"
      ? manifest.license
      : typeof manifest.license?.type === "string"
        ? manifest.license.type
        : "Unknown";
  records.set(`${manifest.name}\u0000${manifest.version}`, {
    name: manifest.name,
    version: manifest.version,
    license,
  });
}

for (const virtualEntry of await readdir(virtualStore, {
  withFileTypes: true,
})) {
  if (!virtualEntry.isDirectory()) continue;
  const modules = resolve(virtualStore, virtualEntry.name, "node_modules");
  let packages;
  try {
    packages = await readdir(modules, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const packageEntry of packages) {
    if (!packageEntry.isDirectory() && !packageEntry.isSymbolicLink()) continue;
    if (packageEntry.name.startsWith("@")) {
      const scope = resolve(modules, packageEntry.name);
      for (const scopedEntry of await readdir(scope, { withFileTypes: true })) {
        if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink())
          await recordPackage(resolve(scope, scopedEntry.name));
      }
    } else {
      await recordPackage(resolve(modules, packageEntry.name));
    }
  }
}

const inventory = [...records.values()].sort(
  (left, right) =>
    left.name.localeCompare(right.name) ||
    left.version.localeCompare(right.version) ||
    left.license.localeCompare(right.license),
);
await writeFile(outputPath, `${JSON.stringify(inventory)}\n`);

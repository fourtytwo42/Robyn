#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const allowPending = process.argv.includes("--allow-pending");
const manifest = JSON.parse(
  await readFile(join(root, "config/system-action-coverage.json"), "utf8"),
);
const failures = [];
let checkedFunctions = 0;

if (
  manifest.schemaVersion !== 2 ||
  manifest.protocolProfile !== "native-eth-uniswap-v4-schema8"
) {
  failures.push("action coverage is not the active native-v4 schema8 profile");
}

function contractBody(source, contractName) {
  const declaration = new RegExp(`\\bcontract\\s+${contractName}\\b`).exec(source);
  if (!declaration) throw new Error(`contract ${contractName} not found`);
  const opening = source.indexOf("{", declaration.index);
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(opening + 1, index);
  }
  throw new Error(`contract ${contractName} body is incomplete`);
}

function publicSourceFunctions(body) {
  const functions = [];
  const matches = [...body.matchAll(/\bfunction\s+([A-Za-z0-9_]+)\s*\(/g)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const end = matches[index + 1]?.index ?? body.length;
    const declaration = body.slice(match.index, end).split("{", 1)[0];
    if (/\b(public|external)\b/.test(declaration)) functions.push(match[1]);
  }
  return [...new Set(functions)].sort();
}

async function findArtifact(directory, artifactName) {
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    const info = await stat(path);
    if (info.isDirectory()) {
      const found = await findArtifact(path, artifactName);
      if (found) return found;
    } else if (entry === `${artifactName}.json` && !path.includes("build-info")) {
      return path;
    }
  }
  return null;
}

for (const contract of manifest.contracts) {
  const sourceText = await readFile(join(root, contract.source), "utf8");
  const discovered = publicSourceFunctions(contractBody(sourceText, contract.contract));
  const declared = [...new Set(contract.functions)].sort();
  if (JSON.stringify(discovered) !== JSON.stringify(declared)) {
    failures.push(
      `${contract.contract} source mismatch: discovered=${discovered.join(",")} manifest=${declared.join(",")}`,
    );
  }
  const artifactPath = await findArtifact(
    join(root, "packages/contracts/out"),
    contract.artifact,
  );
  if (!artifactPath) {
    failures.push(`${contract.artifact} compiled artifact missing`);
    continue;
  }
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  const abiFunctions = new Set(
    artifact.abi.filter((entry) => entry.type === "function").map((entry) => entry.name),
  );
  for (const name of [...declared, ...(contract.inheritedFunctions ?? [])]) {
    checkedFunctions += 1;
    if (!abiFunctions.has(name))
      failures.push(`${contract.artifact}.${name} missing from compiled ABI`);
  }
  if (!contract.evidence?.length)
    failures.push(`${contract.contract} has no mapped test evidence`);
  for (const evidence of contract.evidence ?? []) {
    try {
      await stat(join(root, "packages/contracts/test", evidence));
    } catch {
      failures.push(`${contract.contract} evidence missing: ${evidence}`);
    }
  }
}

for (const endpoint of manifest.api) {
  const source = await readFile(join(root, endpoint.source), "utf8");
  if (!source.includes(endpoint.path))
    failures.push(`${endpoint.method} ${endpoint.path} missing from ${endpoint.source}`);
}

for (const page of manifest.ui ?? []) {
  try {
    await stat(join(root, page.source));
  } catch {
    failures.push(`UI route ${page.route} missing source ${page.source}`);
  }
}

for (const worker of manifest.workers ?? []) {
  let source;
  try {
    source = await readFile(join(root, worker.source), "utf8");
  } catch {
    failures.push(`worker ${worker.id} missing source ${worker.source}`);
    continue;
  }
  for (const marker of worker.markers) {
    if (!source.includes(marker))
      failures.push(`worker ${worker.id} missing marker ${marker}`);
  }
}

const pending = manifest.journeys.filter((journey) => journey.status !== "passed");
if (pending.length && !allowPending)
  failures.push(`pending journeys: ${pending.map((journey) => journey.id).join(", ")}`);

const summary = {
  schemaVersion: manifest.schemaVersion,
  checkedContracts: manifest.contracts.length,
  checkedContractFunctions: checkedFunctions,
  checkedApiEndpoints: manifest.api.length,
  checkedUiRoutes: manifest.ui?.length ?? 0,
  checkedWorkers: manifest.workers?.length ?? 0,
  browserAndOperationalJourneys: manifest.journeys.length,
  pendingJourneys: pending.length,
  allowPending,
  passed: failures.length === 0,
  failures,
};
console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exitCode = 1;

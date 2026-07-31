#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";
import { keccak256 } from "viem";

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1 || !argv[index + 1]) throw new Error(`Missing --${name}`);
  return resolve(argv[index + 1]);
};
const definitionPath = option("definition");
const contractsRoot = option("contracts-root");
const output = option("output");
const releaseSha = argv.includes("--release-sha")
  ? argv[argv.indexOf("--release-sha") + 1]
  : "";
if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error("Invalid --release-sha");
const definition = JSON.parse(readFileSync(definitionPath, "utf8"));
if (definition.schemaVersion !== 1 || definition.schema !== 16) {
  throw new Error("Coverage definition must be Schema-16 version 1");
}

const digest = (value) => createHash("sha256").update(value).digest("hex");
const runtimeRoots = [];
const sourceSet = new Set();
for (const root of definition.roots) {
  const artifactPath = resolve(
    contractsRoot,
    "out",
    basename(root.source),
    `${root.contract}.json`,
  );
  if (!existsSync(artifactPath)) {
    throw new Error(`Missing coverage root artifact: ${artifactPath}`);
  }
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const metadataSources = Object.keys(artifact.metadata?.sources ?? {});
  if (!metadataSources.includes(root.source)) {
    throw new Error(`${root.contract} artifact does not contain ${root.source}`);
  }
  const creationBytecode = artifact.bytecode?.object;
  const runtimeBytecode = artifact.deployedBytecode?.object;
  if (!creationBytecode?.startsWith("0x") || !runtimeBytecode?.startsWith("0x")) {
    throw new Error(`${root.contract} artifact is missing bytecode`);
  }
  for (const source of metadataSources) {
    if (
      source.startsWith("src/") &&
      !source.startsWith("src/interfaces/") &&
      !source.startsWith("src/devnet/") &&
      !source.startsWith("src/testnet/")
    ) {
      sourceSet.add(source);
    }
  }
  runtimeRoots.push({
    contract: root.contract,
    source: root.source,
    modes: [...root.modes].sort(),
    artifact: artifactPath.replaceAll("\\", "/"),
    creationCodeHash: keccak256(creationBytecode),
    runtimeCodeHash: keccak256(runtimeBytecode),
    coverageExcludedReason: root.coverageExcludedReason ?? null,
  });
}

const sources = [...sourceSet].sort();
const retiredInClosure = definition.retiredSources.filter((source) => sourceSet.has(source));
if (retiredInClosure.length) {
  throw new Error(`Retired sources entered Schema-16 closure: ${retiredInClosure.join(", ")}`);
}
const sourceDetails = sources.map((source) => ({
  source,
  sha256: digest(readFileSync(resolve(contractsRoot, source))),
  coverageRequired: !definition.roots.some(
    (root) => root.source === source && root.coverageExcludedReason,
  ),
  exclusionReason:
    definition.roots.find((root) => root.source === source)?.coverageExcludedReason ?? null,
}));
const scopePayload = {
  schemaVersion: 1,
  schema: 16,
  releaseSha,
  definitionSha256: digest(readFileSync(definitionPath)),
  thresholds: definition.thresholds,
  roots: runtimeRoots,
  sources: sourceDetails,
  retiredSources: [...definition.retiredSources].sort(),
  coverageCompiler: definition.coverageCompiler,
  coverageTests: [...definition.coverageTests].sort(),
  coverageCompileExcludedSources: [...definition.coverageCompileExcludedSources].sort(),
};
const canonical = JSON.stringify(scopePayload);
const result = {
  ...scopePayload,
  scopeSha256: digest(canonical),
};
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
chmodSync(output, 0o600);

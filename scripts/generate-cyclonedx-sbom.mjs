#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [inputPath, outputPath, gitSha] = process.argv.slice(2);
if (!inputPath || !outputPath || !gitSha) {
  console.error("usage: generate-cyclonedx-sbom.mjs <pnpm-list.json> <output.json> <git-sha>");
  process.exit(2);
}

const projects = JSON.parse(await readFile(inputPath, "utf8"));
const components = new Map();
const relationships = new Map();

const encodePurl = (name, version) => {
  const encodedName = name
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
};

const addDependency = (parentRef, childRef) => {
  if (!relationships.has(parentRef)) relationships.set(parentRef, new Set());
  relationships.get(parentRef).add(childRef);
};

const visitDependencies = (dependencies, parentRef) => {
  for (const [name, dependency] of Object.entries(dependencies ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const version = String(dependency.version ?? "unknown");
    const ref = encodePurl(name, version);
    if (!components.has(ref)) {
      components.set(ref, {
        type: "library",
        "bom-ref": ref,
        name,
        version,
        purl: ref,
      });
    }
    addDependency(parentRef, ref);
    visitDependencies(dependency.dependencies, ref);
    visitDependencies(dependency.devDependencies, ref);
    visitDependencies(dependency.optionalDependencies, ref);
  }
};

const rootRefs = [];
for (const project of [...projects].sort((a, b) =>
  String(a.name ?? a.path).localeCompare(String(b.name ?? b.path)),
)) {
  const name = String(project.name ?? "robyn-workspace");
  const version = String(project.version ?? "0.0.0");
  const ref = `${encodePurl(name, version)}?vcs_ref=${gitSha}`;
  rootRefs.push(ref);
  components.set(ref, {
    type: "application",
    "bom-ref": ref,
    name,
    version,
    purl: encodePurl(name, version),
    properties: [{ name: "robyn:git-sha", value: gitSha }],
  });
  visitDependencies(project.dependencies, ref);
  visitDependencies(project.devDependencies, ref);
  visitDependencies(project.optionalDependencies, ref);
}

const serialHash = createHash("sha256").update(gitSha).digest("hex").slice(0, 32);
const serialUuid = [
  serialHash.slice(0, 8),
  serialHash.slice(8, 12),
  `5${serialHash.slice(13, 16)}`,
  `8${serialHash.slice(17, 20)}`,
  serialHash.slice(20, 32),
].join("-");

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${serialUuid}`,
  version: 1,
  metadata: {
    component: {
      type: "application",
      "bom-ref": `urn:robyn:release:${gitSha}`,
      name: "robyn",
      version: gitSha,
      components: rootRefs.map((ref) => components.get(ref)),
    },
    properties: [{ name: "robyn:git-sha", value: gitSha }],
  },
  components: [...components.entries()]
    .filter(([ref]) => !rootRefs.includes(ref))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, component]) => component),
  dependencies: [...relationships.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() })),
};

await writeFile(outputPath, `${JSON.stringify(sbom, null, 2)}\n`);

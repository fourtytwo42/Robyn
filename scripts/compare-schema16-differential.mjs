#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [baselinePath, candidatePath, outputPath] = process.argv
  .slice(2)
  .map((path) => resolve(path));
if (!baselinePath || !candidatePath || !outputPath) {
  throw new Error("Usage: compare baseline.json candidate.json output.json");
}
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));

function normalize(snapshot) {
  const replacements = Object.entries(snapshot.addressBook)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, address]) => [address.slice(2).toLowerCase(), `@${role}`]);
  const visit = (value, key = "") => {
    if (key === "addressBook" || key === "fingerprint") return undefined;
    if (key === "blockNumber" || key === "logIndex") return undefined;
    if (Array.isArray(value)) return value.map((item) => visit(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .map(([nestedKey, nested]) => [nestedKey, visit(nested, nestedKey)])
          .filter(([, nested]) => nested !== undefined),
      );
    }
    if (typeof value !== "string") return value;
    let normalized = value.toLowerCase();
    for (const [address, role] of replacements) {
      normalized = normalized.replaceAll(address, role);
    }
    return normalized;
  };
  return visit(snapshot);
}

const left = normalize(baseline);
const right = normalize(candidate);
const leftJson = JSON.stringify(left);
const rightJson = JSON.stringify(right);
const equal = leftJson === rightJson;
const firstDifference = (() => {
  if (equal) return null;
  const limit = Math.min(leftJson.length, rightJson.length);
  let index = 0;
  while (index < limit && leftJson[index] === rightJson[index]) index += 1;
  return {
    offset: index,
    baseline: leftJson.slice(Math.max(0, index - 160), index + 320),
    candidate: rightJson.slice(Math.max(0, index - 160), index + 320),
  };
})();
const report = {
  schemaVersion: 1,
  passed: equal,
  baselineFingerprint: createHash("sha256").update(leftJson).digest("hex"),
  candidateFingerprint: createHash("sha256").update(rightJson).digest("hex"),
  firstDifference,
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  mode: 0o600,
});
if (!equal) process.exit(1);

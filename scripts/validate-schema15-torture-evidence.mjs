#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1 || !argv[index + 1]) throw new Error(`Missing --${name}`);
  return resolve(argv[index + 1]);
};
const matrix = JSON.parse(readFileSync(option("matrix"), "utf8"));
const testLog = readFileSync(option("test-log"), "utf8");
const lcov = readFileSync(option("lcov"), "utf8");
const output = option("output");

const missingActions = [];
for (const group of matrix.groups) {
  for (const action of group.actions) {
    if (!action.tests.some((name) => testLog.includes(`[PASS] ${name}`))) {
      missingActions.push(`${group.id}:${action.id}`);
    }
  }
}

let source = "";
let include = false;
let lineFound = 0;
let lineHit = 0;
let branchFound = 0;
let branchHit = 0;
for (const line of lcov.split(/\r?\n/)) {
  if (line.startsWith("SF:")) {
    source = line.slice(3).replaceAll("\\", "/");
    include =
      (source.startsWith("src/") || source.includes("/src/")) &&
      !source.includes("/src/devnet/") &&
      !source.includes("/src/testnet/") &&
      !source.includes("/mocks/") &&
      !source.includes("Mock");
  } else if (include && line.startsWith("LF:")) {
    lineFound += Number(line.slice(3));
  } else if (include && line.startsWith("LH:")) {
    lineHit += Number(line.slice(3));
  } else if (include && line.startsWith("BRF:")) {
    branchFound += Number(line.slice(4));
  } else if (include && line.startsWith("BRH:")) {
    branchHit += Number(line.slice(4));
  } else if (line === "end_of_record") {
    source = "";
    include = false;
  }
}
const linePercent = lineFound === 0 ? 0 : (lineHit * 100) / lineFound;
const branchPercent = branchFound === 0 ? 0 : (branchHit * 100) / branchFound;
const result = {
  schemaVersion: 1,
  actionGroups: matrix.groups.length,
  requiredActions: matrix.groups.reduce((sum, group) => sum + group.actions.length, 0),
  missingActions,
  coverage: {
    lineHit,
    lineFound,
    linePercent,
    requiredLinePercent: 90,
    branchHit,
    branchFound,
    branchPercent,
    requiredBranchPercent: 80,
  },
  passed:
    missingActions.length === 0 && linePercent >= 90 && branchPercent >= 80,
};
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
chmodSync(output, 0o600);
if (!result.passed) {
  throw new Error(
    `Torture validation failed: missing=${missingActions.length}, ` +
      `line=${linePercent.toFixed(2)}%, branch=${branchPercent.toFixed(2)}%`,
  );
}

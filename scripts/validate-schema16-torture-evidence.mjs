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
const scope = JSON.parse(readFileSync(option("scope"), "utf8"));
const testLog = readFileSync(option("test-log"), "utf8");
const lcov = readFileSync(option("lcov"), "utf8");
const output = option("output");
if (
  scope.schema !== 16 ||
  scope.thresholds?.aggregateLinePercent !== 90 ||
  scope.thresholds?.aggregateBranchPercent !== 80
) {
  throw new Error("Schema-16 coverage scope must retain the fixed 90/80 thresholds");
}

const missingActions = [];
for (const group of matrix.groups) {
  for (const action of group.actions) {
    if (!action.tests.some((name) => testLog.includes(`[PASS] ${name}`))) {
      missingActions.push(`${group.id}:${action.id}`);
    }
  }
}

const records = new Map();
let record;
for (const line of lcov.split(/\r?\n/)) {
  if (line.startsWith("SF:")) {
    record = {
      source: line.slice(3).replaceAll("\\", "/"),
      lines: new Map(),
      branches: [],
    };
  } else if (record && line.startsWith("DA:")) {
    const [lineNumber, hits] = line.slice(3).split(",");
    record.lines.set(Number(lineNumber), Number(hits));
  } else if (record && line.startsWith("BRDA:")) {
    const [lineNumber, block, branch, taken] = line.slice(5).split(",");
    record.branches.push({
      line: Number(lineNumber),
      block: Number(block),
      branch: Number(branch),
      hits: taken === "-" ? 0 : Number(taken),
    });
  } else if (record && line === "end_of_record") {
    records.set(record.source, record);
    record = undefined;
  }
}

const expectedSources = scope.sources.filter((entry) => entry.coverageRequired);
const missingSources = expectedSources
  .filter((entry) => !records.has(entry.source))
  .map((entry) => entry.source);
const retiredCounted = scope.retiredSources.filter((source) =>
  expectedSources.some((entry) => entry.source === source),
);
const perContract = [];
const branchInstrumentationFailures = [];
let lineFound = 0;
let lineHit = 0;
let branchFound = 0;
let branchHit = 0;
for (const entry of expectedSources) {
  const sourceRecord = records.get(entry.source);
  if (!sourceRecord) continue;
  const uncoveredLines = [...sourceRecord.lines]
    .filter(([, hits]) => hits === 0)
    .map(([line]) => line);
  const uncoveredBranches = sourceRecord.branches
    .filter((branch) => branch.hits === 0)
    .map(({ line, block, branch }) => ({ line, block, branch }));
  const sourceLineFound = sourceRecord.lines.size;
  const sourceLineHit = sourceLineFound - uncoveredLines.length;
  const sourceBranchFound = sourceRecord.branches.length;
  const sourceBranchHit = sourceBranchFound - uncoveredBranches.length;
  const executedBranchLines = [
    ...new Set(
      sourceRecord.branches
        .filter((branch) => (sourceRecord.lines.get(branch.line) ?? 0) > 0)
        .map((branch) => branch.line),
    ),
  ];
  if (
    sourceBranchFound > 0 &&
    sourceBranchHit === 0 &&
    executedBranchLines.length > 0
  ) {
    branchInstrumentationFailures.push({
      source: entry.source,
      executedBranchLines,
      reason:
        "LCOV reports executed source lines for branch sites but zero taken branches",
    });
  }
  lineFound += sourceLineFound;
  lineHit += sourceLineHit;
  branchFound += sourceBranchFound;
  branchHit += sourceBranchHit;
  perContract.push({
    source: entry.source,
    sourceSha256: entry.sha256,
    lineHit: sourceLineHit,
    lineFound: sourceLineFound,
    linePercent: sourceLineFound === 0 ? 100 : (sourceLineHit * 100) / sourceLineFound,
    branchHit: sourceBranchHit,
    branchFound: sourceBranchFound,
    branchPercent:
      sourceBranchFound === 0 ? 100 : (sourceBranchHit * 100) / sourceBranchFound,
    uncoveredLines,
    uncoveredBranches,
  });
}
const linePercent = lineFound === 0 ? 0 : (lineHit * 100) / lineFound;
const branchPercent = branchFound === 0 ? 0 : (branchHit * 100) / branchFound;
const instrumentationFailuresAreFatal = scope.coverageCompiler?.viaIR === true;
const passed =
  missingActions.length === 0 &&
  missingSources.length === 0 &&
  retiredCounted.length === 0 &&
  (!instrumentationFailuresAreFatal || branchInstrumentationFailures.length === 0) &&
  linePercent >= scope.thresholds.aggregateLinePercent &&
  branchPercent >= scope.thresholds.aggregateBranchPercent;
const result = {
  schemaVersion: 2,
  schema: 16,
  releaseSha: scope.releaseSha,
  scopeSha256: scope.scopeSha256,
  viaIrMinimumCoverage: false,
  sourceMappingLimitation: null,
  branchInstrumentationValid:
    !instrumentationFailuresAreFatal || branchInstrumentationFailures.length === 0,
  branchInstrumentationFailures,
  actionGroups: matrix.groups.length,
  requiredActions: matrix.groups.reduce((sum, group) => sum + group.actions.length, 0),
  missingActions,
  missingSources,
  retiredCounted,
  coverage: {
    lineHit,
    lineFound,
    linePercent,
    requiredLinePercent: scope.thresholds.aggregateLinePercent,
    branchHit,
    branchFound,
    branchPercent,
    requiredBranchPercent: scope.thresholds.aggregateBranchPercent,
  },
  perContract,
  passed,
};
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
chmodSync(output, 0o600);
if (!passed) {
  throw new Error(
    `Torture validation failed: actions=${missingActions.length}, sources=${missingSources.length}, ` +
      `retired=${retiredCounted.length}, branchInstrumentation=${
        instrumentationFailuresAreFatal ? branchInstrumentationFailures.length : 0
      }, ` +
      `line=${linePercent.toFixed(2)}%, ` +
      `branch=${branchPercent.toFixed(2)}%`,
  );
}

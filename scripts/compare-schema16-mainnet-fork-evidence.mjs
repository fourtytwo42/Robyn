#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const capitalPath = resolve(required("ROBYN_MAINNET_BROADCAST_CAPITAL_LEDGER"));
const inProcessPath = resolve(required("ROBYN_MAINNET_IN_PROCESS_FORK_LOG"));
const outputPath = resolve(required("ROBYN_MAINNET_FORK_COMPARISON"));
const [capital, inProcess] = await Promise.all([
  readFile(capitalPath, "utf8").then(JSON.parse),
  readFile(inProcessPath, "utf8"),
]);
const pass = /\[PASS\] testRemediatedProductionLifecycleOnRobinhoodMainnetFork/.test(inProcess);
const match = inProcess.match(
  /bondingSpend:\s*([0-9]+).*?recoveredNative:\s*([0-9]+).*?recoveryBps:\s*([0-9]+)/s,
);
if (!pass || !match) throw new Error("in-process fork evidence is missing its passing capital ledger");
const reference = {
  bondingSpendWei: match[1],
  totalRecoveredWei: match[2],
  recoveryBps: match[3],
};
const recoveryDelta =
  BigInt(capital.totalRecoveredWei) > BigInt(reference.totalRecoveredWei)
    ? BigInt(capital.totalRecoveredWei) - BigInt(reference.totalRecoveredWei)
    : BigInt(reference.totalRecoveredWei) - BigInt(capital.totalRecoveredWei);
const toleranceWei = 100_000_000n;
const comparison = {
  schemaVersion: 16,
  generatedAt: new Date().toISOString(),
  broadcastCapitalPath: capitalPath,
  inProcessForkLogPath: inProcessPath,
  broadcast: {
    bondingSpendWei: capital.bondingSpendWei,
    totalRecoveredWei: capital.totalRecoveredWei,
    recoveryBps: capital.recoveryBps,
    lockedPrincipalUnchanged:
      capital.lockedPrincipal === capital.lockedPrincipalAfter,
  },
  reference,
  recoveryDeltaWei: recoveryDelta.toString(),
  toleranceWei: toleranceWei.toString(),
  passed:
    capital.bondingSpendWei === reference.bondingSpendWei &&
    capital.recoveryBps === reference.recoveryBps &&
    capital.lockedPrincipal === capital.lockedPrincipalAfter &&
    recoveryDelta <= toleranceWei,
};
if (!comparison.passed) throw new Error("broadcast and in-process fork capital results differ");
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
await writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`, {
  mode: 0o600,
  flag: "wx",
});
process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);

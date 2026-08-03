#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return path.resolve(value);
};
const policyPath = path.resolve(process.env.ROBYN_MAINNET_SUPPORT_POLICY ?? "config/protocol/robinhood-mainnet-support-policy.json");
const sampleRoot = required("ROBYN_SCHEMA18_ROUTE_SAMPLE_EVIDENCE");
const forkRoot = required("ROBYN_SCHEMA18_ROUTE_FORK_EVIDENCE");
const outputRoot = required("ROBYN_SCHEMA18_ROUTE_QUALIFICATION_OUTPUT");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value, null, 2);
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
async function verifySums(root) {
  const raw = await readFile(path.join(root, "SHA256SUMS"), "utf8");
  for (const line of raw.trim().split("\n")) {
    const [expected, ...parts] = line.trim().split(/\s+/);
    const named = parts.join(" ").replace(/^\*/, "");
    const file = path.isAbsolute(named) ? named : path.join(root, named);
    if (sha256(await readFile(file)) !== expected) throw new Error(`checksum mismatch ${named}`);
  }
  return sha256(raw);
}
const policy = await readJson(policyPath);
if (policy.schemaVersion !== 18 || policy.chainId !== 4663 || policy.status !== "qualified-awaiting-governance") throw new Error("qualified Schema-18 policy required");
const sampleSum = await verifySums(sampleRoot);
const forkSum = await verifySums(forkRoot);
const names = (await readdir(sampleRoot)).filter((name) => /^sample-[0-9]+\.json$/.test(name)).sort();
if (names.length !== 13) throw new Error(`expected 13 samples, received ${names.length}`);
const samples = await Promise.all(names.map((name) => readJson(path.join(sampleRoot, name))));
const started = Date.parse(samples[0].checkedAt);
const ended = Date.parse(samples.at(-1).checkedAt);
if (!Number.isFinite(started) || !Number.isFinite(ended) || ended - started < 3_600_000) throw new Error("route sampling did not span one hour");
for (const sample of samples) {
  if (sample.schemaVersion !== 18 || sample.chainId !== 4663 || sample.policyHash !== policy.qualificationInputPolicyHash) throw new Error("sample identity or qualification failed");
}
const fork = await readJson(path.join(forkRoot, "summary.json"));
if (fork.executionMode !== "local-fork-broadcast" || fork.chainId !== 4663 || !fork.passed || fork.receiptCount !== 65 || fork.uniqueReceiptCount !== 65 || fork.successfulReceiptCount !== 65) throw new Error("broadcast-style fork evidence failed");
const forkAssets = new Map(fork.assets.map((asset) => [asset.symbol, asset]));
const routes = [];
for (const asset of policy.assets) {
  const observed = samples.map((sample) => sample.assets.find((entry) => entry.symbol === asset.symbol));
  if (observed.some((entry) => !entry || !entry.readOnlyPassed || entry.feed?.status !== "available")) throw new Error(`${asset.symbol} feed or read-only qualification failed`);
  const broadcast = forkAssets.get(asset.symbol);
  if (!broadcast || broadcast.capWei !== asset.capWei || broadcast.allowanceAfter !== "0" || Number(broadcast.recoveryBps) < 9500) throw new Error(`${asset.symbol} broadcast qualification failed`);
  if (asset.symbol === "WETH") {
    if (broadcast.poolId !== null || broadcast.recoveryBps !== "10000") throw new Error("WETH parity qualification failed");
    routes.push({ symbol: asset.symbol, kind: "wrapped-native", capWei: asset.capWei, recoveryBps: 10000 });
    continue;
  }
  const pools = observed.map((entry) => entry.pools.find((pool) => pool.poolId.toLowerCase() === asset.selectedPool.toLowerCase()));
  if (pools.some((pool) => !pool)) throw new Error(`${asset.symbol} selected pool missing from a sample`);
  const capRows = pools.map((pool) => pool.ladder.find((row) => row.nativeInputWei === asset.capWei));
  if (capRows.some((row) => !row?.passed || row.recoveryBps < 9500)) throw new Error(`${asset.symbol} cap failed the observation window`);
  if (broadcast.poolId.toLowerCase() !== asset.selectedPool.toLowerCase()) throw new Error(`${asset.symbol} fork pool differs from policy`);
  const liquidities = pools.map((pool) => BigInt(pool.state.liquidity));
  const minimumObserved = liquidities.reduce((a, b) => a < b ? a : b);
  const derivedFloor = minimumObserved * 9n / 10n;
  const latestTick = pools.at(-1).state.tick;
  if (BigInt(asset.selectedRoute.minimumLiquidity) !== derivedFloor || asset.selectedRoute.referenceTick !== latestTick) throw new Error(`${asset.symbol} selected route controls are not evidence-derived`);
  routes.push({
    symbol: asset.symbol,
    asset: asset.address,
    poolId: asset.selectedPool,
    fee: pools.at(-1).fee,
    tickSpacing: pools.at(-1).tickSpacing,
    hooks: pools.at(-1).hooks,
    capWei: asset.capWei,
    minimumObservedLiquidity: minimumObserved.toString(),
    minimumLiquidity: derivedFloor.toString(),
    tickMinimum: Math.min(...pools.map((pool) => pool.state.tick)),
    tickMaximum: Math.max(...pools.map((pool) => pool.state.tick)),
    referenceTick: latestTick,
    maximumReferenceTickDeviation: asset.selectedRoute.maximumReferenceTickDeviation,
    enforceReferencePrice: asset.selectedRoute.enforceReferencePrice,
    verificationClass: asset.selectedRoute.verificationClass,
    minimumObservedRecoveryBps: Math.min(...capRows.map((row) => row.recoveryBps)),
    broadcastRecoveryBps: Number(broadcast.recoveryBps),
  });
}
const evidenceHash = sha256(`${sampleSum}${forkSum}`);
if (policy.assets.some((asset) => asset.evidenceHash !== evidenceHash)) throw new Error("policy evidence hash differs from sealed qualification evidence");
const report = {
  schemaVersion: 18,
  chainId: 4663,
  status: "passed",
  policyVersion: policy.policyVersion,
  policyHash: policy.policyHash,
  qualificationInputPolicyHash: policy.qualificationInputPolicyHash,
  sampleCount: samples.length,
  sampledFrom: samples[0].checkedAt,
  sampledThrough: samples.at(-1).checkedAt,
  sampleDurationSeconds: Math.floor((ended - started) / 1000),
  sampleEvidenceSha256: sampleSum,
  forkEvidenceSha256: forkSum,
  evidenceHash,
  forkBlock: fork.forkBlock,
  receiptCount: fork.receiptCount,
  routes,
  mainnetTransactionsBroadcast: 0,
};
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const raw = `${json(report)}\n`;
await writeFile(path.join(outputRoot, "qualification-summary.json"), raw, { mode: 0o600, flag: "wx" });
await writeFile(path.join(outputRoot, "SHA256SUMS"), `${sha256(raw)}  qualification-summary.json\n`, { mode: 0o600, flag: "wx" });
process.stdout.write(raw);

#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDatabase } from "../packages/db/dist/index.js";
import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  toHex,
} from "viem";

const CHAIN_ID = 4663;
const CONTRACT_SHA = "4728cb5cce4b0bad1c275b8bfcc2de3e8fb3f6a4";
const APPLICATION_SHA = "5ea50ed836d81416a7a6a32c8078a864fca28d0b";
const POLICY_HASH =
  "5e92d61940f39b05f7b61273b0a2d190d77cf204369a224822b098a4f5ca01e1";
const MINIMUM_FREE_BYTES = 12n * 1024n ** 3n;
const MAXIMUM_DATABASE_BYTES = 100n * 1024n ** 2n;
const RANGE = 50_000n;

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const manifestPath = path.resolve(required("ROBYN_SCHEMA18_MAINNET_SCOPED_MANIFEST"));
const outputRoot = path.resolve(required("ROBYN_SCHEMA18_MAINNET_SCOPED_EVIDENCE"));
const rpc = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
const statusUrl = process.env.ROBYN_MAINNET_API_STATUS_URL ?? "http://127.0.0.1:3121/status";
if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(rpc)) {
  throw new Error("scoped-indexer verification requires the loopback LAN gateway");
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) =>
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);
const lower = (value) => value.toLowerCase();
const logKey = (log) => `${lower(log.transactionHash)}:${Number(BigInt(log.logIndex))}`;

const manifestRaw = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);
if (
  manifest.schemaVersion !== 18 ||
  manifest.chainId !== CHAIN_ID ||
  manifest.contractReleaseSha !== CONTRACT_SHA ||
  manifest.applicationReleaseSha !== APPLICATION_SHA ||
  manifest.indexingPolicy?.policyHash !== POLICY_HASH ||
  manifest.contracts?.factory?.toLowerCase() !== manifest.contracts?.launchFactory?.toLowerCase()
) {
  throw new Error("scoped Mainnet manifest identity mismatch");
}

const status = await fetch(statusUrl).then(async (response) => {
  if (!response.ok) throw new Error(`Mainnet API status failed with ${response.status}`);
  return response.json();
});
if (
  status.chainId !== CHAIN_ID ||
  status.indexingScopeHash !== POLICY_HASH ||
  status.ingestionStatus !== "ok" ||
  status.projectionStatus !== "ok" ||
  BigInt(status.ingestionLagBlocks) > 100n ||
  BigInt(status.projectionLagBlocks) > 50n ||
  status.rpcGateway?.status !== "ok" ||
  status.rpcGateway?.activeProvider !== "primary" ||
  status.rpcGateway?.fallbackTrafficAuthorized !== false
) {
  throw new Error("scoped Mainnet API, projection, or LAN-only RPC health failed");
}

const { sql } = createDatabase();
try {
  const launches = await sql`
    select launch_id, token, vault, market, adapter, locker, pool_id, created_block
    from launches where chain_id = ${CHAIN_ID} order by launch_id
  `;
  if (launches.length !== 1) throw new Error(`expected one Mainnet launch, found ${launches.length}`);
  const launch = launches[0];
  const retained = await sql`
    select transaction_hash as "transactionHash", log_index as "logIndex", address, topics
    from raw_logs where chain_id = ${CHAIN_ID}
  `;
  const databaseResult = await sql`select pg_database_size(current_database())::text as bytes`;
  const databaseBytes = BigInt(databaseResult[0].bytes);
  if (databaseBytes >= MAXIMUM_DATABASE_BYTES) throw new Error("scoped Mainnet database exceeds 100 MiB");

  const dynamicAddresses = [launch.token, launch.vault, launch.market, launch.adapter, launch.locker].map(lower);
  const protocolRoots = manifest.indexingPolicy.protocolRoots.map(lower);
  const poolManager = lower(manifest.indexingPolicy.poolManager);
  const allowed = new Set([...protocolRoots, ...dynamicAddresses, poolManager]);
  const excluded = new Set([
    manifest.contracts.wrappedNative,
    manifest.contracts.permit2,
    manifest.contracts.positionManager,
    manifest.contracts.universalRouter,
    ...manifest.assetRoutes.filter((route) => route.symbol !== "WETH").map((route) => route.address),
  ].map(lower));
  const invalidSources = retained.filter((log) => !allowed.has(lower(log.address)));
  const excludedSources = retained.filter((log) => excluded.has(lower(log.address)));
  const retainedKeys = new Set(retained.map(logKey));
  if (retainedKeys.size !== retained.length) throw new Error("duplicate retained Sherwood log");
  if (invalidSources.length !== 0 || excludedSources.length !== 0) {
    throw new Error("excluded or unrelated global source entered raw_logs");
  }
  const permittedPoolTopics = new Set(manifest.indexingPolicy.poolEventTopics.map(lower));
  const poolId = lower(launch.pool_id);
  const invalidPoolLogs = retained.filter((log) => {
    if (lower(log.address) !== poolManager) return false;
    const topics = log.topics.map(lower);
    return !permittedPoolTopics.has(topics[0]) || topics[1] !== poolId;
  });
  if (invalidPoolLogs.length !== 0) throw new Error("unscoped PoolManager log retained");

  const client = createPublicClient({ transport: http(rpc, { timeout: 30_000, retryCount: 0 }) });
  if ((await client.getChainId()) !== CHAIN_ID || (await client.request({ method: "eth_syncing", params: [] })) !== false) {
    throw new Error("LAN gateway is wrong-chain or syncing");
  }
  const factoryAbi = parseAbi([
    "function launchTokenById(uint256) view returns (address)",
    "function vaultByToken(address) view returns (address)",
  ]);
  const marketAbi = parseAbi([
    "function marketByToken(address) view returns (address)",
    "function adapterByToken(address) view returns (address)",
    "function poolIdByToken(address) view returns (bytes32)",
  ]);
  const adapterAbi = parseAbi(["function locker() view returns (address)"]);
  const token = await client.readContract({ address: getAddress(manifest.contracts.launchFactory), abi: factoryAbi, functionName: "launchTokenById", args: [1n] });
  const [vault, market, adapter, directPoolId] = await Promise.all([
    client.readContract({ address: getAddress(manifest.contracts.launchFactory), abi: factoryAbi, functionName: "vaultByToken", args: [token] }),
    client.readContract({ address: getAddress(manifest.contracts.marketFactory), abi: marketAbi, functionName: "marketByToken", args: [token] }),
    client.readContract({ address: getAddress(manifest.contracts.marketFactory), abi: marketAbi, functionName: "adapterByToken", args: [token] }),
    client.readContract({ address: getAddress(manifest.contracts.marketFactory), abi: marketAbi, functionName: "poolIdByToken", args: [token] }),
  ]);
  const locker = await client.readContract({ address: adapter, abi: adapterAbi, functionName: "locker" });
  const direct = [token, vault, market, adapter, locker, directPoolId].map(lower);
  const projected = [launch.token, launch.vault, launch.market, launch.adapter, launch.locker, launch.pool_id].map(lower);
  if (direct.some((value, index) => value !== projected[index])) {
    throw new Error("launch projection differs from direct contract state");
  }

  const queried = new Map();
  const addressFilter = [...new Set([...protocolRoots, ...dynamicAddresses])];
  const fromBlock = BigInt(manifest.deploymentBlock);
  const head = BigInt(status.observedHeadBlock);
  for (let start = fromBlock; start <= head; start += RANGE) {
    const end = start + RANGE - 1n > head ? head : start + RANGE - 1n;
    const addressLogs = await client.request({
      method: "eth_getLogs",
      params: [{ address: addressFilter, fromBlock: toHex(start), toBlock: toHex(end) }],
    });
    const poolLogs = await client.request({
      method: "eth_getLogs",
      params: [{
        address: poolManager,
        topics: [manifest.indexingPolicy.poolEventTopics, [launch.pool_id]],
        fromBlock: toHex(start),
        toBlock: toHex(end),
      }],
    });
    for (const log of [...addressLogs, ...poolLogs]) queried.set(logKey(log), log);
  }
  const missing = [...queried.keys()].filter((key) => !retainedKeys.has(key));
  const unexpected = [...retainedKeys].filter((key) => !queried.has(key));
  if (missing.length !== 0 || unexpected.length !== 0) {
    throw new Error(`scoped log mismatch: missing=${missing.length} unexpected=${unexpected.length}`);
  }

  const disk = await statfs("/");
  const freeBytes = BigInt(disk.bavail) * BigInt(disk.bsize);
  const totalBytes = BigInt(disk.blocks) * BigInt(disk.bsize);
  const freePercentBps = totalBytes === 0n ? 0n : (freeBytes * 10_000n) / totalBytes;
  if (freeBytes < MINIMUM_FREE_BYTES || freePercentBps < 1500n) {
    throw new Error("Mainnet VM disk runway is below the activation threshold");
  }

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    passed: true,
    chainId: CHAIN_ID,
    contractReleaseSha: CONTRACT_SHA,
    applicationReleaseSha: APPLICATION_SHA,
    manifestPath,
    manifestSha256: sha256(manifestRaw),
    policyHash: POLICY_HASH,
    deploymentBlock: String(manifest.deploymentBlock),
    observedHeadBlock: String(status.observedHeadBlock),
    ingestionLagBlocks: String(status.ingestionLagBlocks),
    projectionLagBlocks: String(status.projectionLagBlocks),
    trackedLaunches: launches.length,
    trackedAddresses: Number(status.trackedAddresses),
    trackedPoolIds: Number(status.trackedPoolIds),
    retainedLogs: retained.length,
    independentlyQueriedLogs: queried.size,
    duplicateLogs: retained.length - retainedKeys.size,
    missingLogs: missing.length,
    unexpectedLogs: unexpected.length,
    excludedGlobalLogs: excludedSources.length,
    unrelatedSourceLogs: invalidSources.length,
    invalidPoolLogs: invalidPoolLogs.length,
    databaseBytes: databaseBytes.toString(),
    freeDiskBytes: freeBytes.toString(),
    freeDiskPercentBps: freePercentBps.toString(),
    launch: {
      id: String(launch.launch_id),
      token: getAddress(launch.token),
      vault: getAddress(launch.vault),
      market: getAddress(launch.market),
      adapter: getAddress(launch.adapter),
      locker: getAddress(launch.locker),
      poolId: launch.pool_id,
      createdBlock: String(launch.created_block),
    },
    rpcPolicy: {
      activeProvider: status.rpcGateway.activeProvider,
      fallbackTrafficAuthorized: status.rpcGateway.fallbackTrafficAuthorized,
      applicationAndTransactionUpstream: "lan",
      alchemyProbeOnly: true,
    },
  };
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const evidenceName = "schema18-mainnet-scoped-indexer-acceptance.json";
  const evidenceRaw = `${json(evidence)}\n`;
  await writeFile(path.join(outputRoot, evidenceName), evidenceRaw, { mode: 0o600, flag: "wx" });
  await writeFile(path.join(outputRoot, "SHA256SUMS"), `${sha256(evidenceRaw)}  ${evidenceName}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`${json({ passed: true, evidence: path.join(outputRoot, evidenceName), sha256: sha256(evidenceRaw), retainedLogs: retained.length, databaseBytes, freeBytes })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}

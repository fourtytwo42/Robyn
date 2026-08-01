#!/usr/bin/env node
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem";

const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const manifestPath = path.resolve(required("ROBYN_MAINNET_CANARY_MANIFEST"));
const expectedHash = required("ROBYN_MAINNET_CANARY_MANIFEST_SHA256").toLowerCase();
const evidenceRoot = path.resolve(required("ROBYN_MAINNET_CANARY_LIVE_EVIDENCE"));
const rpc = process.env.ROBYN_MAINNET_GATEWAY_RPC_URL ?? "http://127.0.0.1:18549";
const localRehearsal = process.env.ROBYN_MAINNET_CANARY_LOCAL_REHEARSAL === "true";
const samples = process.argv.includes("--once") ? 1 : Number(process.env.ROBYN_CANARY_OBSERVATION_SAMPLES ?? "144");
const intervalMs = Number(process.env.ROBYN_CANARY_OBSERVATION_INTERVAL_MS ?? "600000");
const raw = await readFile(manifestPath, "utf8");
if (createHash("sha256").update(raw).digest("hex") !== expectedHash) throw new Error("observation manifest checksum mismatch");
const manifest = JSON.parse(raw);
if (manifest.chainId !== 4663 || manifest.authorization?.publicModeAuthorized !== false || manifest.authorization?.applicationWritesAuthorized !== false) throw new Error("observation manifest boundary mismatch");
const chain = { id: 4663, name: "Robinhood Chain Mainnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
const client = createPublicClient({ chain, transport: http(rpc, { timeout: 30_000, retryCount: 0 }) });
const contracts = Object.fromEntries(Object.entries(manifest.contracts).map(([name, address]) => [name, getAddress(address)]));
const coordinatorAbi = parseAbi(["function launchMode() view returns (uint8)"]);
const assetAbi = parseAbi([
  "function conversionsPaused() view returns (bool)",
  "function executionRouteStatus(address) view returns (uint8 kind,uint128 maximumNativeInput,uint128 maximumAssetInput,bytes32 disabledReason,bool enabled,bool runtimeVerified,bool ready,bytes32 reason)",
]);
const feeAbi = parseAbi(["function paused() view returns (bool)", "function totalNativeLiabilities() view returns (uint256)"]);
const out = path.join(evidenceRoot, "observation-samples.jsonl");
await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
let lastBlock = 0n;
for (let index = 0; index < samples; index += 1) {
  const started = new Date().toISOString();
  const health = localRehearsal
    ? { status: "ok", activeProvider: "primary", fallbackTrafficAuthorized: false }
    : await fetch(new URL("/health", rpc)).then(async (response) => { if (!response.ok) throw new Error(`gateway health ${response.status}`); return response.json(); });
  const [chainId, syncing, blockNumber, launchMode, assetPaused, feePaused, liabilities, feeBalance, deployerBalance] = await Promise.all([
    client.getChainId(), client.request({ method: "eth_syncing", params: [] }), client.getBlockNumber(),
    client.readContract({ address: contracts.coordinator, abi: coordinatorAbi, functionName: "launchMode" }),
    client.readContract({ address: contracts.assetRouter, abi: assetAbi, functionName: "conversionsPaused" }),
    client.readContract({ address: contracts.feeRouter, abi: feeAbi, functionName: "paused" }),
    client.readContract({ address: contracts.feeRouter, abi: feeAbi, functionName: "totalNativeLiabilities" }),
    client.getBalance({ address: contracts.feeRouter }), client.getBalance({ address: getAddress(manifest.deployer) }),
  ]);
  const routeStates = [];
  for (const route of manifest.constraints.shutdown.routes) routeStates.push({ route, status: await client.readContract({ address: contracts.assetRouter, abi: assetAbi, functionName: "executionRouteStatus", args: [getAddress(route)] }) });
  const runtimeChanges = [];
  for (const identity of manifest.runtimeIdentities) { const code = await client.getCode({ address: getAddress(identity.address) }); const observed = code && code !== "0x" ? keccak256(code).toLowerCase() : null; if (observed !== identity.runtimeCodeHash.toLowerCase()) runtimeChanges.push(identity.name); }
  const failures = [];
  if (chainId !== 4663 || syncing !== false) failures.push("chain");
  if (health.status !== "ok" || health.activeProvider !== "primary" || health.fallbackTrafficAuthorized !== false) failures.push("gateway");
  if (Number(launchMode) !== 0 || !assetPaused || !feePaused) failures.push("paused-state");
  if (routeStates.some((route) => route.status.enabled || route.status.ready || route.status[4] || route.status[6])) failures.push("route-enabled");
  if (liabilities !== feeBalance) failures.push("solvency");
  if (runtimeChanges.length) failures.push("runtime");
  if (index > 0 && blockNumber <= lastBlock) failures.push("head-stalled");
  if (deployerBalance < 20_000_000_000_000_000n) failures.push("reserve");
  const record = { sample: index + 1, sampledAt: started, chainId, syncing, blockNumber, gateway: { status: health.status, activeProvider: health.activeProvider, fallbackTrafficAuthorized: health.fallbackTrafficAuthorized }, launchMode, assetPaused, feePaused, liabilitiesWei: liabilities, feeBalanceWei: feeBalance, deployerBalanceWei: deployerBalance, routeStates, runtimeChanges, failures };
  await appendFile(out, `${JSON.stringify(record, (_, item) => typeof item === "bigint" ? item.toString() : item)}\n`, { mode: 0o600 });
  if (failures.length) { await writeFile(path.join(evidenceRoot, "observation-failure.json"), `${JSON.stringify(record, (_, item) => typeof item === "bigint" ? item.toString() : item, 2)}\n`, { mode: 0o600 }); throw new Error(`canary observation failed: ${failures.join(",")}`); }
  lastBlock = blockNumber;
  if (index + 1 < samples) await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
await writeFile(path.join(evidenceRoot, "observation-result.json"), `${JSON.stringify({ passed: true, completedAt: new Date().toISOString(), samples, intervalMs, manifestSha256: expectedHash }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ passed: true, samples, intervalMs, output: out })}\n`);

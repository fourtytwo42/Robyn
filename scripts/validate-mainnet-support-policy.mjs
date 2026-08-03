import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = resolve(process.env.ROBYN_MAINNET_SUPPORT_POLICY ?? resolve(repoRoot, "config/protocol/robinhood-mainnet-support-policy.json"));
const policy = JSON.parse(await readFile(policyPath, "utf8"));
const failures = [];
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
const unhashed = structuredClone(policy);
unhashed.policyHash = null;
const expectedPolicyHash = createHash("sha256").update(JSON.stringify(canonical(unhashed))).digest("hex");
if (process.argv.includes("--write-hash")) {
  policy.policyHash = expectedPolicyHash;
  await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
} else if (policy.policyHash !== expectedPolicyHash) failures.push(`policyHash mismatch: expected ${expectedPolicyHash}`);
if (policy.schemaVersion !== 18) failures.push("schemaVersion must be 18");
if (policy.chainId !== 4663) failures.push("chainId must be 4663");
if (policy.status !== "qualification-in-progress") failures.push("policy must remain qualification-in-progress before governance");
if (policy.defaultEnabled !== false) failures.push("default activation must fail closed");
if (!/^schema18-assets-v[1-9][0-9]*$/.test(policy.policyVersion ?? "")) failures.push("invalid policyVersion");
const q = policy.qualification ?? {};
const ladder = ["100000000000000", "250000000000000", "500000000000000", "1000000000000000", "2500000000000000", "5000000000000000", "10000000000000000", "25000000000000000", "50000000000000000"];
if (q.architecture !== "v4-single-hop-only") failures.push("only v4 single-hop is supported");
if (JSON.stringify(q.quoteLadderWei) !== JSON.stringify(ladder)) failures.push("quote ladder differs from policy");
if (q.maximumRoundTripLossBps !== 500) failures.push("round-trip loss must remain 5 percent");
if (q.minimumUsefulCapacityWei !== "1000000000000000") failures.push("minimum useful capacity must remain 0.001 ETH");
if (q.syntheticLiquidityAllowed !== false) failures.push("synthetic liquidity must remain prohibited");
const required = new Set(["GOOGL", "MSFT", "NVDA", "SPCX", "SPY", "WETH", "USDG", "AMZN", "INTC", "USAR", "SLV", "GME", "QQQ"]);
const symbols = new Set();
const addresses = new Set();
const pools = new Set();
for (const asset of policy.assets ?? []) {
  if (!asset.symbol || symbols.has(asset.symbol)) failures.push(`duplicate or missing symbol ${asset.symbol}`);
  symbols.add(asset.symbol);
  let address;
  try { address = getAddress(asset.address).toLowerCase(); } catch { failures.push(`${asset.symbol} has invalid canonical address`); }
  if (address && addresses.has(address)) failures.push(`${asset.symbol} reuses an address`);
  if (address) addresses.add(address);
  if (!asset.provenance?.startsWith("robinhood-")) failures.push(`${asset.symbol} lacks Robinhood provenance`);
  if (asset.symbol === "WETH") {
    if (asset.referencePrice?.kind !== "native-parity") failures.push("WETH must use native parity");
    if ((asset.candidatePools ?? []).length) failures.push("WETH must not use a pool");
  } else if (asset.referencePrice?.kind !== "chainlink-usd") failures.push(`${asset.symbol} must use Chainlink USD`);
  try { getAddress(asset.referencePrice?.feedAddress); } catch { failures.push(`${asset.symbol} has invalid feed address`); }
  if (!Number.isInteger(asset.referencePrice?.heartbeatSeconds) || asset.referencePrice.heartbeatSeconds <= 0) failures.push(`${asset.symbol} has invalid heartbeat`);
  for (const pool of asset.candidatePools ?? []) {
    const id = pool.poolId?.toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(id ?? "")) failures.push(`${asset.symbol} has invalid pool id`);
    if (pools.has(id)) failures.push(`${asset.symbol} reuses pool id`);
    pools.add(id);
    try { getAddress(pool.hooks); } catch { failures.push(`${asset.symbol} has invalid hooks`); }
    if (
      !Number.isInteger(pool.fee) || pool.fee <= 0 ||
      !Number.isInteger(pool.tickSpacing) || pool.tickSpacing <= 0
    ) failures.push(`${asset.symbol} has invalid pool parameters`);
    if (String(pool.hooks).toLowerCase() !== "0x0000000000000000000000000000000000000000") {
      failures.push(`${asset.symbol} uses an unsupported hook`);
    }
  }
  if (asset.symbol !== "WETH") {
    if (!(asset.candidatePools ?? []).some((pool) => pool.poolId.toLowerCase() === String(asset.selectedPool).toLowerCase())) {
      failures.push(`${asset.symbol} selected pool is not a candidate`);
    }
    if (!ladder.includes(String(asset.capWei)) || BigInt(asset.capWei ?? 0) < BigInt(q.minimumUsefulCapacityWei)) {
      failures.push(`${asset.symbol} cap is outside the qualified ladder`);
    }
  }
  if (!/^[0-9a-f]{64}$/.test(asset.evidenceHash ?? "")) failures.push(`${asset.symbol} has invalid evidence hash`);
}
for (const symbol of required) if (!symbols.has(symbol)) failures.push(`missing ${symbol}`);
for (const wrapped of policy.provenanceWatchlist ?? []) {
  if (!["WBTC", "WSOL", "WBNB"].includes(wrapped.symbol)) failures.push(`unexpected watchlist symbol ${wrapped.symbol}`);
  if (wrapped.address !== null || wrapped.status !== "unavailable") failures.push(`${wrapped.symbol} must remain unavailable without an address`);
}
if (failures.length) { process.stderr.write(`${failures.join("\n")}\n`); process.exit(1); }
process.stdout.write(`${JSON.stringify({ schemaVersion: 18, chainId: 4663, policyVersion: policy.policyVersion, policyHash: expectedPolicyHash, candidateCount: symbols.size, defaultEnabled: false, passed: true })}\n`);

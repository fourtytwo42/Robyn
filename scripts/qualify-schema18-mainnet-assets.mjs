import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createPublicClient, getAddress, http, keccak256, parseAbi, parseAbiItem } from "viem";

const argv = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]?.startsWith("--") ? true : all[index + 1]] : null).filter(Boolean));
const repo = resolve(dirname(new URL(import.meta.url).pathname), "..");
const policyPath = resolve(argv.policy ?? `${repo}/config/protocol/robinhood-mainnet-support-policy.json`);
const output = resolve(argv.output ?? `${repo}/evidence/schema18-asset-qualification.json`);
const rpcUrl = process.env.ROBYN_LAN_MAINNET_RPC_URL;
if (!rpcUrl || !/^http:\/\/(127\.0\.0\.1|localhost|192\.168\.50\.173)[:/]/.test(rpcUrl)) throw new Error("LAN-only ROBYN_LAN_MAINNET_RPC_URL is required");
if (/alchemy|infura|quicknode/i.test(rpcUrl)) throw new Error("external RPC is forbidden");
const policy = JSON.parse(await readFile(policyPath, "utf8"));
if (policy.schemaVersion !== 18 || policy.chainId !== 4663 || policy.defaultEnabled !== false) throw new Error("invalid Schema-18 policy");
const client = createPublicClient({ transport: http(rpcUrl, { timeout: 30_000 }) });
const chainId = await client.getChainId();
if (chainId !== 4663) throw new Error(`wrong chain ${chainId}`);
const syncing = await client.request({ method: "eth_syncing", params: [] });
if (syncing !== false) throw new Error("LAN RPC is syncing");
const blockNumber = await client.getBlockNumber();
const block = await client.getBlock({ blockNumber });
const initializeEvent = parseAbiItem("event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)");
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
  "function quoteExactOutputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountIn,uint256 gasEstimate)",
]);
const feedAbi = parseAbi(["function decimals() view returns (uint8)", "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function oraclePaused() view returns (bool)"]);
const stateViewAbi = parseAbi(["function getLiquidity(bytes32 poolId) view returns (uint128)", "function getSlot0(bytes32 poolId) view returns (uint160,int24,uint24,uint24)"]);
const stateView = getAddress(process.env.ROBYN_V4_STATE_VIEW ?? "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b");
const poolManager = getAddress(policy.venue.poolManager);
const quoter = getAddress(policy.venue.quoter);
const zero = getAddress(policy.venue.nativeCurrency);
const fromBlock = BigInt(process.env.ROBYN_POOL_DISCOVERY_FROM_BLOCK ?? "20000000");
const chunk = BigInt(process.env.ROBYN_POOL_DISCOVERY_CHUNK ?? "250000");
const safeError = (error) => String(error?.shortMessage ?? error?.message ?? error).slice(0, 500);
const discoveryTargets = new Set(policy.assets.filter((asset) => asset.symbol !== "WETH").map((asset) => getAddress(asset.address).toLowerCase()));
let discoveredByAsset;
async function loadDiscovery() {
  if (discoveredByAsset) return discoveredByAsset;
  discoveredByAsset = new Map([...discoveryTargets].map((address) => [address, []]));
  const ranges = [];
  for (let start = fromBlock; start <= blockNumber; start += chunk + 1n) {
    ranges.push([start, start + chunk > blockNumber ? blockNumber : start + chunk]);
  }
  for (let offset = 0; offset < ranges.length; offset += 6) {
    const pages = await Promise.all(ranges.slice(offset, offset + 6).map(([start, end]) =>
      client.getLogs({
        address: poolManager,
        event: initializeEvent,
        args: {
          currency0: zero,
          currency1: [...discoveryTargets].map((address) => getAddress(address)),
        },
        fromBlock: start,
        toBlock: end,
        strict: true,
      }),
    ));
    for (const page of pages) {
      for (const log of page) {
        const address = getAddress(log.args.currency1).toLowerCase();
        if (!discoveryTargets.has(address)) continue;
        discoveredByAsset.get(address).push({ poolId: log.args.id, fee: Number(log.args.fee), tickSpacing: Number(log.args.tickSpacing), hooks: getAddress(log.args.hooks), initializedAtBlock: Number(log.blockNumber) });
      }
    }
  }
  return discoveredByAsset;
}
async function discover(assetAddress) {
  return (await loadDiscovery()).get(getAddress(assetAddress).toLowerCase()) ?? [];
}
async function quote(functionName, poolKey, zeroForOne, exactAmount) {
  const [amount, gasEstimate] = await client.simulateContract({ address: quoter, abi: quoterAbi, functionName, args: [{ poolKey, zeroForOne, exactAmount, hookData: "0x" }] }).then((result) => result.result);
  return { amount: amount.toString(), gasEstimate: gasEstimate.toString() };
}
async function checkPool(asset, pool) {
  const poolKey = { currency0: zero, currency1: getAddress(asset.address), fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: getAddress(pool.hooks) };
  const state = {};
  try {
    const [liquidity, slot0] = await Promise.all([
      client.readContract({ address: stateView, abi: stateViewAbi, functionName: "getLiquidity", args: [pool.poolId] }),
      client.readContract({ address: stateView, abi: stateViewAbi, functionName: "getSlot0", args: [pool.poolId] }),
    ]);
    state.liquidity = liquidity.toString(); state.sqrtPriceX96 = slot0[0].toString(); state.tick = Number(slot0[1]);
  } catch (error) { state.error = safeError(error); }
  const ladder = [];
  for (const amountText of policy.qualification.quoteLadderWei) {
    const input = BigInt(amountText);
    const result = { nativeInputWei: amountText, passed: false };
    try {
      const buy = await quote("quoteExactInputSingle", poolKey, true, input);
      const sell = await quote("quoteExactInputSingle", poolKey, false, BigInt(buy.amount));
      const exactOutputBuy = await quote("quoteExactOutputSingle", poolKey, true, BigInt(buy.amount) / 2n || 1n);
      const exactOutputSell = await quote("quoteExactOutputSingle", poolKey, false, input / 2n || 1n);
      const recoveryBps = Number((BigInt(sell.amount) * 10_000n) / input);
      Object.assign(result, { buy, sell, exactOutputBuy, exactOutputSell, recoveryBps, lossBps: 10_000 - recoveryBps, passed: recoveryBps >= 10_000 - policy.qualification.maximumRoundTripLossBps });
    } catch (error) { result.failureReason = safeError(error); }
    ladder.push(result);
  }
  const qualifying = ladder.filter((entry) => entry.passed && BigInt(entry.nativeInputWei) >= BigInt(policy.qualification.minimumUsefulCapacityWei));
  return { ...pool, poolKey, state, ladder, readOnlyQualifiedCapWei: qualifying.at(-1)?.nativeInputWei ?? null, readOnlyPassed: qualifying.length > 0 };
}
async function checkFeed(asset) {
  if (asset.referencePrice.kind === "native-parity") return { status: "available", kind: "native-parity", usdPerToken: null };
  try {
    const feed = getAddress(asset.referencePrice.feedAddress);
    const [decimals, round] = await Promise.all([
      client.readContract({ address: feed, abi: feedAbi, functionName: "decimals" }),
      client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" }),
    ]);
    let paused = false;
    if (asset.referencePrice.oraclePausedCheck) {
      try { paused = await client.readContract({ address: getAddress(asset.address), abi: feedAbi, functionName: "oraclePaused" }); } catch { paused = false; }
    }
    const age = Number(block.timestamp - round[3]);
    const valid = round[1] > 0n && round[4] >= round[0] && round[3] > 0n && age <= asset.referencePrice.heartbeatSeconds && !paused;
    return { status: valid ? "available" : "unavailable", feed, decimals: Number(decimals), answer: round[1].toString(), updatedAt: Number(round[3]), ageSeconds: age, heartbeatSeconds: asset.referencePrice.heartbeatSeconds, oraclePaused: paused, failureReason: valid ? null : paused ? "oracle paused" : age > asset.referencePrice.heartbeatSeconds ? "stale feed" : "invalid round" };
  } catch (error) { return { status: "unavailable", failureReason: safeError(error) }; }
}
const assets = [];
for (const asset of policy.assets) {
  const runtime = await client.getCode({ address: getAddress(asset.address), blockNumber });
  const feed = await checkFeed(asset);
  if (asset.symbol === "WETH") { assets.push({ symbol: asset.symbol, address: asset.address, runtimeHash: keccak256(runtime), feed, pools: [], readOnlyPassed: runtime !== "0x", proposedCapWei: asset.capWei }); continue; }
  const discovered = await discover(getAddress(asset.address));
  const merged = [...discovered, ...(asset.candidatePools ?? [])].filter((pool, index, all) => all.findIndex((item) => item.poolId.toLowerCase() === pool.poolId.toLowerCase()) === index);
  const pools = [];
  for (const pool of merged) pools.push(await checkPool(asset, pool));
  const recoveryAtCap = (pool) =>
    pool.ladder.find((entry) => entry.nativeInputWei === pool.readOnlyQualifiedCapWei)?.recoveryBps ?? 0;
  const best =
    pools
      .filter(
        (pool) =>
          pool.readOnlyPassed &&
          pool.fee > 0 &&
          pool.tickSpacing > 0 &&
          getAddress(pool.hooks) === zero,
      )
      .sort((a, b) => {
        const capA = BigInt(a.readOnlyQualifiedCapWei);
        const capB = BigInt(b.readOnlyQualifiedCapWei);
        if (capA !== capB) return capA < capB ? 1 : -1;
        return recoveryAtCap(b) - recoveryAtCap(a);
      })[0] ?? null;
  assets.push({ symbol: asset.symbol, address: asset.address, runtimeHash: runtime === "0x" ? null : keccak256(runtime), feed, pools, readOnlyPassed: runtime !== "0x" && feed.status === "available" && Boolean(best), proposedPool: best?.poolId ?? null, proposedCapWei: best?.readOnlyQualifiedCapWei ?? null, broadcastForkPassed: false });
}
const report = { schemaVersion: 18, executionMode: "lan-read-only-qualification", chainId, policyVersion: policy.policyVersion, policyHash: policy.policyHash, blockNumber: blockNumber.toString(), blockHash: block.hash, checkedAt: new Date().toISOString(), rpcPolicy: { lanOnly: true, alchemyTraffic: false }, qualificationPolicy: policy.qualification, assets, governanceEligible: false, governanceBlockers: ["one-hour sampling incomplete", "broadcast-style exact-state fork round trips incomplete"], reportHash: null };
const hashable = { ...report, reportHash: null };
report.reportHash = createHash("sha256").update(JSON.stringify(hashable)).digest("hex");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ output, reportHash: report.reportHash, blockNumber: report.blockNumber, assets: assets.map(({ symbol, readOnlyPassed, proposedPool, proposedCapWei }) => ({ symbol, readOnlyPassed, proposedPool, proposedCapWei })), governanceEligible: false })}\n`);

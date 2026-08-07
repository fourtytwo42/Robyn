#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseEther,
  stringToHex,
  zeroAddress,
} from "viem";

const [baseManifestArgument, outputArgument] = process.argv.slice(2);
if (!baseManifestArgument || !outputArgument) {
  throw new Error("usage: capture-schema20-network-input.mjs <schema19-application-manifest.json> <output.json>");
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
const toolingSha = git("rev-parse", "HEAD");
if (git("status", "--porcelain") !== "" || git("rev-parse", "@{upstream}") !== toolingSha) {
  throw new Error("Schema-20 input capture requires exact clean pushed tooling");
}
const base = JSON.parse(await readFile(path.resolve(baseManifestArgument), "utf8"));
if (base.schemaVersion !== 19 || ![46630, 4663].includes(base.chainId)) throw new Error("qualified Schema-19 network manifest required");
const rpcUrl = process.env.ROBYN_SCHEMA20_RPC_URL ?? (base.chainId === 4663 ? "http://127.0.0.1:18549" : "http://127.0.0.1:18548");
const parsedRpc = new URL(rpcUrl);
if (!["127.0.0.1", "localhost"].includes(parsedRpc.hostname)) throw new Error("input capture requires loopback LAN gateway");
const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0, timeout: 30_000 }) });
if ((await client.getChainId()) !== base.chainId || (await client.request({ method: "eth_syncing", params: [] })) !== false) {
  throw new Error("input capture RPC is wrong-chain or syncing");
}
const gateway = await fetch(new URL("/health", rpcUrl)).then(async (response) => {
  if (!response.ok) throw new Error(`gateway health ${response.status}`);
  return response.json();
});
if (gateway.status !== "ok" || gateway.activeProvider !== "primary" || gateway.providerSelection !== "operator" || gateway.fallbackTrafficAuthorized !== false) {
  throw new Error("input capture gateway is not healthy LAN-only");
}
const deployer = getAddress(base.deployer);
const guardianSafe = getAddress(base.guardianSafe ?? base.contracts.guardian);
const daoToken = getAddress(base.contracts.daoToken);
const timelock = getAddress(base.contracts.timelock);
const governor = getAddress(base.contracts.governor);
const create2Deployer = getAddress("0x4e59b44847b379578588920cA78FbF26c0B4956C");
const external = {
  create2Deployer,
  poolManager: getAddress(base.contracts.poolManager),
  positionManager: getAddress(base.contracts.positionManager),
  quoter: getAddress(base.contracts.quoter),
  stateView: getAddress(base.contracts.stateView),
  permit2: getAddress(base.contracts.permit2),
  universalRouter: getAddress(base.contracts.universalRouter),
  wrappedNative: getAddress(base.contracts.wrappedNative),
};
const runtimeAddresses = { guardianSafe, daoToken, timelock, governor, ...external };
const reusedRuntimeCodeHashes = {};
for (const [role, address] of Object.entries(runtimeAddresses)) {
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error(`missing reused runtime ${role}`);
  reusedRuntimeCodeHashes[role] = keccak256(code);
}
const erc20Abi = parseAbi(["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"]);
const [totalSupply, deployerRdao] = await Promise.all([
  client.readContract({ address: daoToken, abi: erc20Abi, functionName: "totalSupply" }),
  client.readContract({ address: daoToken, abi: erc20Abi, functionName: "balanceOf", args: [deployer] }),
]);
if (totalSupply !== parseEther("1000000000") || deployerRdao !== totalSupply) {
  throw new Error("Schema-20 replacement requires deployer custody of the exact fixed RDAO supply");
}
const sourceRoutes = base.assetRoutes;
if (!Array.isArray(sourceRoutes) || sourceRoutes.length < 6) throw new Error("qualified route definitions missing");
const mapSourceRoutes = () => sourceRoutes.map((route) => {
  const enabled = true;
  if (route.kind === "wrapped-native") {
    return {
      symbol: route.symbol,
      asset: getAddress(route.address),
      kind: route.kind,
      enabled,
      maximumNativeInput: String(route.maximumNativeInput),
    };
  }
  const maximumReferenceTickDeviation = base.chainId === 4663
    ? Number(route.maximumReferenceTickDeviation ?? 0)
    : 0;
  return {
    symbol: route.symbol,
    asset: getAddress(route.address),
    kind: route.kind,
    enabled,
    fee: Number(route.fee),
    tickSpacing: Number(route.tickSpacing),
    hooks: getAddress(route.hooks ?? zeroAddress),
    minimumLiquidity: String(route.minimumLiquidity),
    maximumNativeInput: String(route.maximumNativeInput),
    referenceTick: base.chainId === 4663 ? Number(route.referenceTick ?? 0) : 0,
    maximumReferenceTickDeviation,
    enforceReferencePrice: maximumReferenceTickDeviation > 0,
    verificationClass: route.verificationClass,
  };
});
let routes = null;
let sale;
let saleOracleEvidence = null;
let ethUsdReference = null;
if (base.chainId === 4663) {
  const wethCatalog = base.assetCatalog?.assets?.find((asset) => getAddress(asset.address) === external.wrappedNative);
  const feedAddress = getAddress(wethCatalog?.referencePrice?.feedAddress);
  const heartbeat = Number(wethCatalog?.referencePrice?.heartbeatSeconds);
  const feedAbi = parseAbi([
    "function decimals() view returns (uint8)",
    "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  ]);
  const [decimals, round] = await Promise.all([
    client.readContract({ address: feedAddress, abi: feedAbi, functionName: "decimals" }),
    client.readContract({ address: feedAddress, abi: feedAbi, functionName: "latestRoundData" }),
  ]);
  const [roundId, answer, , updatedAt, answeredInRound] = round;
  const latestBlock = await client.getBlock({ blockTag: "latest" });
  if (answer <= 0n || updatedAt === 0n || answeredInRound < roundId || Number(latestBlock.timestamp - updatedAt) > heartbeat) {
    throw new Error("fresh completed Chainlink ETH/USD round required");
  }
  const scale = 10n ** BigInt(decimals);
  const payout = (300_000n * scale * 10n ** 18n) / answer;
  const liquidity = (240_000n * scale * 10n ** 18n) / answer;
  let dust = 0n;
  while (((payout + liquidity + dust) * 4n) / 9n !== liquidity && dust < 100n) dust += 1n;
  if (dust === 100n) throw new Error("unable to reconcile frozen sale price continuity");
  const principal = payout + liquidity + dust;
  sale = {
    saleInventory: parseEther("150000000").toString(),
    liquidityInventory: parseEther("50000000").toString(),
    retainedStake: parseEther("800000000").toString(),
    virtualTokenReserve: parseEther("600000000").toString(),
    virtualNativeReserve: (principal * 3n).toString(),
    curvePrincipalTarget: principal.toString(),
    deployerPayout: payout.toString(),
    liquidityNative: liquidity.toString(),
    dustWei: dust.toString(),
    maximumWethResidual: "1000000",
    maximumRdaoResidual: "1000000",
  };
  saleOracleEvidence = {
    feedAddress,
    roundId: roundId.toString(),
    answer: answer.toString(),
    decimals: Number(decimals),
    updatedAt: updatedAt.toString(),
    heartbeatSeconds: heartbeat,
    capturedBlock: latestBlock.number.toString(),
    capturedBlockTimestamp: latestBlock.timestamp.toString(),
    ownerTargetUsd: "300000",
    liquidityTargetUsd: "240000",
  };
  ethUsdReference = { feedAddress, decimals: Number(decimals), roundId, answer, updatedAt, heartbeat, latestBlock };
} else {
  const payout = parseEther("0.002");
  const liquidity = parseEther("0.0016");
  const principal = payout + liquidity;
  sale = {
    saleInventory: parseEther("150000000").toString(),
    liquidityInventory: parseEther("50000000").toString(),
    retainedStake: parseEther("800000000").toString(),
    virtualTokenReserve: parseEther("600000000").toString(),
    virtualNativeReserve: (principal * 3n).toString(),
    curvePrincipalTarget: principal.toString(),
    deployerPayout: payout.toString(),
    liquidityNative: liquidity.toString(),
    dustWei: "0",
    maximumWethResidual: "1000000",
    maximumRdaoResidual: "1000000",
  };
  saleOracleEvidence = { kind: "accelerated-testnet-fixture", ownerTargetWei: payout.toString(), liquidityTargetWei: liquidity.toString() };
}
if (base.chainId === 4663) {
  const stateViewAbi = parseAbi([
    "function getLiquidity(bytes32 poolId) view returns (uint128)",
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  ]);
  const quoterAbi = parseAbi([
    "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
    "function quoteExactOutputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountIn,uint256 gasEstimate)",
  ]);
  const feedAbi = parseAbi([
    "function decimals() view returns (uint8)",
    "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  ]);
  const pauseAbi = parseAbi(["function oraclePaused() view returns (bool)"]);
  const quote = async (functionName, poolKey, zeroForOne, exactAmount) => {
    const simulation = await client.simulateContract({
      address: external.quoter,
      abi: quoterAbi,
      functionName,
      args: [{ poolKey, zeroForOne, exactAmount, hookData: "0x" }],
    });
    return simulation.result;
  };
  const catalogByAddress = new Map(
    (base.assetCatalog?.assets ?? []).map((asset) => [getAddress(asset.address).toLowerCase(), asset]),
  );
  const ladder = [
    100_000_000_000_000n,
    250_000_000_000_000n,
    500_000_000_000_000n,
    1_000_000_000_000_000n,
    2_500_000_000_000_000n,
    5_000_000_000_000_000n,
    10_000_000_000_000_000n,
    25_000_000_000_000_000n,
    50_000_000_000_000_000n,
  ];
  routes = [];
  for (const sourceRoute of sourceRoutes) {
    const asset = getAddress(sourceRoute.address);
    if (sourceRoute.kind === "wrapped-native") {
      if (asset !== external.wrappedNative) throw new Error("Mainnet wrapped-native route is not canonical WETH");
      routes.push({
        symbol: sourceRoute.symbol,
        asset,
        kind: sourceRoute.kind,
        enabled: true,
        maximumNativeInput: String(sourceRoute.maximumNativeInput),
      });
      continue;
    }
    const catalog = catalogByAddress.get(asset.toLowerCase());
    if (!catalog?.pool || catalog.route?.kind !== "uniswap-v4") {
      throw new Error(`missing canonical Mainnet catalog pool for ${sourceRoute.symbol}`);
    }
    const poolKey = {
      currency0: zeroAddress,
      currency1: asset,
      fee: Number(sourceRoute.fee),
      tickSpacing: Number(sourceRoute.tickSpacing),
      hooks: getAddress(sourceRoute.hooks ?? zeroAddress),
    };
    const poolId = keccak256(encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
    ));
    if (poolId.toLowerCase() !== String(catalog.pool.poolId).toLowerCase()) {
      throw new Error(`Mainnet pool identity mismatch for ${sourceRoute.symbol}`);
    }
    const feedAddress = getAddress(catalog.referencePrice?.feedAddress);
    const heartbeat = Number(catalog.referencePrice?.heartbeatSeconds);
    const [liquidity, slot0, feedDecimals, feedRound, assetCode, oraclePaused] = await Promise.all([
      client.readContract({ address: external.stateView, abi: stateViewAbi, functionName: "getLiquidity", args: [poolId] }),
      client.readContract({ address: external.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [poolId] }),
      client.readContract({ address: feedAddress, abi: feedAbi, functionName: "decimals" }),
      client.readContract({ address: feedAddress, abi: feedAbi, functionName: "latestRoundData" }),
      client.getCode({ address: asset }),
      catalog.referencePrice?.oraclePauseCheck || catalog.referencePrice?.oraclePausedCheck
        ? client.readContract({ address: asset, abi: pauseAbi, functionName: "oraclePaused" })
        : false,
    ]);
    const [feedRoundId, feedAnswer, , feedUpdatedAt, feedAnsweredInRound] = feedRound;
    const feedAgeSeconds = Number(ethUsdReference.latestBlock.timestamp - feedUpdatedAt);
    if (!assetCode || assetCode === "0x" || liquidity === 0n || slot0[0] === 0n) {
      throw new Error(`missing Mainnet route runtime or liquidity for ${sourceRoute.symbol}`);
    }
    if (feedAnswer <= 0n || feedUpdatedAt === 0n || feedAnsweredInRound < feedRoundId || feedAgeSeconds > heartbeat || oraclePaused) {
      throw new Error(`unhealthy Mainnet Chainlink reference for ${sourceRoute.symbol}`);
    }
    const ethUsd = Number(ethUsdReference.answer) / (10 ** ethUsdReference.decimals);
    const assetUsd = Number(feedAnswer) / (10 ** Number(feedDecimals));
    const referenceTick = Math.round(Math.log(ethUsd / assetUsd) / Math.log(1.0001));
    const spotTick = Number(slot0[1]);
    const maximumReferenceTickDeviation = Number(sourceRoute.maximumReferenceTickDeviation ?? 198);
    if (!Number.isSafeInteger(referenceTick) || Math.abs(spotTick - referenceTick) > maximumReferenceTickDeviation) {
      throw new Error(`Mainnet pool/reference deviation is unsafe for ${sourceRoute.symbol}: spot=${spotTick} reference=${referenceTick}`);
    }
    const maximumCandidate = BigInt(sourceRoute.maximumNativeInput);
    const ladderResults = [];
    for (const amount of ladder.filter((entry) => entry <= maximumCandidate)) {
      try {
        const [buyOutput] = await quote("quoteExactInputSingle", poolKey, true, amount);
        const [roundTripOutput] = await quote("quoteExactInputSingle", poolKey, false, buyOutput);
        const [assetForExactNative] = await quote("quoteExactOutputSingle", poolKey, false, amount / 2n);
        await quote("quoteExactOutputSingle", poolKey, true, buyOutput / 2n || 1n);
        ladderResults.push({
          amount,
          buyOutput,
          roundTripOutput,
          assetForExactNative,
          recoveryBps: Number((roundTripOutput * 10_000n) / amount),
          passed: true,
        });
      } catch (error) {
        ladderResults.push({
          amount,
          passed: false,
          failureReason: String(error?.shortMessage ?? error?.message ?? error).slice(0, 300),
        });
      }
    }
    const selected = ladderResults
      .filter((entry) => entry.passed && entry.amount >= 1_000_000_000_000_000n && entry.recoveryBps >= 9_500)
      .at(-1);
    if (!selected) {
      throw new Error(`no safe >=0.001 ETH Mainnet quote capacity for ${sourceRoute.symbol}: ${JSON.stringify(ladderResults.map((entry) => ({ amountWei: entry.amount.toString(), recoveryBps: entry.recoveryBps ?? null, failureReason: entry.failureReason ?? null })))}`);
    }
    const minimumLiquidity = liquidity / 2n;
    if (minimumLiquidity === 0n) throw new Error(`zero Mainnet emergency liquidity floor for ${sourceRoute.symbol}`);
    routes.push({
      symbol: sourceRoute.symbol,
      asset,
      kind: sourceRoute.kind,
      enabled: true,
      poolId,
      fee: poolKey.fee,
      tickSpacing: poolKey.tickSpacing,
      hooks: poolKey.hooks,
      minimumLiquidity: minimumLiquidity.toString(),
      maximumNativeInput: selected.amount.toString(),
      referenceTick,
      maximumReferenceTickDeviation,
      enforceReferencePrice: true,
      verificationClass: sourceRoute.verificationClass,
      liveQualification: {
        capturedBlock: ethUsdReference.latestBlock.number.toString(),
        capturedBlockTimestamp: ethUsdReference.latestBlock.timestamp.toString(),
        observedLiquidity: liquidity.toString(),
        minimumLiquidity: minimumLiquidity.toString(),
        liquidityFloorBps: 5_000,
        spotTick,
        referenceTick,
        referenceDeviationTicks: Math.abs(spotTick - referenceTick),
        assetUsdFeed: feedAddress,
        assetUsdRoundId: feedRoundId.toString(),
        assetUsdAnswer: feedAnswer.toString(),
        assetUsdDecimals: Number(feedDecimals),
        assetUsdUpdatedAt: feedUpdatedAt.toString(),
        assetUsdAgeSeconds: feedAgeSeconds,
        oraclePaused: Boolean(oraclePaused),
        ethUsdFeed: ethUsdReference.feedAddress,
        ethUsdRoundId: ethUsdReference.roundId.toString(),
        selectedCapWei: selected.amount.toString(),
        selectedRecoveryBps: selected.recoveryBps,
        exactInputBothDirections: true,
        exactOutputBothDirections: true,
        quoteLadder: ladderResults.map((entry) => ({
          amountWei: entry.amount.toString(),
          buyOutput: entry.buyOutput?.toString() ?? null,
          roundTripOutput: entry.roundTripOutput?.toString() ?? null,
          recoveryBps: entry.recoveryBps ?? null,
          passed: Boolean(entry.passed && (entry.recoveryBps ?? 0) >= 9_500),
          failureReason: entry.failureReason ?? null,
        })),
      },
    });
  }
} else {
  routes = mapSourceRoutes();
}
const settings = base.chainId === 4663
  ? {
      rewardDuration: 3600, failureObservationSpacing: 86400, fallbackDelay: 259200,
      targetGraduationNative: parseEther("6").toString(), maximumCurvePurchase: parseEther("0.5").toString(),
      maximumGraduatedPurchase: parseEther("0.5").toString(), minimumTradeNative: parseEther("0.000001").toString(),
      stakingWarmup: 86400, stakingRewardDuration: 3600, zeroSupplyRewardDuration: 604800,
      maintenanceTaskGas: 2000000, maintenanceCallGas: 2050000,
    }
  : {
      rewardDuration: 600, failureObservationSpacing: 60, fallbackDelay: 180,
      targetGraduationNative: parseEther("0.01").toString(), maximumCurvePurchase: parseEther("0.001").toString(),
      maximumGraduatedPurchase: parseEther("0.001").toString(), minimumTradeNative: "1000000000000",
      stakingWarmup: 600, stakingRewardDuration: 600, zeroSupplyRewardDuration: 3600,
      maintenanceTaskGas: 2000000, maintenanceCallGas: 2050000,
    };
const assetCatalog = base.assetCatalog ?? {
  version: 1,
  assets: routes.map((route) => ({
    address: route.asset,
    symbol: route.symbol,
    name: `Testnet ${route.symbol}`,
    category: route.kind === "wrapped-native" ? "crypto" : "stock",
    chainId: base.chainId,
    decimals: 18,
    mock: true,
    mockOnly: true,
    network: "robinhood-testnet",
    verification: "schema20-testnet-fixture",
    route: { kind: route.kind, ready: true },
    disclosure: "Testnet fixture with no real-world value or redemption rights.",
  })),
};
const input = {
  schemaVersion: 20,
  chainId: base.chainId,
  contractReleaseSha: "dd7afcfaad41a8c7054b3e9b581bfd4029e88e60",
  toolingSha,
  deployer,
  guardianSafe,
  daoToken,
  timelock,
  governor,
  startingNonce: await client.getTransactionCount({ address: deployer, blockTag: "pending" }),
  hookDomain: keccak256(stringToHex(base.chainId === 4663 ? "SCHEMA20_MAINNET_PUBLIC" : "SCHEMA20_TESTNET_PUBLIC")),
  external,
  reusedRuntimeCodeHashes,
  settings,
  sale,
  saleOracleEvidence,
  routes,
  assetCatalog,
  sourceSchema19Manifest: path.resolve(baseManifestArgument),
  sourceSchema19ManifestSha256: createHash("sha256").update(JSON.stringify(base)).digest("hex"),
  capturedAt: new Date().toISOString(),
  rpcPolicy: { primary: "lan", gateway: rpcUrl, alchemy: "probe-only", fallbackTrafficAuthorized: false },
};
await writeFile(path.resolve(outputArgument), `${JSON.stringify(input, null, 2)}\n`, { mode: 0o600, flag: "wx" });
process.stdout.write(`${JSON.stringify({ output: path.resolve(outputArgument), chainId: input.chainId, startingNonce: input.startingNonce, routes: input.routes.map((route) => route.symbol), sale: input.sale, saleOracleEvidence: input.saleOracleEvidence })}\n`);

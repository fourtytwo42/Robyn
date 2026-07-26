import {
  decodeEventLog,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

const tokenEvents = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const marketEvents = parseAbi([
  "event LiquiditySeeded(address indexed provider,uint256 tokenAmount,uint256 baseAmount)",
  "event LiquiditySeeded(address indexed provider,uint256 tokenAmount)",
  "event Bought(address indexed buyer,uint256 baseInput,uint256 feeAmount,uint256 tokenOutput)",
  "event Sold(address indexed seller,uint256 tokenInput,uint256 feeAmount,uint256 baseOutput)",
  "event Graduated(address indexed pool,uint256 tokenLiquidity,uint256 baseLiquidity,uint256 finalCurvePrice)",
  "event Graduated(address indexed pool,address indexed locker,uint256 indexed positionTokenId,uint256 tokenLiquidity,uint256 baseLiquidity,uint256 finalCurvePrice)",
  "event Graduated(bytes32 indexed poolId,address indexed locker,uint256 indexed positionTokenId,uint256 tokenLiquidity,uint256 nativeLiquidity,uint256 finalCurvePrice)",
]);
const poolEvents = parseAbi([
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
]);
const v4PoolEvents = parseAbi([
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
]);

export type AnalyticsLog = {
  block_number: string;
  transaction_hash: Hex;
  log_index: number;
  address: Address;
  topics: Hex[];
  data: Hex;
  timestamp: string | null;
};

type LaunchIdentity = {
  token: Address;
  market: Address;
  creator: Address;
  baseAsset?: Address;
  liquidityPool?: Address;
  poolManager?: Address;
  poolId?: Hex;
};

export function analyticsLogAddresses(
  launch: Pick<
    LaunchIdentity,
    "token" | "market" | "liquidityPool" | "poolManager"
  >,
) {
  return [
    launch.token.toLowerCase(),
    launch.market.toLowerCase(),
    ...(launch.liquidityPool ? [launch.liquidityPool.toLowerCase()] : []),
    ...(launch.poolManager ? [launch.poolManager.toLowerCase()] : []),
  ] as Address[];
}

function addBalance(
  balances: Map<string, bigint>,
  address: Address,
  delta: bigint,
) {
  const key = address.toLowerCase();
  balances.set(key, (balances.get(key) ?? 0n) + delta);
}

function isoTime(timestamp: string | null) {
  return timestamp
    ? new Date(Number(BigInt(timestamp)) * 1000).toISOString()
    : null;
}

export function collectTokenAccounts(
  logs: AnalyticsLog[],
  tokenAddress: Address,
) {
  const accounts = new Set<string>();
  for (const log of logs) {
    if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: tokenEvents,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "Transfer") continue;
      if (decoded.args.from.toLowerCase() !== zeroAddress)
        accounts.add(decoded.args.from.toLowerCase());
      if (decoded.args.to.toLowerCase() !== zeroAddress)
        accounts.add(decoded.args.to.toLowerCase());
    } catch {
      continue;
    }
  }
  return accounts;
}

export function deriveLaunchAnalytics({
  launch,
  logs,
  createdTimestamp,
  basePerToken,
  feeBps,
  initialSupply,
  reserveSnapshot,
  snapshot,
  lifecycle,
  nowMs = Date.now(),
}: {
  launch: LaunchIdentity;
  logs: AnalyticsLog[];
  createdTimestamp: string | null;
  basePerToken: bigint;
  feeBps: number;
  initialSupply?: bigint;
  reserveSnapshot?: {
    tokenReserve: bigint;
    baseReserve: bigint;
  };
  lifecycle?: {
    marketPhase: "legacy_fixed" | "bonding" | "graduated";
    graduationProgressBps: number;
    graduationThresholdBase: bigint;
    baseRaised: bigint;
    remainingCurveTokens: bigint;
    graduatedPool: Address | null;
    liquidityVenue?: "uniswap-v4" | "uniswap-v3" | "devnet-locked-pool" | null;
    poolManager?: Address | null;
    poolId?: Hex | null;
    hook?: Address | null;
    positionLocker?: Address | null;
    positionTokenId?: bigint | null;
    poolFeePips?: number | null;
    protocolFeeBps?: number;
    lpFeeBps?: number;
  };
  snapshot?: {
    totalSupply: bigint;
    tokenReserve: bigint;
    baseReserve: bigint;
    balances: Map<string, bigint>;
  };
  nowMs?: number;
}) {
  const token = launch.token.toLowerCase();
  const market = launch.market.toLowerCase();
  const creator = launch.creator.toLowerCase();
  const liquidityPool = launch.liquidityPool?.toLowerCase();
  const poolManager = launch.poolManager?.toLowerCase();
  const launchPoolId = launch.poolId?.toLowerCase();
  const baseAsset = launch.baseAsset?.toLowerCase();
  const positionLocker = lifecycle?.positionLocker?.toLowerCase();
  const poolFeePips = lifecycle?.poolFeePips ?? feeBps * 100;
  const balances = new Map<string, bigint>();
  const traders = new Set<string>();
  const trades: Array<{
    side: "buy" | "sell";
    trader: Address;
    baseAmount: string;
    tokenAmount: string;
    feeAmount: string;
    blockNumber: string;
    timestamp: string | null;
    transactionHash: Hex;
    price: string;
  }> = [];
  let totalSupply = initialSupply ?? 0n;
  let tokenReserve = 0n;
  let baseReserve = 0n;
  let totalVolume = 0n;
  let buyVolume = 0n;
  let sellVolume = 0n;
  let totalFees = 0n;
  let cumulativeVolume = 0n;
  const chart: Array<{
    blockNumber: string;
    timestamp: string | null;
    price: string;
    cumulativeVolume: string;
    eventType: "launch" | "trade" | "graduation";
    side: "buy" | "sell" | null;
    baseAmount: string;
    transactionHash: Hex | null;
    logIndex: number;
  }> = [
    {
      blockNumber: "0",
      timestamp: isoTime(createdTimestamp),
      price: basePerToken.toString(),
      cumulativeVolume: "0",
      eventType: "launch",
      side: null,
      baseAmount: "0",
      transactionHash: null,
      logIndex: 0,
    },
  ];
  let graduationBlock: string | null = null;
  let graduationTimestamp: string | null = null;
  const marketTradeTransactions = new Set<string>();

  for (const log of logs) {
    if (log.address.toLowerCase() !== market) continue;
    try {
      const decoded = decodeEventLog({
        abi: marketEvents,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName === "Bought" || decoded.eventName === "Sold") {
        marketTradeTransactions.add(log.transaction_hash.toLowerCase());
      }
    } catch {
      continue;
    }
  }

  if (initialSupply) addBalance(balances, launch.creator, initialSupply);

  for (const log of logs) {
    if (log.address.toLowerCase() === token) {
      try {
        const decoded = decodeEventLog({
          abi: tokenEvents,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
        if (decoded.eventName !== "Transfer") continue;
        const { from, to, value } = decoded.args;
        if (from.toLowerCase() === zeroAddress) totalSupply += value;
        else addBalance(balances, from, -value);
        if (to.toLowerCase() === zeroAddress) totalSupply -= value;
        else addBalance(balances, to, value);
      } catch {
        continue;
      }
      continue;
    }
    if (
      liquidityPool &&
      baseAsset &&
      log.address.toLowerCase() === liquidityPool &&
      !marketTradeTransactions.has(log.transaction_hash.toLowerCase())
    ) {
      try {
        const decoded = decodeEventLog({
          abi: poolEvents,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
        if (decoded.eventName !== "Swap") continue;
        const baseIsToken0 = baseAsset < token;
        const baseDelta = baseIsToken0
          ? decoded.args.amount0
          : decoded.args.amount1;
        const tokenDelta = baseIsToken0
          ? decoded.args.amount1
          : decoded.args.amount0;
        const isBuy = baseDelta > 0n && tokenDelta < 0n;
        const isSell = tokenDelta > 0n && baseDelta < 0n;
        if (!isBuy && !isSell) continue;
        const baseOutputOrInput = baseDelta > 0n ? baseDelta : -baseDelta;
        const tokenOutputOrInput = tokenDelta > 0n ? tokenDelta : -tokenDelta;
        const feeAmount = isBuy
          ? (baseOutputOrInput * BigInt(poolFeePips)) / 1_000_000n
          : (baseOutputOrInput * BigInt(poolFeePips)) /
            BigInt(1_000_000 - poolFeePips);
        const baseVolume = isBuy
          ? baseOutputOrInput
          : baseOutputOrInput + feeAmount;
        const executionPrice = isBuy
          ? ((baseOutputOrInput - feeAmount) * 10n ** 18n) / tokenOutputOrInput
          : (baseOutputOrInput * 10n ** 18n) / tokenOutputOrInput;
        if (isBuy) {
          tokenReserve -= tokenOutputOrInput;
          baseReserve += baseOutputOrInput - feeAmount;
          buyVolume += baseVolume;
        } else {
          tokenReserve += tokenOutputOrInput;
          baseReserve -= baseOutputOrInput;
          sellVolume += baseVolume;
        }
        totalVolume += baseVolume;
        totalFees += feeAmount;
        cumulativeVolume += baseVolume;
        traders.add(decoded.args.recipient.toLowerCase());
        trades.push({
          side: isBuy ? "buy" : "sell",
          trader: decoded.args.recipient,
          baseAmount: baseVolume.toString(),
          tokenAmount: tokenOutputOrInput.toString(),
          feeAmount: feeAmount.toString(),
          blockNumber: log.block_number,
          timestamp: isoTime(log.timestamp),
          transactionHash: log.transaction_hash,
          price: executionPrice.toString(),
        });
        chart.push({
          blockNumber: log.block_number,
          timestamp: isoTime(log.timestamp),
          price: executionPrice.toString(),
          cumulativeVolume: cumulativeVolume.toString(),
          eventType: "trade",
          side: isBuy ? "buy" : "sell",
          baseAmount: baseVolume.toString(),
          transactionHash: log.transaction_hash,
          logIndex: log.log_index,
        });
      } catch {
        continue;
      }
      continue;
    }
    if (
      poolManager &&
      launchPoolId &&
      log.address.toLowerCase() === poolManager &&
      !marketTradeTransactions.has(log.transaction_hash.toLowerCase())
    ) {
      try {
        const decoded = decodeEventLog({
          abi: v4PoolEvents,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
        if (
          decoded.eventName !== "Swap" ||
          decoded.args.id.toLowerCase() !== launchPoolId
        )
          continue;
        const nativeDelta = decoded.args.amount0;
        const tokenDelta = decoded.args.amount1;
        const isBuy = nativeDelta > 0n && tokenDelta < 0n;
        const isSell = tokenDelta > 0n && nativeDelta < 0n;
        if (!isBuy && !isSell) continue;
        const nativeAmount = nativeDelta > 0n ? nativeDelta : -nativeDelta;
        const tokenAmount = tokenDelta > 0n ? tokenDelta : -tokenDelta;
        const feeAmount = isBuy
          ? (nativeAmount * BigInt(poolFeePips)) / 1_000_000n
          : (nativeAmount * BigInt(poolFeePips)) /
            BigInt(1_000_000 - poolFeePips);
        const baseVolume = isBuy ? nativeAmount : nativeAmount + feeAmount;
        const executionPrice = isBuy
          ? ((nativeAmount - feeAmount) * 10n ** 18n) / tokenAmount
          : (nativeAmount * 10n ** 18n) / tokenAmount;
        if (isBuy) buyVolume += baseVolume;
        else sellVolume += baseVolume;
        totalVolume += baseVolume;
        totalFees += feeAmount;
        cumulativeVolume += baseVolume;
        traders.add(decoded.args.sender.toLowerCase());
        trades.push({
          side: isBuy ? "buy" : "sell",
          trader: decoded.args.sender,
          baseAmount: baseVolume.toString(),
          tokenAmount: tokenAmount.toString(),
          feeAmount: feeAmount.toString(),
          blockNumber: log.block_number,
          timestamp: isoTime(log.timestamp),
          transactionHash: log.transaction_hash,
          price: executionPrice.toString(),
        });
        chart.push({
          blockNumber: log.block_number,
          timestamp: isoTime(log.timestamp),
          price: executionPrice.toString(),
          cumulativeVolume: cumulativeVolume.toString(),
          eventType: "trade",
          side: isBuy ? "buy" : "sell",
          baseAmount: baseVolume.toString(),
          transactionHash: log.transaction_hash,
          logIndex: log.log_index,
        });
      } catch {
        continue;
      }
      continue;
    }
    if (log.address.toLowerCase() !== market) continue;
    try {
      const decoded = decodeEventLog({
        abi: marketEvents,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName === "LiquiditySeeded") {
        tokenReserve += decoded.args.tokenAmount;
        if ("baseAmount" in decoded.args)
          baseReserve += decoded.args.baseAmount;
        continue;
      }
      if (decoded.eventName === "Graduated") {
        graduationBlock = log.block_number;
        graduationTimestamp = isoTime(log.timestamp);
        chart.push({
          blockNumber: log.block_number,
          timestamp: graduationTimestamp,
          price: decoded.args.finalCurvePrice.toString(),
          cumulativeVolume: cumulativeVolume.toString(),
          eventType: "graduation",
          side: null,
          baseAmount: "0",
          transactionHash: log.transaction_hash,
          logIndex: log.log_index,
        });
        continue;
      }
      let executionPrice: bigint;
      if (decoded.eventName === "Bought") {
        const { buyer, baseInput, feeAmount, tokenOutput } = decoded.args;
        tokenReserve -= tokenOutput;
        baseReserve += baseInput - feeAmount;
        buyVolume += baseInput;
        totalVolume += baseInput;
        totalFees += feeAmount;
        cumulativeVolume += baseInput;
        traders.add(buyer.toLowerCase());
        executionPrice = ((baseInput - feeAmount) * 10n ** 18n) / tokenOutput;
        trades.push({
          side: "buy",
          trader: buyer,
          baseAmount: baseInput.toString(),
          tokenAmount: tokenOutput.toString(),
          feeAmount: feeAmount.toString(),
          blockNumber: log.block_number,
          timestamp: isoTime(log.timestamp),
          transactionHash: log.transaction_hash,
          price: executionPrice.toString(),
        });
      } else if (decoded.eventName === "Sold") {
        const { seller, tokenInput, feeAmount, baseOutput } = decoded.args;
        const grossBase = baseOutput + feeAmount;
        tokenReserve += tokenInput;
        baseReserve -= grossBase;
        sellVolume += grossBase;
        totalVolume += grossBase;
        totalFees += feeAmount;
        cumulativeVolume += grossBase;
        traders.add(seller.toLowerCase());
        executionPrice = (baseOutput * 10n ** 18n) / tokenInput;
        trades.push({
          side: "sell",
          trader: seller,
          baseAmount: grossBase.toString(),
          tokenAmount: tokenInput.toString(),
          feeAmount: feeAmount.toString(),
          blockNumber: log.block_number,
          timestamp: isoTime(log.timestamp),
          transactionHash: log.transaction_hash,
          price: executionPrice.toString(),
        });
      } else {
        continue;
      }
      chart.push({
        blockNumber: log.block_number,
        timestamp: isoTime(log.timestamp),
        price: executionPrice.toString(),
        cumulativeVolume: cumulativeVolume.toString(),
        eventType: "trade",
        side: decoded.eventName === "Bought" ? "buy" : "sell",
        baseAmount: trades.at(-1)?.baseAmount ?? "0",
        transactionHash: log.transaction_hash,
        logIndex: log.log_index,
      });
    } catch {
      continue;
    }
  }

  if (reserveSnapshot) {
    tokenReserve = reserveSnapshot.tokenReserve;
    baseReserve = reserveSnapshot.baseReserve;
  }

  if (snapshot) {
    totalSupply = snapshot.totalSupply;
    tokenReserve = snapshot.tokenReserve;
    baseReserve = snapshot.baseReserve;
    balances.clear();
    for (const [address, balance] of snapshot.balances) {
      balances.set(address.toLowerCase(), balance);
    }
  }

  const positiveBalances = [...balances.entries()]
    .filter(([, balance]) => balance > 0n)
    .sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1));
  const holders = positiveBalances.filter(
    ([address]) =>
      address !== market &&
      address !== liquidityPool &&
      address !== positionLocker,
  );
  const circulatingSupply =
    totalSupply -
    (balances.get(market) ?? 0n) -
    (liquidityPool ? (balances.get(liquidityPool) ?? 0n) : 0n) -
    (positionLocker ? (balances.get(positionLocker) ?? 0n) : 0n);
  const marketCapBase = (totalSupply * basePerToken) / 10n ** 18n;
  const liquidityBase =
    baseReserve + (tokenReserve * basePerToken) / 10n ** 18n;
  const firstTradePrice = chart[1] ? BigInt(chart[1].price) : basePerToken;
  const priceChangeBps =
    firstTradePrice === 0n
      ? 0
      : Number(((basePerToken - firstTradePrice) * 10_000n) / firstTradePrice);

  const windowMetrics = (windowMs: number) => {
    const cutoff = nowMs - windowMs;
    const timestamped = trades.flatMap((trade) => {
      if (!trade.timestamp) return [];
      const time = Date.parse(trade.timestamp);
      return Number.isFinite(time) ? [{ ...trade, time }] : [];
    });
    const inWindow = timestamped.filter((trade) => trade.time >= cutoff);
    const beforeWindow = timestamped.filter((trade) => trade.time < cutoff);
    const baseline = beforeWindow.at(-1) ?? inWindow[0];
    const baselinePrice = baseline ? BigInt(baseline.price) : null;
    const changeBps =
      inWindow.length === 0 || baselinePrice === null || baselinePrice === 0n
        ? null
        : Number(((basePerToken - baselinePrice) * 10_000n) / baselinePrice);
    let volume = 0n;
    let buy = 0n;
    let sell = 0n;
    const windowTraders = new Set<string>();
    for (const trade of inWindow) {
      const amount = BigInt(trade.baseAmount);
      volume += amount;
      if (trade.side === "buy") buy += amount;
      else sell += amount;
      windowTraders.add(trade.trader.toLowerCase());
    }
    return {
      changeBps,
      volumeBase: volume.toString(),
      buyVolumeBase: buy.toString(),
      sellVolumeBase: sell.toString(),
      tradeCount: inWindow.length,
      uniqueTraders: windowTraders.size,
    };
  };
  const metrics1h = windowMetrics(60 * 60 * 1000);
  const metrics6h = windowMetrics(6 * 60 * 60 * 1000);
  const metrics24h = windowMetrics(24 * 60 * 60 * 1000);
  const metrics7d = windowMetrics(7 * 24 * 60 * 60 * 1000);

  return {
    formula: "canonical-events-plus-onchain-state-v1",
    marketType:
      lifecycle?.marketPhase === "graduated" &&
      lifecycle.liquidityVenue === "uniswap-v4"
        ? "locked-uniswap-v4-position"
        : lifecycle?.marketPhase === "graduated" &&
            lifecycle.liquidityVenue === "uniswap-v3"
          ? "locked-uniswap-v3-position"
          : lifecycle?.marketPhase === "bonding"
            ? "constant-product-bonding-curve"
            : lifecycle?.marketPhase === "graduated"
              ? "locked-constant-product-pool"
              : "fixed-price-development-market",
    marketPhase: lifecycle?.marketPhase ?? "legacy_fixed",
    graduationProgressBps: lifecycle?.graduationProgressBps ?? 10_000,
    graduationThresholdBase: (
      lifecycle?.graduationThresholdBase ?? 0n
    ).toString(),
    baseRaised: (lifecycle?.baseRaised ?? 0n).toString(),
    remainingCurveTokens: (lifecycle?.remainingCurveTokens ?? 0n).toString(),
    graduatedPool: lifecycle?.graduatedPool ?? null,
    liquidityVenue: lifecycle?.liquidityVenue ?? null,
    poolManager: lifecycle?.poolManager ?? null,
    poolId: lifecycle?.poolId ?? null,
    hook: lifecycle?.hook ?? null,
    positionLocker: lifecycle?.positionLocker ?? null,
    positionTokenId: lifecycle?.positionTokenId?.toString() ?? null,
    poolFeePips: lifecycle?.poolFeePips ?? null,
    protocolFeeBps: lifecycle?.protocolFeeBps ?? feeBps,
    lpFeeBps: lifecycle?.lpFeeBps ?? 0,
    baseSymbol: lifecycle?.liquidityVenue === "uniswap-v4" ? "ETH" : "mUSD",
    feeBps,
    priceBasePerToken: basePerToken.toString(),
    priceChangeBps,
    change1hBps: metrics1h.changeBps,
    change6hBps: metrics6h.changeBps,
    change24hBps: metrics24h.changeBps,
    change7dBps: metrics7d.changeBps,
    marketCapBase: marketCapBase.toString(),
    liquidityBase: liquidityBase.toString(),
    totalVolumeBase: totalVolume.toString(),
    buyVolumeBase: buyVolume.toString(),
    sellVolumeBase: sellVolume.toString(),
    volume1hBase: metrics1h.volumeBase,
    volume6hBase: metrics6h.volumeBase,
    volume24hBase: metrics24h.volumeBase,
    volume7dBase: metrics7d.volumeBase,
    buyVolume24hBase: metrics24h.buyVolumeBase,
    sellVolume24hBase: metrics24h.sellVolumeBase,
    tradeCount1h: metrics1h.tradeCount,
    tradeCount6h: metrics6h.tradeCount,
    tradeCount24h: metrics24h.tradeCount,
    tradeCount7d: metrics7d.tradeCount,
    uniqueTraders1h: metrics1h.uniqueTraders,
    uniqueTraders6h: metrics6h.uniqueTraders,
    uniqueTraders24h: metrics24h.uniqueTraders,
    uniqueTraders7d: metrics7d.uniqueTraders,
    totalFeesBase: totalFees.toString(),
    tradeCount: trades.length,
    uniqueTraderCount: traders.size,
    holderCount: holders.length,
    totalSupply: totalSupply.toString(),
    circulatingSupply: circulatingSupply.toString(),
    tokenReserve: tokenReserve.toString(),
    baseReserve: baseReserve.toString(),
    graduationBlock,
    graduationTimestamp,
    topHolders: positiveBalances.slice(0, 10).map(([address, balance]) => ({
      address,
      balance: balance.toString(),
      shareBps:
        totalSupply === 0n
          ? "0"
          : ((balance * 10_000n) / totalSupply).toString(),
      label:
        address === liquidityPool
          ? "Locked liquidity"
          : address === positionLocker
            ? "Locked fee inventory"
            : address === market
              ? "Liquidity pool"
              : address === creator
                ? "Creator"
                : "Holder",
    })),
    recentTrades: trades.slice(-50).reverse(),
    chart: chart.length > 120 ? [chart[0], ...chart.slice(-119)] : chart,
  };
}

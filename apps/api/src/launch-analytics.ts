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
  "event Bought(address indexed buyer,uint256 baseInput,uint256 feeAmount,uint256 tokenOutput)",
  "event Sold(address indexed seller,uint256 tokenInput,uint256 feeAmount,uint256 baseOutput)",
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
};

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
  snapshot,
}: {
  launch: LaunchIdentity;
  logs: AnalyticsLog[];
  createdTimestamp: string | null;
  basePerToken: bigint;
  feeBps: number;
  initialSupply?: bigint;
  snapshot?: {
    totalSupply: bigint;
    tokenReserve: bigint;
    baseReserve: bigint;
    balances: Map<string, bigint>;
  };
}) {
  const token = launch.token.toLowerCase();
  const market = launch.market.toLowerCase();
  const creator = launch.creator.toLowerCase();
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
  }> = [
    {
      blockNumber: "0",
      timestamp: isoTime(createdTimestamp),
      price: basePerToken.toString(),
      cumulativeVolume: "0",
    },
  ];

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
    if (log.address.toLowerCase() !== market) continue;
    try {
      const decoded = decodeEventLog({
        abi: marketEvents,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName === "LiquiditySeeded") {
        tokenReserve += decoded.args.tokenAmount;
        baseReserve += decoded.args.baseAmount;
        continue;
      }
      if (decoded.eventName === "Bought") {
        const { buyer, baseInput, feeAmount, tokenOutput } = decoded.args;
        tokenReserve -= tokenOutput;
        baseReserve += baseInput - feeAmount;
        buyVolume += baseInput;
        totalVolume += baseInput;
        totalFees += feeAmount;
        cumulativeVolume += baseInput;
        traders.add(buyer.toLowerCase());
        trades.push({
          side: "buy",
          trader: buyer,
          baseAmount: baseInput.toString(),
          tokenAmount: tokenOutput.toString(),
          feeAmount: feeAmount.toString(),
          blockNumber: log.block_number,
          timestamp: isoTime(log.timestamp),
          transactionHash: log.transaction_hash,
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
        trades.push({
          side: "sell",
          trader: seller,
          baseAmount: grossBase.toString(),
          tokenAmount: tokenInput.toString(),
          feeAmount: feeAmount.toString(),
          blockNumber: log.block_number,
          timestamp: isoTime(log.timestamp),
          transactionHash: log.transaction_hash,
        });
      } else {
        continue;
      }
      chart.push({
        blockNumber: log.block_number,
        timestamp: isoTime(log.timestamp),
        price: basePerToken.toString(),
        cumulativeVolume: cumulativeVolume.toString(),
      });
    } catch {
      continue;
    }
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
  const holders = positiveBalances.filter(([address]) => address !== market);
  const circulatingSupply = totalSupply - (balances.get(market) ?? 0n);
  const marketCapBase = (totalSupply * basePerToken) / 10n ** 18n;
  const liquidityBase =
    baseReserve + (tokenReserve * basePerToken) / 10n ** 18n;

  return {
    formula: "canonical-events-plus-onchain-state-v1",
    marketType: "fixed-price-development-market",
    baseSymbol: "mUSD",
    feeBps,
    priceBasePerToken: basePerToken.toString(),
    priceChangeBps: 0,
    marketCapBase: marketCapBase.toString(),
    liquidityBase: liquidityBase.toString(),
    totalVolumeBase: totalVolume.toString(),
    buyVolumeBase: buyVolume.toString(),
    sellVolumeBase: sellVolume.toString(),
    totalFeesBase: totalFees.toString(),
    tradeCount: trades.length,
    uniqueTraderCount: traders.size,
    holderCount: holders.length,
    totalSupply: totalSupply.toString(),
    circulatingSupply: circulatingSupply.toString(),
    tokenReserve: tokenReserve.toString(),
    baseReserve: baseReserve.toString(),
    topHolders: positiveBalances.slice(0, 10).map(([address, balance]) => ({
      address,
      balance: balance.toString(),
      shareBps:
        totalSupply === 0n
          ? "0"
          : ((balance * 10_000n) / totalSupply).toString(),
      label:
        address === market
          ? "Liquidity pool"
          : address === creator
            ? "Creator"
            : "Holder",
    })),
    recentTrades: trades.slice(-50).reverse(),
    chart: chart.length > 120 ? [chart[0], ...chart.slice(-119)] : chart,
  };
}

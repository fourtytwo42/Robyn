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
const saleEvents = parseAbi([
  "event Bought(address indexed buyer,address indexed recipient,uint256 principal,uint256 fee,uint256 tokensOut,uint256 refund,uint256 cumulativeSold)",
  "event Sold(address indexed seller,address indexed recipient,uint256 tokensIn,uint256 principalOut,uint256 fee,uint256 nativeOut,uint256 cumulativeSold)",
]);
const stakingEvents = parseAbi([
  "event EscrowCreated(address indexed account,address indexed escrow,address indexed delegatee)",
]);
const poolEvents = parseAbi([
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
]);

export type RdaoAnalyticsLog = {
  block_number: string;
  transaction_hash: Hex;
  log_index: number;
  address: Address;
  topics: Hex[];
  data: Hex;
  timestamp: string | null;
};

type RdaoAnalyticsContracts = {
  token: Address;
  sale: Address;
  staking: Address;
  liquidityLocker: Address;
  wrappedNative?: Address | undefined;
  poolManager?: Address | undefined;
};

function addBalance(
  balances: Map<string, bigint>,
  address: string,
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

export function deriveRdaoMarketAnalytics({
  contracts,
  logs,
  totalSupply,
  poolId,
  poolFeePips = 10_000,
}: {
  contracts: RdaoAnalyticsContracts;
  logs: RdaoAnalyticsLog[];
  totalSupply: bigint;
  poolId?: Hex;
  poolFeePips?: number;
}) {
  const token = contracts.token.toLowerCase();
  const sale = contracts.sale.toLowerCase();
  const staking = contracts.staking.toLowerCase();
  const liquidityLocker = contracts.liquidityLocker.toLowerCase();
  const poolManager = contracts.poolManager?.toLowerCase();
  const wrappedNative = contracts.wrappedNative?.toLowerCase();
  const normalizedPoolId = poolId?.toLowerCase();
  const escrowOwners = new Map<string, string>();
  const rawBalances = new Map<string, bigint>();
  const trades: Array<{
    transactionHash: Hex;
    blockNumber: string;
    timestamp: string | null;
    side: "buy" | "sell";
    trader: Address;
    baseAmount: string;
    tokenAmount: string;
  }> = [];

  for (const log of logs) {
    if (log.address.toLowerCase() !== staking) continue;
    try {
      const decoded = decodeEventLog({
        abi: stakingEvents,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName === "EscrowCreated") {
        escrowOwners.set(
          decoded.args.escrow.toLowerCase(),
          decoded.args.account.toLowerCase(),
        );
      }
    } catch {
      continue;
    }
  }

  for (const log of logs) {
    const address = log.address.toLowerCase();
    if (address === token) {
      try {
        const decoded = decodeEventLog({
          abi: tokenEvents,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
        if (decoded.eventName !== "Transfer") continue;
        if (decoded.args.from.toLowerCase() !== zeroAddress)
          addBalance(rawBalances, decoded.args.from, -decoded.args.value);
        if (decoded.args.to.toLowerCase() !== zeroAddress)
          addBalance(rawBalances, decoded.args.to, decoded.args.value);
      } catch {
        continue;
      }
      continue;
    }

    if (address === sale) {
      try {
        const decoded = decodeEventLog({
          abi: saleEvents,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
        if (decoded.eventName === "Bought") {
          trades.push({
            transactionHash: log.transaction_hash,
            blockNumber: log.block_number,
            timestamp: isoTime(log.timestamp),
            side: "buy",
            trader: decoded.args.buyer,
            baseAmount: (decoded.args.principal + decoded.args.fee).toString(),
            tokenAmount: decoded.args.tokensOut.toString(),
          });
        } else if (decoded.eventName === "Sold") {
          trades.push({
            transactionHash: log.transaction_hash,
            blockNumber: log.block_number,
            timestamp: isoTime(log.timestamp),
            side: "sell",
            trader: decoded.args.seller,
            baseAmount: decoded.args.nativeOut.toString(),
            tokenAmount: decoded.args.tokensIn.toString(),
          });
        }
      } catch {
        continue;
      }
      continue;
    }

    if (
      address === poolManager &&
      normalizedPoolId &&
      wrappedNative &&
      normalizedPoolId !== `0x${"0".repeat(64)}`
    ) {
      try {
        const decoded = decodeEventLog({
          abi: poolEvents,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
        if (
          decoded.eventName !== "Swap" ||
          decoded.args.id.toLowerCase() !== normalizedPoolId
        )
          continue;
        const nativeIsCurrency0 = wrappedNative < token;
        const nativeDelta = nativeIsCurrency0
          ? decoded.args.amount0
          : decoded.args.amount1;
        const tokenDelta = nativeIsCurrency0
          ? decoded.args.amount1
          : decoded.args.amount0;
        const isBuy = nativeDelta > 0n && tokenDelta < 0n;
        const isSell = tokenDelta > 0n && nativeDelta < 0n;
        if (!isBuy && !isSell) continue;
        const nativeAmount = nativeDelta > 0n ? nativeDelta : -nativeDelta;
        const tokenAmount = tokenDelta > 0n ? tokenDelta : -tokenDelta;
        const feeAmount = isBuy
          ? (nativeAmount * BigInt(poolFeePips)) / 1_000_000n
          : (nativeAmount * BigInt(poolFeePips)) /
            BigInt(1_000_000 - poolFeePips);
        trades.push({
          transactionHash: log.transaction_hash,
          blockNumber: log.block_number,
          timestamp: isoTime(log.timestamp),
          side: isBuy ? "buy" : "sell",
          trader: decoded.args.sender,
          baseAmount: (isBuy
            ? nativeAmount
            : nativeAmount + feeAmount
          ).toString(),
          tokenAmount: tokenAmount.toString(),
        });
      } catch {
        continue;
      }
    }
  }

  const balances = new Map<string, bigint>();
  const stakedBalances = new Map<string, bigint>();
  for (const [address, balance] of rawBalances) {
    if (balance <= 0n) continue;
    const owner = escrowOwners.get(address);
    if (owner) {
      addBalance(balances, owner, balance);
      addBalance(stakedBalances, owner, balance);
    } else {
      addBalance(balances, address, balance);
    }
  }

  const positiveBalances = [...balances.entries()]
    .filter(([, balance]) => balance > 0n)
    .sort((left, right) =>
      left[1] === right[1] ? 0 : left[1] > right[1] ? -1 : 1,
    );
  const holderCount = positiveBalances.filter(
    ([address]) => address !== sale && address !== liquidityLocker,
  ).length;
  const uniqueTraders = new Set(
    trades.map((trade) => trade.trader.toLowerCase()),
  );
  const totalVolume = trades.reduce(
    (sum, trade) => sum + BigInt(trade.baseAmount),
    0n,
  );

  return {
    formula: "canonical-rdao-events-v1",
    holderCount,
    tradeCount: trades.length,
    uniqueTraderCount: uniqueTraders.size,
    totalVolumeBase: totalVolume.toString(),
    topHolders: positiveBalances.slice(0, 100).map(([address, balance]) => {
      const staked = stakedBalances.get(address) ?? 0n;
      const liquid = balance - staked;
      return {
        address,
        balance: balance.toString(),
        shareBps:
          totalSupply === 0n
            ? "0"
            : ((balance * 10_000n) / totalSupply).toString(),
        label:
          address === sale
            ? "Public sale and liquidity"
            : address === liquidityLocker
              ? "Permanently locked liquidity"
              : staked > 0n && liquid > 0n
                ? "Liquid + staked"
                : staked > 0n
                  ? "Staked"
                  : "Holder",
      };
    }),
    recentTrades: trades.slice(-50).reverse(),
  };
}

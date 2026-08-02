import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import {
  analyticsLogAddresses,
  collectTokenAccounts,
  deriveLaunchAnalytics,
  type AnalyticsLog,
} from "../src/launch-analytics.js";

const token = "0x1000000000000000000000000000000000000001" as Address;
const market = "0x2000000000000000000000000000000000000002" as Address;
const creator = "0x3000000000000000000000000000000000000003" as Address;
const trader = "0x4000000000000000000000000000000000000004" as Address;
const base = "0x0500000000000000000000000000000000000005" as Address;
const pool = "0x5000000000000000000000000000000000000005" as Address;
const locker = "0x6000000000000000000000000000000000000006" as Address;
const transferAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const marketAbi = parseAbi([
  "event Bought(address indexed buyer,uint256 baseInput,uint256 feeAmount,uint256 tokenOutput)",
  "event Sold(address indexed seller,uint256 tokenInput,uint256 feeAmount,uint256 baseOutput)",
  "event Graduated(address indexed pool,uint256 tokenLiquidity,uint256 baseLiquidity,uint256 finalCurvePrice)",
]);
const productionMarketAbi = parseAbi([
  "event Graduated(address indexed pool,address indexed locker,uint256 indexed positionTokenId,uint256 tokenLiquidity,uint256 baseLiquidity,uint256 finalCurvePrice)",
]);
const poolAbi = parseAbi([
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
]);
const v4PoolAbi = parseAbi([
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
]);
const v4PoolId = `0x${"a".repeat(64)}` as Hex;

function row(
  address: Address,
  topics: readonly Hex[],
  data: Hex,
  block: number,
): AnalyticsLog {
  return {
    address,
    topics: [...topics],
    data,
    block_number: String(block),
    transaction_hash: `0x${String(block).padStart(64, "0")}` as Hex,
    log_index: 0,
    timestamp: String(1_750_000_000 + block),
  };
}

describe("launch analytics", () => {
  it("normalizes mixed-case pool addresses for indexed log queries", () => {
    expect(
      analyticsLogAddresses({
        token: "0x10000000000000000000000000000000000000Aa",
        market: "0x20000000000000000000000000000000000000Bb",
        liquidityPool: "0x30000000000000000000000000000000000000Cc",
      }),
    ).toEqual([
      "0x10000000000000000000000000000000000000aa",
      "0x20000000000000000000000000000000000000bb",
      "0x30000000000000000000000000000000000000cc",
    ]);
  });

  it("reconciles an initial supply when constructor mint logs predate indexing", () => {
    const logs: AnalyticsLog[] = [
      row(
        token,
        encodeEventTopics({
          abi: transferAbi,
          eventName: "Transfer",
          args: { from: creator, to: trader },
        }),
        encodeAbiParameters([{ type: "uint256" }], [parseEther("100")]),
        10,
      ),
    ];
    const result = deriveLaunchAnalytics({
      launch: { token, market, creator },
      logs,
      createdTimestamp: null,
      basePerToken: parseEther("0.001"),
      feeBps: 100,
      initialSupply: parseEther("1000"),
    });

    expect(result.totalSupply).toBe(parseEther("1000").toString());
    expect(result.marketCapBase).toBe(parseEther("1").toString());
    expect(result.holderCount).toBe(2);
    expect(result.topHolders[0]).toMatchObject({
      address: creator.toLowerCase(),
      balance: parseEther("900").toString(),
    });
  });

  it("binds decoded trade history to the current onchain holder snapshot", () => {
    const logs: AnalyticsLog[] = [
      row(
        token,
        encodeEventTopics({
          abi: transferAbi,
          eventName: "Transfer",
          args: { from: creator, to: trader },
        }),
        encodeAbiParameters([{ type: "uint256" }], [parseEther("100")]),
        10,
      ),
      row(
        market,
        encodeEventTopics({
          abi: marketAbi,
          eventName: "Bought",
          args: { buyer: trader },
        }),
        encodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
          [parseEther("100"), parseEther("1"), parseEther("99000")],
        ),
        11,
      ),
      row(
        market,
        encodeEventTopics({
          abi: marketAbi,
          eventName: "Sold",
          args: { seller: trader },
        }),
        encodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
          [parseEther("10000"), parseEther("0.1"), parseEther("9.9")],
        ),
        12,
      ),
    ];
    const balances = new Map([
      [creator.toLowerCase(), parseEther("500")],
      [market.toLowerCase(), parseEther("400")],
      [trader.toLowerCase(), parseEther("100")],
    ]);
    const result = deriveLaunchAnalytics({
      launch: { token, market, creator },
      logs,
      createdTimestamp: "1750000000",
      basePerToken: parseEther("0.001"),
      feeBps: 100,
      snapshot: {
        totalSupply: parseEther("1000"),
        tokenReserve: parseEther("400"),
        baseReserve: parseEther("500"),
        balances,
      },
    });

    expect(result.tradeCount).toBe(2);
    expect(result.totalVolumeBase).toBe(parseEther("110").toString());
    expect(result.totalFeesBase).toBe(parseEther("1.1").toString());
    expect(result.holderCount).toBe(2);
    expect(result.topHolders[0]).toMatchObject({
      address: creator.toLowerCase(),
      shareBps: "5000",
      label: "Creator",
    });
    expect(result.chart).toHaveLength(3);
    expect(collectTokenAccounts(logs, token)).toEqual(
      new Set([creator.toLowerCase(), trader.toLowerCase()]),
    );
  });

  it("uses canonical reserve snapshots when indexed history starts after seeding", () => {
    const result = deriveLaunchAnalytics({
      launch: { token, market, creator },
      logs: [],
      createdTimestamp: null,
      basePerToken: parseEther("0.002"),
      feeBps: 100,
      initialSupply: parseEther("1000"),
      reserveSnapshot: {
        tokenReserve: parseEther("300"),
        baseReserve: parseEther("400"),
      },
    });

    expect(result.tokenReserve).toBe(parseEther("300").toString());
    expect(result.baseReserve).toBe(parseEther("400").toString());
    expect(result.liquidityBase).toBe(parseEther("400.6").toString());
  });

  it("derives truthful 24 hour and 7 day windows from timestamped trades", () => {
    const nowSeconds = 1_751_000_000;
    const oldBuy = row(
      market,
      encodeEventTopics({
        abi: marketAbi,
        eventName: "Bought",
        args: { buyer: trader },
      }),
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [parseEther("100"), parseEther("1"), parseEther("100000")],
      ),
      20,
    );
    oldBuy.timestamp = String(nowSeconds - 8 * 24 * 60 * 60);
    const recentBuy = row(
      market,
      encodeEventTopics({
        abi: marketAbi,
        eventName: "Bought",
        args: { buyer: trader },
      }),
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [parseEther("200"), parseEther("2"), parseEther("100000")],
      ),
      21,
    );
    recentBuy.timestamp = String(nowSeconds - 2 * 24 * 60 * 60);
    const recentSell = row(
      market,
      encodeEventTopics({
        abi: marketAbi,
        eventName: "Sold",
        args: { seller: trader },
      }),
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [parseEther("100000"), parseEther("1"), parseEther("299")],
      ),
      22,
    );
    recentSell.timestamp = String(nowSeconds - 60 * 60);

    const result = deriveLaunchAnalytics({
      launch: { token, market, creator },
      logs: [oldBuy, recentBuy, recentSell],
      createdTimestamp: String(nowSeconds - 9 * 24 * 60 * 60),
      basePerToken: parseEther("0.004"),
      feeBps: 100,
      initialSupply: parseEther("1000000"),
      nowMs: nowSeconds * 1000,
    });

    expect(result.change1hBps).toBe(10_202);
    expect(result.change5mBps).toBeNull();
    expect(result.change6hBps).toBe(10_202);
    expect(result.change24hBps).toBe(10_202);
    expect(result.change7dBps).toBe(30_404);
    expect(result.volume1hBase).toBe(parseEther("300").toString());
    expect(result.volume5mBase).toBe("0");
    expect(result.volume6hBase).toBe(parseEther("300").toString());
    expect(result.volume24hBase).toBe(parseEther("300").toString());
    expect(result.volume7dBase).toBe(parseEther("500").toString());
    expect(result.buyVolume24hBase).toBe("0");
    expect(result.sellVolume24hBase).toBe(parseEther("300").toString());
    expect(result.tradeCount1h).toBe(1);
    expect(result.tradeCount5m).toBe(0);
    expect(result.tradeCount6h).toBe(1);
    expect(result.tradeCount24h).toBe(1);
    expect(result.tradeCount7d).toBe(2);
    expect(result.uniqueTraders1h).toBe(1);
    expect(result.uniqueTraders5m).toBe(0);
    expect(result.uniqueTraders6h).toBe(1);
    expect(result.uniqueTraders24h).toBe(1);
    expect(result.uniqueTraders7d).toBe(1);
    expect(result.chart.at(-1)).toMatchObject({
      eventType: "trade",
      side: "sell",
      baseAmount: parseEther("300").toString(),
    });
    expect(result.allTimeHighPriceBasePerToken).toBe(
      parseEther("0.004").toString(),
    );
    expect(result.allTimeHighMarketCapBase).toBe(parseEther("4000").toString());
  });

  it("returns null window changes without timestamped trade history", () => {
    const result = deriveLaunchAnalytics({
      launch: { token, market, creator },
      logs: [],
      createdTimestamp: null,
      basePerToken: parseEther("0.001"),
      feeBps: 100,
      initialSupply: parseEther("1000"),
      nowMs: 1_751_000_000_000,
    });

    expect(result.change1hBps).toBeNull();
    expect(result.change5mBps).toBeNull();
    expect(result.change6hBps).toBeNull();
    expect(result.change24hBps).toBeNull();
    expect(result.change7dBps).toBeNull();
    expect(result.volume1hBase).toBe("0");
    expect(result.volume5mBase).toBe("0");
    expect(result.volume6hBase).toBe("0");
    expect(result.volume24hBase).toBe("0");
  });

  it("does not report stale movement when a window has no trades", () => {
    const nowSeconds = 1_751_000_000;
    const oldBuy = row(
      market,
      encodeEventTopics({
        abi: marketAbi,
        eventName: "Bought",
        args: { buyer: trader },
      }),
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [parseEther("100"), parseEther("1"), parseEther("100000")],
      ),
      24,
    );
    oldBuy.timestamp = String(nowSeconds - 2 * 24 * 60 * 60);
    const result = deriveLaunchAnalytics({
      launch: { token, market, creator },
      logs: [oldBuy],
      createdTimestamp: String(nowSeconds - 3 * 24 * 60 * 60),
      basePerToken: parseEther("0.002"),
      feeBps: 100,
      initialSupply: parseEther("1000"),
      nowMs: nowSeconds * 1000,
    });

    expect(result.change24hBps).toBeNull();
    expect(result.tradeCount24h).toBe(0);
    expect(result.volume24hBase).toBe("0");
  });

  it("marks canonical graduation events in the chart", () => {
    const graduated = row(
      market,
      encodeEventTopics({
        abi: marketAbi,
        eventName: "Graduated",
        args: { pool },
      }),
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [parseEther("200"), parseEther("6500"), parseEther("0.003")],
      ),
      30,
    );
    const result = deriveLaunchAnalytics({
      launch: { token, market, creator },
      logs: [graduated],
      createdTimestamp: null,
      basePerToken: parseEther("0.003"),
      feeBps: 100,
      initialSupply: parseEther("1000"),
    });

    expect(result.graduationBlock).toBe("30");
    expect(result.chart.at(-1)).toMatchObject({
      eventType: "graduation",
      transactionHash: graduated.transaction_hash,
    });
  });

  it("indexes direct Uniswap pool swaps without double-counting routed market trades", () => {
    const directSwap = row(
      pool,
      encodeEventTopics({
        abi: poolAbi,
        eventName: "Swap",
        args: { sender: market, recipient: trader },
      }),
      encodeAbiParameters(
        [
          { type: "int256" },
          { type: "int256" },
          { type: "uint160" },
          { type: "uint128" },
          { type: "int24" },
        ],
        [parseEther("100"), -parseEther("99"), 1n, 1n, 0],
      ),
      40,
    );
    const routedSwap = {
      ...directSwap,
      transaction_hash: row(pool, [], "0x", 41).transaction_hash,
    };
    const routedMarketEvent = row(
      market,
      encodeEventTopics({
        abi: marketAbi,
        eventName: "Bought",
        args: { buyer: trader },
      }),
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [parseEther("50"), parseEther("0.5"), parseEther("49")],
      ),
      41,
    );
    const result = deriveLaunchAnalytics({
      launch: { token, market, creator, baseAsset: base, liquidityPool: pool },
      logs: [directSwap, routedSwap, routedMarketEvent],
      createdTimestamp: null,
      basePerToken: parseEther("1"),
      feeBps: 100,
      initialSupply: parseEther("1000"),
      lifecycle: {
        marketPhase: "graduated",
        graduationProgressBps: 10_000,
        graduationThresholdBase: parseEther("666"),
        baseRaised: parseEther("666"),
        remainingCurveTokens: 0n,
        graduatedPool: pool,
        liquidityVenue: "uniswap-v3",
        positionLocker: locker,
        positionTokenId: 42n,
        poolFeePips: 10_000,
      },
    });

    expect(result.tradeCount).toBe(2);
    expect(result.totalVolumeBase).toBe(parseEther("150").toString());
    expect(result.totalFeesBase).toBe(parseEther("1.5").toString());
    expect(result.marketType).toBe("locked-uniswap-v3-position");
    expect(result.positionLocker).toBe(locker);
    expect(result.positionTokenId).toBe("42");
    expect(result.poolFeePips).toBe(10_000);
  });

  it("indexes only the launch pool from the v4 singleton", () => {
    const directSwap = row(
      pool,
      encodeEventTopics({
        abi: v4PoolAbi,
        eventName: "Swap",
        args: { id: v4PoolId, sender: trader },
      }),
      encodeAbiParameters(
        [
          { type: "int128" },
          { type: "int128" },
          { type: "uint160" },
          { type: "uint128" },
          { type: "int24" },
          { type: "uint24" },
        ],
        [parseEther("100"), -parseEther("99"), 1n, 1n, 0, 10_000],
      ),
      50,
    );
    const unrelatedSwap = row(
      pool,
      encodeEventTopics({
        abi: v4PoolAbi,
        eventName: "Swap",
        args: { id: `0x${"b".repeat(64)}` as Hex, sender: trader },
      }),
      directSwap.data,
      51,
    );
    const result = deriveLaunchAnalytics({
      launch: {
        token,
        market,
        creator,
        liquidityPool: pool,
        poolManager: pool,
        poolId: v4PoolId,
      },
      logs: [directSwap, unrelatedSwap],
      createdTimestamp: null,
      basePerToken: parseEther("1"),
      feeBps: 100,
      initialSupply: parseEther("1000"),
      lifecycle: {
        marketPhase: "graduated",
        graduationProgressBps: 10_000,
        graduationThresholdBase: parseEther("666"),
        baseRaised: parseEther("666"),
        remainingCurveTokens: 0n,
        graduatedPool: null,
        liquidityVenue: "uniswap-v4",
        poolManager: pool,
        poolId: v4PoolId,
        hook: locker,
        positionLocker: locker,
        positionTokenId: 453n,
        poolFeePips: 10_000,
      },
    });

    expect(result.tradeCount).toBe(1);
    expect(result.totalVolumeBase).toBe(parseEther("100").toString());
    expect(result.totalFeesBase).toBe(parseEther("1").toString());
    expect(result.marketType).toBe("locked-uniswap-v4-position");
    expect(result.baseSymbol).toBe("ETH");
    expect(result.poolManager).toBe(pool);
    expect(result.poolId).toBe(v4PoolId);
    expect(result.hook).toBe(locker);
    expect(result.positionTokenId).toBe("453");
  });

  it("decodes the production graduation event with locker and position id", () => {
    const graduated = row(
      market,
      encodeEventTopics({
        abi: productionMarketAbi,
        eventName: "Graduated",
        args: { pool, locker, positionTokenId: 42n },
      }),
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [parseEther("666"), parseEther("666"), parseEther("0.999")],
      ),
      42,
    );
    const result = deriveLaunchAnalytics({
      launch: { token, market, creator },
      logs: [graduated],
      createdTimestamp: null,
      basePerToken: parseEther("1"),
      feeBps: 100,
      initialSupply: parseEther("1000"),
    });
    expect(result.graduationBlock).toBe("42");
  });
});

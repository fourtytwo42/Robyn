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
  collectTokenAccounts,
  deriveLaunchAnalytics,
  type AnalyticsLog,
} from "../src/launch-analytics.js";

const token = "0x1000000000000000000000000000000000000001" as Address;
const market = "0x2000000000000000000000000000000000000002" as Address;
const creator = "0x3000000000000000000000000000000000000003" as Address;
const trader = "0x4000000000000000000000000000000000000004" as Address;
const transferAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const marketAbi = parseAbi([
  "event Bought(address indexed buyer,uint256 baseInput,uint256 feeAmount,uint256 tokenOutput)",
  "event Sold(address indexed seller,uint256 tokenInput,uint256 feeAmount,uint256 baseOutput)",
  "event Graduated(address indexed pool,uint256 tokenLiquidity,uint256 baseLiquidity,uint256 finalCurvePrice)",
]);

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

    expect(result.change24hBps).toBe(10_202);
    expect(result.change7dBps).toBe(30_404);
    expect(result.volume24hBase).toBe(parseEther("300").toString());
    expect(result.volume7dBase).toBe(parseEther("500").toString());
    expect(result.buyVolume24hBase).toBe("0");
    expect(result.sellVolume24hBase).toBe(parseEther("300").toString());
    expect(result.tradeCount24h).toBe(1);
    expect(result.uniqueTraders24h).toBe(1);
    expect(result.chart.at(-1)).toMatchObject({
      eventType: "trade",
      side: "sell",
      baseAmount: parseEther("300").toString(),
    });
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

    expect(result.change24hBps).toBeNull();
    expect(result.change7dBps).toBeNull();
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
    const pool = "0x5000000000000000000000000000000000000005" as Address;
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
});

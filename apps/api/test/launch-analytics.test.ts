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
});

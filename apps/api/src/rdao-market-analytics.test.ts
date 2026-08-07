import {
  encodeAbiParameters,
  pad,
  parseAbiItem,
  toEventSelector,
  type AbiEvent,
  type Address,
} from "viem";
import { describe, expect, it } from "vitest";
import {
  deriveRdaoMarketAnalytics,
  type RdaoAnalyticsLog,
} from "./rdao-market-analytics.js";

const owner = "0x1000000000000000000000000000000000000001";
const buyer = "0x2000000000000000000000000000000000000002";
const token = "0x3000000000000000000000000000000000000003";
const sale = "0x4000000000000000000000000000000000000004";
const staking = "0x5000000000000000000000000000000000000005";
const escrow = "0x6000000000000000000000000000000000000006";
const locker = "0x7000000000000000000000000000000000000007";
const transactionHash = `0x${"1".repeat(64)}` as const;
const transferEvent = parseAbiItem(
  "event Transfer(address indexed from,address indexed to,uint256 value)",
);
const escrowCreatedEvent = parseAbiItem(
  "event EscrowCreated(address indexed account,address indexed escrow,address indexed delegatee)",
);
const boughtEvent = parseAbiItem(
  "event Bought(address indexed buyer,address indexed recipient,uint256 principal,uint256 fee,uint256 tokensOut,uint256 refund,uint256 cumulativeSold)",
);
const soldEvent = parseAbiItem(
  "event Sold(address indexed seller,address indexed recipient,uint256 tokensIn,uint256 principalOut,uint256 fee,uint256 nativeOut,uint256 cumulativeSold)",
);

function eventLog(
  address: `0x${string}`,
  item: AbiEvent,
  args: Record<string, unknown>,
  block = 1,
): RdaoAnalyticsLog {
  const inputs = item.inputs.filter((input) => !input.indexed);
  const values = inputs.map((input) => args[input.name ?? ""]);
  return {
    block_number: String(block),
    transaction_hash: transactionHash,
    log_index: block,
    address,
    topics: [
      toEventSelector(item),
      ...item.inputs
        .filter((input) => input.indexed)
        .map((input) => pad(args[input.name ?? ""] as Address, { size: 32 })),
    ],
    data: encodeAbiParameters(inputs, values as never),
    timestamp: "1786000000",
  };
}

describe("deriveRdaoMarketAnalytics", () => {
  it("rolls escrow custody into the beneficial owner and preserves system allocations", () => {
    const oneBillion = 1_000_000_000n * 10n ** 18n;
    const logs = [
      eventLog(staking, escrowCreatedEvent, {
        account: owner,
        escrow,
        delegatee: owner,
      }),
      eventLog(
        token,
        transferEvent,
        {
          from: "0x0000000000000000000000000000000000000000",
          to: owner,
          value: oneBillion,
        },
        2,
      ),
      eventLog(
        token,
        transferEvent,
        { from: owner, to: sale, value: 200_000_000n * 10n ** 18n },
        3,
      ),
      eventLog(
        token,
        transferEvent,
        { from: owner, to: escrow, value: 800_000_000n * 10n ** 18n },
        4,
      ),
    ];
    const result = deriveRdaoMarketAnalytics({
      contracts: { token, sale, staking, liquidityLocker: locker },
      logs,
      totalSupply: oneBillion,
    });

    expect(result.holderCount).toBe(1);
    expect(result.topHolders).toEqual([
      expect.objectContaining({
        address: owner.toLowerCase(),
        shareBps: "8000",
        label: "Staked",
      }),
      expect.objectContaining({
        address: sale.toLowerCase(),
        shareBps: "2000",
        label: "Public sale and liquidity",
      }),
    ]);
  });

  it("normalizes bonding buys and sells into the shared trade table", () => {
    const logs = [
      eventLog(sale, boughtEvent, {
        buyer,
        recipient: buyer,
        principal: 99n,
        fee: 1n,
        tokensOut: 10n,
        refund: 0n,
        cumulativeSold: 10n,
      }),
      eventLog(
        sale,
        soldEvent,
        {
          seller: buyer,
          recipient: buyer,
          tokensIn: 4n,
          principalOut: 40n,
          fee: 1n,
          nativeOut: 39n,
          cumulativeSold: 6n,
        },
        2,
      ),
    ];
    const result = deriveRdaoMarketAnalytics({
      contracts: { token, sale, staking, liquidityLocker: locker },
      logs,
      totalSupply: 1_000n,
    });

    expect(result.tradeCount).toBe(2);
    expect(result.uniqueTraderCount).toBe(1);
    expect(result.totalVolumeBase).toBe("139");
    expect(result.recentTrades.map((trade) => trade.side)).toEqual([
      "sell",
      "buy",
    ]);
  });
});

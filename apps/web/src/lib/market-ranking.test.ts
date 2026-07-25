import { describe, expect, it } from "vitest";
import type { LaunchRecord } from "./data-api";
import { rankActiveMarkets } from "./market-ranking";

function launch(
  launchId: string,
  metrics: {
    cap: string;
    volume: string;
    traders: number;
    trades: number;
  } | null,
): LaunchRecord {
  return {
    launch_id: launchId,
    token: `0x${launchId.padStart(40, "0")}`,
    vault: "0x0000000000000000000000000000000000000001",
    market: "0x0000000000000000000000000000000000000002",
    creator: "0x0000000000000000000000000000000000000003",
    name: `Market ${launchId}`,
    symbol: `M${launchId}`,
    assets: [],
    weights_bps: [],
    created_block: launchId,
    updated_block: launchId,
    formula_version: "test",
    campaign_id: null,
    campaign_release_sha: null,
    automated_test_launch: false,
    metrics: metrics
      ? ({
          marketCapBase: metrics.cap,
          volume24hBase: metrics.volume,
          uniqueTraders24h: metrics.traders,
          tradeCount24h: metrics.trades,
        } as LaunchRecord["metrics"])
      : null,
  };
}

describe("rankActiveMarkets", () => {
  it("balances volume, market cap, traders, and trade activity", () => {
    const volumeOnly = launch("1", {
      cap: "10",
      volume: "1000",
      traders: 1,
      trades: 1,
    });
    const balanced = launch("2", {
      cap: "900",
      volume: "900",
      traders: 90,
      trades: 100,
    });
    const inactive = launch("3", {
      cap: "100",
      volume: "0",
      traders: 0,
      trades: 0,
    });
    expect(rankActiveMarkets([volumeOnly, inactive, balanced])).toEqual([
      balanced,
      volumeOnly,
      inactive,
    ]);
  });

  it("places markets without indexed metrics last", () => {
    const active = launch("1", {
      cap: "1",
      volume: "1",
      traders: 1,
      trades: 1,
    });
    const unknown = launch("2", null);
    expect(rankActiveMarkets([unknown, active])).toEqual([active, unknown]);
  });
});

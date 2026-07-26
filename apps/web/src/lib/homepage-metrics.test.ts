import { describe, expect, it } from "vitest";
import type { LaunchRecord } from "./data-api";
import { deriveHomepageMetrics } from "./homepage-metrics";

function launch(
  token: string,
  symbol: string,
  volume24hBase: string,
  tradeCount24h: number,
): LaunchRecord {
  return {
    launch_id: token,
    token,
    vault: "0x0000000000000000000000000000000000000001",
    market: "0x0000000000000000000000000000000000000002",
    creator: "0x0000000000000000000000000000000000000003",
    name: symbol,
    symbol,
    assets: [],
    weights_bps: [],
    created_block: "1",
    updated_block: "1",
    formula_version: "test",
    campaign_id: null,
    campaign_release_sha: null,
    automated_test_launch: false,
    metrics: {
      volume24hBase,
      tradeCount24h,
    } as LaunchRecord["metrics"],
  };
}

describe("deriveHomepageMetrics", () => {
  it("returns an empty 24-hour snapshot when markets have no activity", () => {
    expect(
      deriveHomepageMetrics([
        launch("0x0000000000000000000000000000000000000001", "OAK", "0", 0),
      ]),
    ).toEqual({
      activeMarkets24h: 0,
      trades24h: 0,
      volume24hBase: "0",
      volumeLeader24h: null,
    });
  });

  it("aggregates the 24-hour window and identifies its volume leader", () => {
    expect(
      deriveHomepageMetrics([
        launch("0x0000000000000000000000000000000000000001", "OAK", "200", 3),
        launch("0x0000000000000000000000000000000000000002", "ASH", "900", 7),
        launch("0x0000000000000000000000000000000000000003", "ELM", "0", 1),
      ]),
    ).toEqual({
      activeMarkets24h: 3,
      trades24h: 11,
      volume24hBase: "1100",
      volumeLeader24h: {
        symbol: "ASH",
        token: "0x0000000000000000000000000000000000000002",
      },
    });
  });
});

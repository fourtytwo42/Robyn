import { getLaunches } from "@/lib/data-api";
import { MarketTapeClient } from "@/components/market-tape-client";

export async function MarketTape() {
  const launches = await getLaunches().catch(() => null);
  const markets =
    launches?.data
      .filter((launch) => launch.metrics)
      .slice(0, 8)
      .map((launch) => ({
        token: launch.token,
        symbol: launch.symbol,
        marketCapBase: launch.metrics!.marketCapBase,
        baseSymbol: launch.metrics!.baseSymbol,
        change24hBps: launch.metrics!.change24hBps,
      })) ?? [];
  return <MarketTapeClient markets={markets} />;
}

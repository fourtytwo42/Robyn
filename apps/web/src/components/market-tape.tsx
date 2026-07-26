import { getLaunches } from "@/lib/data-api";
import { MarketTapeClient } from "@/components/market-tape-client";
import { getEthUsdPrice } from "@/lib/eth-usd";
import { marketCapAmount } from "@/lib/display-format";

export async function MarketTape() {
  const [launches, ethUsdPrice] = await Promise.all([
    getLaunches().catch(() => null),
    getEthUsdPrice(),
  ]);
  const markets =
    launches?.data
      .filter((launch) => launch.metrics)
      .slice(0, 8)
      .map((launch) => ({
        token: launch.token,
        symbol: launch.symbol,
        artworkSrc:
          launch.metadata?.media_status === "active" && launch.metadata.media_id
            ? `/api/media/${launch.metadata.media_id}?cid=${launch.metadata.optimized_webp_cid ?? "active"}`
            : null,
        marketCapLabel: marketCapAmount(
          launch.metrics!.marketCapBase,
          launch.metrics!.baseSymbol,
          ethUsdPrice,
        ),
        change24hBps: launch.metrics!.change24hBps,
      })) ?? [];
  return <MarketTapeClient markets={markets} />;
}

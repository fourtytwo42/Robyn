import Link from "next/link";
import { formatEther } from "viem";
import { getLaunches } from "@/lib/data-api";

function compactBase(value: string) {
  const amount = Number(formatEther(BigInt(value)));
  return amount.toLocaleString(undefined, {
    notation: "compact",
    maximumFractionDigits: 2,
  });
}

export async function MarketTape() {
  const launches = await getLaunches().catch(() => null);
  const markets =
    launches?.data.filter((launch) => launch.metrics).slice(0, 8) ?? [];

  return (
    <aside className="market-tape" aria-label="Live reward market tape">
      <span className="market-tape-label">
        <i aria-hidden="true" /> Live reward markets
      </span>
      <div className="market-tape-track">
        {markets.length === 0 ? (
          <span className="market-tape-empty">Market data is loading.</span>
        ) : (
          markets.map((market) => (
            <Link href={`/launches/${market.token}`} key={market.token}>
              <strong>${market.symbol}</strong>
              <span>
                {compactBase(market.metrics!.marketCapBase)}{" "}
                {market.metrics!.baseSymbol}
              </span>
              <small
                className={
                  market.metrics!.priceChangeBps > 0
                    ? "market-change positive"
                    : market.metrics!.priceChangeBps < 0
                      ? "market-change negative"
                      : "market-change neutral"
                }
              >
                {market.metrics!.priceChangeBps > 0 ? "+" : ""}
                {(market.metrics!.priceChangeBps / 100).toFixed(2)}%
              </small>
            </Link>
          ))
        )}
      </div>
    </aside>
  );
}

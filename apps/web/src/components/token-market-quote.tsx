"use client";

import { useState } from "react";
import { baseValueInUsd, marketAmount, usdAmount } from "@/lib/display-format";

export function TokenMarketQuote({
  marketCapBase,
  priceBasePerToken,
  baseSymbol,
  tokenSymbol,
  ethUsdPrice,
}: {
  marketCapBase: string;
  priceBasePerToken: string;
  baseSymbol: string;
  tokenSymbol: string;
  ethUsdPrice: number | null;
}) {
  const [showEth, setShowEth] = useState(false);
  const marketCapUsd = baseValueInUsd(marketCapBase, baseSymbol, ethUsdPrice);
  const priceUsd = baseValueInUsd(priceBasePerToken, baseSymbol, ethUsdPrice);
  const canConvert = baseSymbol === "ETH" && marketCapUsd !== null;
  const marketCapLabel =
    canConvert && !showEth
      ? usdAmount(marketCapUsd, marketCapUsd < 1 ? 6 : 2)
      : marketAmount(marketCapBase, baseSymbol);
  const priceLabel =
    priceUsd === null
      ? marketAmount(priceBasePerToken, baseSymbol)
      : usdAmount(priceUsd, 8, false);

  return (
    <>
      <span>Market cap</span>
      <strong
        className={canConvert ? "market-cap-hover-value" : undefined}
        tabIndex={canConvert ? 0 : undefined}
        title={
          canConvert ? "Hover or focus to view market cap in ETH" : undefined
        }
        onPointerEnter={() => setShowEth(true)}
        onPointerLeave={() => setShowEth(false)}
        onFocus={() => setShowEth(true)}
        onBlur={() => setShowEth(false)}
      >
        {marketCapLabel}
      </strong>
      <small>
        Price {priceLabel} / {tokenSymbol}
      </small>
      {canConvert ? (
        <small className="usd-reference-note">
          USD reference · hover market cap for ETH
        </small>
      ) : null}
    </>
  );
}

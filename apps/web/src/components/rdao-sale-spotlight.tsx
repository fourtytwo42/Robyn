"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatEther } from "viem";

type RdaoSaleState = {
  sale: {
    saleInventory: string;
    liquidityInventory: string;
    sold: string;
    currentPriceE18: string;
    curvePrincipal: string;
    curvePrincipalTarget: string;
    buysPaused: boolean;
    finalized: boolean;
  };
};

function tokenAmount(value: string, digits = 2) {
  return Number(formatEther(BigInt(value))).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function ethAmount(value: string, digits = 6) {
  return Number(formatEther(BigInt(value))).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

export function RdaoSaleSpotlight({
  variant = "home",
}: {
  variant?: "home" | "page";
}) {
  const [state, setState] = useState<RdaoSaleState>();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/rdao", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("RDAO sale unavailable");
        return (await response.json()) as { data: RdaoSaleState };
      })
      .then(({ data }) => {
        if (!cancelled) setState(data);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const progress = useMemo(() => {
    if (!state || BigInt(state.sale.saleInventory) === 0n) return 0;
    return (
      Number(
        (BigInt(state.sale.sold) * 1_000_000n) /
          BigInt(state.sale.saleInventory),
      ) / 10_000
    );
  }, [state]);

  const saleStatus = state?.sale.finalized
    ? "Graduated"
    : state?.sale.buysPaused
      ? "Purchases paused"
      : "Bonding live";

  return (
    <section
      className={`rdao-sale-spotlight ${variant}`}
      aria-labelledby={`rdao-sale-heading-${variant}`}
    >
      <div className="rdao-sale-copy">
        <div className="rdao-sale-identity">
          <Image
            src="/assets/brand/rdao-token.webp"
            alt="Robyn DAO token"
            width={96}
            height={96}
          />
          <div>
            <p className="eyebrow">Sherwood&apos;s governance token</p>
            <h2 id={`rdao-sale-heading-${variant}`}>RDAO</h2>
          </div>
        </div>
        <p>
          Enter the public bonding sale, then stake RDAO to earn a share of
          protocol and locked-liquidity fees while retaining your governance
          voice.
        </p>
        <div className="rdao-allocation-line" aria-hidden="true">
          <span />
          <span />
        </div>
        <div className="rdao-allocation-labels">
          <span>150m public bonding sale</span>
          <span>50m locked liquidity</span>
        </div>
      </div>

      <div className="rdao-sale-panel">
        <div className="dao-status-row">
          <span className="status-chip success">{saleStatus}</span>
          <span className="muted">Open to every wallet</span>
        </div>
        <div className="rdao-sale-progress" aria-label={`${progress}% sold`}>
          <span style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
        <div className="rdao-sale-metrics">
          <div>
            <span>Sale progress</span>
            <strong>{state ? `${progress.toFixed(2)}%` : "Loading"}</strong>
            <small>
              {state
                ? `${tokenAmount(state.sale.sold)} RDAO sold`
                : "Live state"}
            </small>
          </div>
          <div>
            <span>Current price</span>
            <strong>
              {state
                ? `${ethAmount(state.sale.currentPriceE18, 9)} ETH`
                : "Loading"}
            </strong>
            <small>Per RDAO on the curve</small>
          </div>
          <div>
            <span>Curve funded</span>
            <strong>
              {state
                ? `${ethAmount(state.sale.curvePrincipal, 4)} ETH`
                : "Loading"}
            </strong>
            <small>
              {state
                ? `of ${ethAmount(state.sale.curvePrincipalTarget, 2)} ETH`
                : unavailable
                  ? "Temporarily unavailable"
                  : "Reading contract"}
            </small>
          </div>
        </div>
        <Link className="button primary" href="/rdao#rdao-market">
          View RDAO and join the sale
        </Link>
      </div>
    </section>
  );
}

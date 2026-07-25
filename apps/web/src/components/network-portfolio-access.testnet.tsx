"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Deployment } from "@/lib/deployment";
import { resolvePortfolioAccess } from "@/lib/portfolio-access-policy";
import { useRobynTestnetWallet } from "./robyn-testnet-wallet";

export const PORTFOLIO_UAT_STORAGE_KEY = "sherwood-browser-uat-wallet";
export const PORTFOLIO_UAT_EVENT = "sherwood-portfolio-uat-change";

export function NetworkPortfolioNavigation({
  deployment,
}: {
  deployment: Deployment;
}) {
  const { account } = useRobynTestnetWallet();
  const [requestedUatAddress, setRequestedUatAddress] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const read = () =>
      setRequestedUatAddress(
        window.sessionStorage.getItem(PORTFOLIO_UAT_STORAGE_KEY),
      );
    const query = new URLSearchParams(window.location.search);
    const requested = query.get("uatWallet");
    if (
      requested &&
      deployment.deployer &&
      requested.toLowerCase() === deployment.deployer.toLowerCase()
    ) {
      window.sessionStorage.setItem(PORTFOLIO_UAT_STORAGE_KEY, requested);
      query.delete("uatWallet");
      const cleaned = `${window.location.pathname}${query.size ? `?${query}` : ""}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", cleaned);
    }
    read();
    window.addEventListener(PORTFOLIO_UAT_EVENT, read);
    return () => window.removeEventListener(PORTFOLIO_UAT_EVENT, read);
  }, [deployment.deployer]);

  const access = resolvePortfolioAccess(
    account,
    deployment.deployer,
    requestedUatAddress,
  );
  if (!access.href) return null;
  return (
    <Link
      href={access.href}
      data-testid="portfolio-navigation"
      data-access-mode={access.mode}
      title={
        access.mode === "uat-read-only"
          ? "Read-only browser UAT portfolio"
          : undefined
      }
    >
      Portfolio
    </Link>
  );
}

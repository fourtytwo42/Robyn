"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Deployment } from "@/lib/deployment";

export function NetworkPortfolioNavigation({
  deployment,
}: {
  deployment: Deployment;
}) {
  void deployment;
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const read = () =>
      setAvailable(
        Boolean(window.sessionStorage.getItem("robyn-devnet-session-key")),
      );
    read();
    window.addEventListener("robyn-wallet-change", read);
    return () => window.removeEventListener("robyn-wallet-change", read);
  }, []);
  return available ? <Link href="/portfolio">Portfolio</Link> : null;
}

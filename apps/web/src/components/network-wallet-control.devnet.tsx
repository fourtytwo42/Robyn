"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

function readAddress() {
  try {
    return sessionStorage.getItem("robyn-devnet-session-address");
  } catch {
    return null;
  }
}

export function NetworkWalletControl() {
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setAddress(readAddress());
    refresh();
    window.addEventListener("robyn-wallet-change", refresh);
    return () => window.removeEventListener("robyn-wallet-change", refresh);
  }, []);
  return (
    <Link
      className="wallet-control connected devnet-wallet"
      href="/#devnet-console"
    >
      <span className="wallet-identicon" aria-hidden="true" />
      <span>
        {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Dev wallet"}
      </span>
      <small>Session wallet</small>
    </Link>
  );
}

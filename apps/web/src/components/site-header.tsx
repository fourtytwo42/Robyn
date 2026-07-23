import Image from "next/image";
import Link from "next/link";
import { MarketTape } from "@/components/market-tape";
import { NetworkWalletControl } from "@robyn/network-wallet-control";

export function SiteHeader() {
  const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";
  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Robyn home">
          <span className="brand-mark" aria-hidden="true">
            <Image
              src="/assets/brand/robyn-logo.webp"
              alt=""
              width={32}
              height={32}
              priority
            />
          </span>
          <span>ROBYN</span>
        </Link>
        <nav className="site-nav" aria-label="Primary navigation">
          <Link href="/discover">Markets</Link>
          <Link href="/portfolio">Portfolio</Link>
          <Link href="/dao">DAO</Link>
          <Link href="/create">Create</Link>
        </nav>
        <div className="header-actions">
          <span className="network-pill" data-testid="network-status">
            <span className="status-dot" aria-hidden="true" />
            {isTestnet ? "Robinhood Testnet" : "Local devnet"}
          </span>
          {isTestnet ? (
            <a
              className="header-faucet-link"
              href="https://faucet.testnet.chain.robinhood.com"
              target="_blank"
              rel="noreferrer"
            >
              Get test ETH
            </a>
          ) : null}
          <NetworkWalletControl />
          <Link className="button primary header-launch-button" href="/create">
            Launch a token
          </Link>
        </div>
      </header>
      <MarketTape />
    </>
  );
}

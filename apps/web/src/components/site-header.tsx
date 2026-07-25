import Image from "next/image";
import Link from "next/link";
import deployment from "@robyn/deployment";
import { NetworkDaoNavigation } from "@robyn/network-dao-access";
import { MarketTape } from "@/components/market-tape";
import { LaunchTokenTrigger } from "@/components/launch-token-trigger";
import { NetworkWalletControl } from "@robyn/network-wallet-control";

export function SiteHeader() {
  const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";
  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Sherwood Forest home">
          <span className="brand-mark" aria-hidden="true">
            <Image
              src="/assets/brand/sherwood-mark.webp"
              alt=""
              width={32}
              height={32}
              priority
            />
          </span>
          <span>SHERWOOD FOREST</span>
        </Link>
        <nav className="site-nav" aria-label="Primary navigation">
          <Link href="/discover">Markets</Link>
          <Link href="/portfolio">Portfolio</Link>
          <NetworkDaoNavigation deployment={deployment} />
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
          <LaunchTokenTrigger className="button primary header-launch-button">
            Launch a token
          </LaunchTokenTrigger>
        </div>
      </header>
      <MarketTape />
    </>
  );
}

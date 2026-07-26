import Image from "next/image";
import Link from "next/link";
import deployment from "@robyn/deployment";
import { NetworkDaoNavigation } from "@robyn/network-dao-access";
import { NetworkPortfolioNavigation } from "@robyn/network-portfolio-access";
import { MarketTape } from "@/components/market-tape";
import { LaunchTokenTrigger } from "@/components/launch-token-trigger";
import { NetworkWalletControl } from "@robyn/network-wallet-control";
import { publicEnvironment } from "@/lib/public-environment";

export function SiteHeader() {
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
          <Link href="/whitepaper">Whitepaper</Link>
          <LaunchTokenTrigger className="site-nav-action">
            Create token
          </LaunchTokenTrigger>
          {publicEnvironment.faucetUrl ? (
            <a
              href={publicEnvironment.faucetUrl}
              target="_blank"
              rel="noreferrer"
            >
              Faucet
            </a>
          ) : null}
          <NetworkPortfolioNavigation deployment={deployment} />
          <NetworkDaoNavigation deployment={deployment} />
        </nav>
        <div className="header-actions">
          <span className="network-pill" data-testid="network-status">
            <span className="status-dot" aria-hidden="true" />
            {publicEnvironment.networkLabel}
          </span>
          <NetworkWalletControl />
        </div>
      </header>
      <MarketTape />
    </>
  );
}

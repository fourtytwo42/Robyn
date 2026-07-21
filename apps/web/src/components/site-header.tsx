import Image from "next/image";
import Link from "next/link";

export function SiteHeader() {
  const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";
  return (
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
        <Link href="/discover">Discover</Link>
        <Link href="/portfolio">Portfolio</Link>
        <Link href="/create">Create</Link>
      </nav>
      <span className="network-pill" data-testid="network-status">
        <span className="status-dot" aria-hidden="true" />
        {isTestnet ? "Robinhood Testnet" : "Controlled development network"}
      </span>
    </header>
  );
}

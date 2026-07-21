import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Robyn home">
        <span className="brand-mark" aria-hidden="true">
          R
        </span>
        <span>ROBYN</span>
      </Link>
      <nav className="site-nav" aria-label="Primary navigation">
        <Link href="/discover">Discover</Link>
        <Link href="/portfolio">Portfolio</Link>
        <Link href="/#devnet-console">Create</Link>
      </nav>
      <span className="network-pill" data-testid="network-status">
        <span className="status-dot" aria-hidden="true" />
        Controlled devnet
      </span>
    </header>
  );
}

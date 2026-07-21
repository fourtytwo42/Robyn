import { PortfolioView } from "@/components/portfolio-view";
import { SiteHeader } from "@/components/site-header";

export default function Portfolio() {
  return (
    <main id="main">
      <div className="ambient ambient-left" aria-hidden="true" />
      <SiteHeader />
      <section className="page-shell">
        <header className="page-hero">
          <p className="eyebrow">Wallet-specific state</p>
          <h1>Your rewards across every launch.</h1>
          <p className="lede">
            Held community tokens, pending launch-level cash, claimable assets
            and claimed amounts remain separate. No wallet data is sent to the
            indexer; routine reads use this browser&apos;s public RPC path.
          </p>
        </header>
        <PortfolioView />
      </section>
      <section className="notice" aria-label="Portfolio disclosure">
        Values are token amounts from the controlled development chain. No fiat
        estimate, promised return or redemption claim is shown.
      </section>
    </main>
  );
}

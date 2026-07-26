import { NetworkPortfolioView } from "@robyn/network-portfolio";
import { NetworkCreatorPortfolio } from "@robyn/network-creator-portfolio";
import { SiteHeader } from "@/components/site-header";

export default function Portfolio() {
  const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";
  return (
    <main id="main">
      <div className="ambient ambient-left" aria-hidden="true" />
      <SiteHeader />
      <section className="page-shell">
        <header className="page-hero">
          <p className="eyebrow">Your grove</p>
          <h1>Everything you hold and grow, in one place.</h1>
          <p className="lede">
            Track the tokens and basket rewards you hold, then tend every token
            you planted and harvest its independent creator fees from one wallet
            dashboard.
          </p>
        </header>
        <NetworkCreatorPortfolio />
        <NetworkPortfolioView />
      </section>
      <section className="notice" aria-label="Portfolio disclosure">
        {isTestnet
          ? "Values are token amounts from Robinhood Chain Testnet assets with no real-world value or production backing. No fiat estimate, promised return or redemption claim is shown."
          : "Values are token amounts from the controlled development chain. No fiat estimate, promised return or redemption claim is shown."}
      </section>
    </main>
  );
}

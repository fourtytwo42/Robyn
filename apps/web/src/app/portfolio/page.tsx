import { NetworkPortfolioView } from "@robyn/network-portfolio";
import { NetworkCreatorPortfolio } from "@robyn/network-creator-portfolio";
import { SiteHeader } from "@/components/site-header";
import { publicEnvironment } from "@/lib/public-environment";

export default function Portfolio() {
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
        {publicEnvironment.isMainnet
          ? "Values are onchain token amounts, not promised returns or redemption claims. Prices, liquidity and reward values can change."
          : publicEnvironment.isTestnet
            ? "Values are token amounts from Robinhood Chain Testnet assets with no real-world value or production backing. No fiat estimate, promised return or redemption claim is shown."
            : "Values are token amounts from the controlled development chain. No fiat estimate, promised return or redemption claim is shown."}
      </section>
    </main>
  );
}

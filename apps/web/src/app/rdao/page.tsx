import type { Metadata } from "next";
import deployment from "@robyn/deployment";
import { NetworkDaoView } from "@robyn/network-dao";
import { RdaoSaleSpotlight } from "@/components/rdao-sale-spotlight";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "RDAO Token and Public Sale | Sherwood Forest",
  description:
    "Explore the public RDAO bonding sale, staking rewards, and Sherwood Forest governance.",
};

export default function RdaoPage() {
  return (
    <main id="main" className="rdao-token-page">
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />
      <SiteHeader />

      <RdaoSaleSpotlight variant="page" />

      <section
        id="rdao-market"
        className="rdao-public-workspace"
        aria-labelledby="rdao-market-heading"
      >
        <header className="rdao-public-heading">
          <div>
            <p className="eyebrow">Live RDAO market</p>
            <h2 id="rdao-market-heading">Buy, stake, earn, and govern.</h2>
          </div>
          <p>
            Reading the sale never requires a wallet. Connect any Devnet wallet
            to buy; existing RDAO is required only for selling, staking,
            rewards, and governance actions.
          </p>
        </header>
        <NetworkDaoView deployment={deployment} />
      </section>
    </main>
  );
}

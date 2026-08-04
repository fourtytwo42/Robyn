import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import deployment from "@robyn/deployment";
import { NetworkDaoView } from "@robyn/network-dao";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "RDAO Public Bonding Market | Sherwood Forest",
  description:
    "Follow the live RDAO bonding curve and join Sherwood Forest's public token sale.",
};

function short(address: string) {
  return `${address.slice(0, 7)}…${address.slice(-5)}`;
}

export default function RdaoPage() {
  const token = deployment.contracts.daoToken;
  return (
    <main id="main" className="rdao-token-page">
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />
      <SiteHeader />

      <section className="page-shell token-page-shell">
        <nav className="token-breadcrumb" aria-label="Breadcrumb">
          <Link href="/discover">Markets</Link>
          <span>/</span>
          <span>$RDAO</span>
        </nav>

        <header className="token-overview-card rdao-overview-card">
          <div className="token-overview-identity">
            <Image
              src="/assets/brand/rdao-token.webp"
              alt="RDAO token artwork"
              width={132}
              height={132}
              className="detail-token-art rdao-token-art"
              priority
            />
            <div className="token-identity-copy">
              <div className="token-title-line">
                <p className="eyebrow">Sherwood&apos;s governance token</p>
                <span className="live-chip">Public bonding</span>
                <span className="campaign-test-chip">Schema-20 Devnet</span>
              </div>
              <h1>
                Robyn DAO <span>$RDAO</span>
              </h1>
              <p className="rdao-token-summary">
                Join the public sale on a transparent bonding curve. At
                graduation, 50 million RDAO and the paired ETH become
                permanently locked v4 liquidity.
              </p>
              <div className="identity-links">
                <code>{short(token)}</code>
                <span>Fixed 1 billion supply</span>
                <span>20% sale and liquidity allocation</span>
              </div>
              <div
                className="token-basket-preview rdao-overview-chips"
                aria-label="RDAO market facts"
              >
                <span>150m public sale</span>
                <span>50m locked liquidity</span>
                <span>1% bonding fee</span>
              </div>
            </div>
            <div
              className="token-actions rdao-token-actions"
              aria-label="RDAO actions"
            >
              <a className="button primary" href="#rdao-market">
                Trade RDAO
              </a>
              <Link className="button" href="/dao">
                DAO workspace
              </Link>
            </div>
          </div>
        </header>

        <section id="rdao-market" aria-label="RDAO public market">
          <NetworkDaoView deployment={deployment} surface="market" />
        </section>
      </section>
    </main>
  );
}

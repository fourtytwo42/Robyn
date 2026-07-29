import Image from "next/image";
import deployment from "@robyn/deployment";
import { NetworkDaoView } from "@robyn/network-dao";
import { NetworkDaoAccessGate } from "@robyn/network-dao-access";
import { SiteHeader } from "@/components/site-header";

export default function DaoPage() {
  return (
    <main id="main">
      <div className="ambient ambient-left" aria-hidden="true" />
      <SiteHeader />
      <NetworkDaoAccessGate deployment={deployment}>
        <section className="page-shell dao-page">
          <header className="page-hero dao-hero">
            <Image
              className="dao-token-image"
              src="/assets/brand/rdao-token.webp"
              alt="Robyn DAO token"
              width={144}
              height={144}
              priority
            />
            <div>
              <p className="eyebrow">Sherwood Forest DAO</p>
              <h1>Earn protocol ETH. Govern what Sherwood Forest becomes.</h1>
              <p className="lede">
                DAO members share 20% of every launch&apos;s fees and direct the
                timelocked treasury. Token-specific reward baskets and creator
                promises remain immutable.
              </p>
            </div>
          </header>
          <NetworkDaoView deployment={deployment} />
        </section>
      </NetworkDaoAccessGate>
    </main>
  );
}

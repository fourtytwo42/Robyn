import deployment from "@robyn/deployment";
import { NetworkDaoView } from "@robyn/network-dao";
import { SiteHeader } from "@/components/site-header";

export default function DaoPage() {
  return (
    <main id="main">
      <div className="ambient ambient-left" aria-hidden="true" />
      <SiteHeader />
      <section className="page-shell dao-page">
        <header className="page-hero dao-hero">
          <p className="eyebrow">Robyn DAO · RDAO</p>
          <h1>Earn protocol ETH. Govern what Robyn becomes.</h1>
          <p className="lede">
            RDAO holders share 20% of every launch&apos;s fees and direct the
            timelocked treasury. Token-specific reward baskets and creator
            promises remain immutable.
          </p>
        </header>
        <NetworkDaoView deployment={deployment} />
      </section>
    </main>
  );
}

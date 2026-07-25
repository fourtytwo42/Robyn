import { notFound } from "next/navigation";
import { getAddress, isAddress, type Address } from "viem";
import { NetworkPortfolioView } from "@robyn/network-portfolio";
import { NetworkCreatorPortfolio } from "@robyn/network-creator-portfolio";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export default async function PublicUserPortfolio({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: rawAddress } = await params;
  if (!isAddress(rawAddress)) notFound();
  const address = getAddress(rawAddress) as Address;

  return (
    <main id="main">
      <div className="ambient ambient-left" aria-hidden="true" />
      <SiteHeader />
      <section className="page-shell">
        <header className="page-hero">
          <p className="eyebrow">Public onchain profile</p>
          <h1>Sherwood Forest user portfolio.</h1>
          <p className="lede">
            Created tokens, launch-token holdings, basket rewards, and public
            profile information for this wallet.
          </p>
          <code>{address}</code>
        </header>
        <NetworkCreatorPortfolio account={address} readOnly />
        <NetworkPortfolioView account={address} readOnly />
      </section>
      <section className="notice" aria-label="Public portfolio disclosure">
        This read-only page contains public blockchain and creator-profile data.
        It does not prove the wallet owner&apos;s offchain identity or grant any
        claim, profile-editing, or transaction authority.
      </section>
    </main>
  );
}

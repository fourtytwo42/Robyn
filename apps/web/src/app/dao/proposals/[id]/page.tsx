import deployment from "@robyn/deployment";
import { NetworkDaoView } from "@robyn/network-dao";
import { NetworkDaoAccessGate } from "@robyn/network-dao-access";
import { SiteHeader } from "@/components/site-header";

export default async function DaoProposalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main id="main">
      <SiteHeader />
      <NetworkDaoAccessGate deployment={deployment}>
        <section className="page-shell dao-page">
          <header className="page-hero compact">
            <p className="eyebrow">Onchain proposal #{id}</p>
            <h1>Proposal record and member controls.</h1>
          </header>
          <NetworkDaoView deployment={deployment} proposalId={id} />
        </section>
      </NetworkDaoAccessGate>
    </main>
  );
}

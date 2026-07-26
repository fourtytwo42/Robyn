import { AdminHealthDashboard } from "@/components/admin-health-dashboard";
import { SiteHeader } from "@/components/site-header";
import { getAdminHealthSnapshot } from "@/lib/admin-health";

export const dynamic = "force-dynamic";

export default async function AdminHealthPage() {
  const snapshot = await getAdminHealthSnapshot();
  return (
    <main id="main">
      <div className="ambient ambient-left" aria-hidden="true" />
      <SiteHeader />
      <section className="page-shell admin-health-shell">
        <header className="page-hero">
          <p className="eyebrow">Unlinked operator view</p>
          <h1>Application health and chain status.</h1>
          <p className="lede">
            Live, read-only diagnostics for the public release, configured RPC,
            canonical ingestion, launch projection, keeper, and artifact
            services.
          </p>
        </header>
        <AdminHealthDashboard initial={snapshot} />
      </section>
    </main>
  );
}

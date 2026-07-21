import {
  foundationChecks,
  getGatewayHealth,
  getHealthStatus,
} from "@/lib/health";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home() {
  const gateway = await getGatewayHealth();
  const health = getHealthStatus();

  return (
    <main id="main">
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Robyn home">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <span>ROBYN</span>
        </Link>
        <span className="network-pill" data-testid="network-status">
          <span className="status-dot" aria-hidden="true" />
          Controlled devnet
        </span>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Foundation checkpoint 01</p>
        <h1 id="page-title">The launchpad foundation is online.</h1>
        <p className="lede">
          Robyn turns creator trading fees into transparent, weighted asset
          rewards. This page confirms the VM-hosted application foundation
          before financial journeys are introduced.
        </p>

        <div className="health-card" aria-labelledby="health-heading">
          <div>
            <p className="card-label">System status</p>
            <h2 id="health-heading">Ready for the next build slice</h2>
          </div>
          <span className="health-badge">{health.status}</span>
          <dl>
            <div>
              <dt>Service</dt>
              <dd>{health.service}</dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>{health.environment}</dd>
            </div>
          </dl>
          <div>
            <dt>RPC gateway</dt>
            <dd data-testid="rpc-status">
              {gateway.status} · chain {gateway.chainId}
            </dd>
          </div>
        </div>
        <ul className="check-grid" aria-label="Foundation checks">
          {foundationChecks.map((check, index) => (
            <li key={check}>
              <span className="check-index">0{index + 1}</span>
              <span>{check}</span>
              <span className="check-state">Verified</span>
            </li>
          ))}
        </ul>

        <p className="notice">
          Development network only. No real assets or financial value.
        </p>
      </section>
    </main>
  );
}

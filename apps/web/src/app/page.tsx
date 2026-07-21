import { DevnetConsole, type Deployment } from "@/components/devnet-console";
import { LaunchpadConsole } from "@/components/launchpad-console";
import {
  getDataPlaneHealth,
  getGatewayHealth,
  getHealthStatus,
} from "@/lib/health";
import Link from "next/link";
import deployment from "../../../../deployments/31337.json";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [gateway, dataPlane] = await Promise.all([
    getGatewayHealth(),
    getDataPlaneHealth(),
  ]);
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

      <section className="product-hero" aria-labelledby="hero-heading">
        <div className="hero-copy">
          <p className="eyebrow">Programmable creator fees</p>
          <h1 id="hero-heading">
            Trade a token. Build a basket. Share the upside.
          </h1>
          <p className="lede">
            Robyn turns market fees into an immutable mix of mock tokenized
            assets, then distributes the resulting rewards to eligible token
            holders.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#devnet-console">
              Try the live flow
            </a>
            <span>
              Permissionless launch architecture · controlled local chain
            </span>
          </div>
        </div>
        <aside className="basket-preview" aria-label="Genesis basket preview">
          <div className="basket-ring" aria-hidden="true">
            <span>100%</span>
            <small>allocated</small>
          </div>
          <div>
            <p className="card-label">Genesis basket</p>
            <ul>
              <li>
                <span className="swatch nvda" />
                Mock NVIDIA <strong>40%</strong>
              </li>
              <li>
                <span className="swatch cash" />
                Mock Cash App <strong>40%</strong>
              </li>
              <li>
                <span className="swatch spx" />
                Mock S&amp;P 500 <strong>20%</strong>
              </li>
            </ul>
          </div>
        </aside>
      </section>

      <section className="system-strip" aria-label="System status">
        <div>
          <span className="status-dot" />
          Web <strong>{health.status}</strong>
        </div>
        <div data-testid="rpc-status">
          <span className="status-dot" />
          RPC <strong>{gateway.status}</strong>
        </div>
        <div>
          Chain <strong>{gateway.chainId}</strong>
        </div>
        <div data-testid="indexer-status">
          Indexer{" "}
          <strong>
            {dataPlane.status} · block {dataPlane.asOfBlock ?? "unavailable"}
          </strong>
        </div>
        <div data-testid="keeper-status">
          Keeper <strong>{dataPlane.keeperStatus}</strong>
        </div>
        <div data-testid="artifact-status">
          Artifacts <strong>{dataPlane.artifactStatus}</strong>
        </div>
      </section>

      <LaunchpadConsole deployment={deployment as Deployment} />
      <DevnetConsole deployment={deployment as Deployment} />

      <section className="notice" aria-label="Development disclaimer">
        Development network only. Every asset is a mock with no real-world
        value. This environment is built to prove the full protocol workflow
        before Robinhood Chain testnet deployment.
      </section>
    </main>
  );
}

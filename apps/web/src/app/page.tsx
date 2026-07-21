import type { Deployment } from "@/lib/deployment";
import { NetworkConsole } from "@robyn/network-console";
import { NetworkLaunchpadConsole } from "@robyn/network-launchpad";
import { SiteHeader } from "@/components/site-header";
import {
  getDataPlaneHealth,
  getGatewayHealth,
  getHealthStatus,
} from "@/lib/health";
import deployment from "@robyn/deployment";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [gateway, dataPlane] = await Promise.all([
    getGatewayHealth(),
    getDataPlaneHealth(),
  ]);
  const health = getHealthStatus();
  const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";

  return (
    <main id="main">
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />
      <SiteHeader />

      <section className="product-hero" aria-labelledby="hero-heading">
        <div className="hero-copy">
          <p className="eyebrow">Programmable creator fees</p>
          <h1 id="hero-heading">
            Trade a token. Build a basket. Share the upside.
          </h1>
          <p className="lede">
            Robyn turns market fees into an immutable mix of{" "}
            {isTestnet ? "testnet mock" : "mock"} tokenized assets, then
            distributes the resulting rewards to eligible token holders.
          </p>
          <div className="hero-actions">
            <a
              className="button primary"
              href={isTestnet ? "#testnet-console" : "#devnet-console"}
            >
              Try the live flow
            </a>
            <span>
              Permissionless launch architecture ·{" "}
              {isTestnet ? "Robinhood Chain Testnet" : "controlled local chain"}
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
                {isTestnet ? "Testnet mock NVIDIA" : "Mock NVIDIA"}{" "}
                <strong>40%</strong>
              </li>
              <li>
                <span className="swatch cash" />
                {isTestnet ? "Testnet mock S&P 500" : "Mock S&P 500"}{" "}
                <strong>40%</strong>
              </li>
              <li>
                <span className="swatch spx" />
                {isTestnet ? "Testnet mock Ether" : "Mock Ether"}{" "}
                <strong>20%</strong>
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

      {isTestnet ? (
        <>
          <NetworkConsole deployment={deployment as Deployment} />
          <NetworkLaunchpadConsole deployment={deployment as Deployment} />
        </>
      ) : (
        <>
          <NetworkLaunchpadConsole deployment={deployment as Deployment} />
          <NetworkConsole deployment={deployment as Deployment} />
        </>
      )}

      <section className="notice" aria-label="Development disclaimer">
        {isTestnet
          ? "Robinhood Chain Testnet only. Every displayed basket asset is a project-owned mock with no real-world value."
          : "Development network only. Every asset is a mock with no real-world value. This environment proves the full protocol workflow before testnet deployment."}
      </section>
    </main>
  );
}

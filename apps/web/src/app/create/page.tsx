import type { Deployment } from "@/lib/deployment";
import { NetworkLaunchpadConsole } from "@robyn/network-launchpad";
import { SiteHeader } from "@/components/site-header";
import deployment from "@robyn/deployment";

export const dynamic = "force-dynamic";

export default function CreateLaunch() {
  const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";

  return (
    <main id="main">
      <div className="ambient ambient-right" aria-hidden="true" />
      <SiteHeader />
      <NetworkLaunchpadConsole
        deployment={deployment as Deployment}
        openByDefault
        showRegistry={false}
      />
      <section className="notice" aria-label="Network disclaimer">
        {isTestnet
          ? "Robinhood Chain Testnet only. Project-owned mock assets have no real-world value."
          : "Controlled development network only. Every asset is a mock with no real-world value."}
      </section>
    </main>
  );
}

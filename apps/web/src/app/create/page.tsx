import type { Deployment } from "@/lib/deployment";
import { NetworkLaunchpadConsole } from "@robyn/network-launchpad";
import { SiteHeader } from "@/components/site-header";
import deployment from "@robyn/deployment";

export const dynamic = "force-dynamic";

export default function CreateLaunch() {
  return (
    <main id="main">
      <div className="ambient ambient-right" aria-hidden="true" />
      <SiteHeader />
      <NetworkLaunchpadConsole
        deployment={deployment as Deployment}
        openByDefault
        showRegistry={false}
        modalOnly
      />
    </main>
  );
}

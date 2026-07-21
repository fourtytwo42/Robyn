import type { Deployment } from "@/lib/deployment";
import { NetworkLaunchpadConsole } from "@robyn/network-launchpad";
import { NetworkConsole } from "@robyn/network-console";
import { SiteHeader } from "@/components/site-header";
import { TokenArt } from "@/components/launchpad-visuals";
import deployment from "@robyn/deployment";

export const dynamic = "force-dynamic";

export default function CreateLaunch() {
  const isTestnet = process.env.ROBYN_NETWORK_MODE === "testnet";

  return (
    <main id="main">
      <div className="ambient ambient-right" aria-hidden="true" />
      <SiteHeader />
      <section className="create-hero" aria-labelledby="create-heading">
        <div>
          <p className="eyebrow">Create on Robyn</p>
          <h1 id="create-heading">
            Launch a token with its own reward basket.
          </h1>
          <p className="lede">
            Choose the stock and crypto rewards holders can earn. Trading fees
            automatically build the basket, and its selected weights cannot be
            changed after launch.
          </p>
          <div className="create-steps" aria-label="Launch steps">
            <span>
              <b>01</b> Token
            </span>
            <span>
              <b>02</b> Basket
            </span>
            <span>
              <b>03</b> Launch
            </span>
          </div>
        </div>
        <TokenArt
          symbol="MYCO"
          alt="Example community token artwork"
          priority
        />
      </section>
      <NetworkLaunchpadConsole deployment={deployment as Deployment} />
      <NetworkConsole deployment={deployment as Deployment} />
      <section className="notice" aria-label="Network disclaimer">
        {isTestnet
          ? "Robinhood Chain Testnet only. Project-owned mock assets have no real-world value."
          : "Controlled development network only. Every asset is a mock with no real-world value."}
      </section>
    </main>
  );
}

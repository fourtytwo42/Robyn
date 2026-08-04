import Link from "next/link";
import { LaunchTokenTrigger } from "@/components/launch-token-trigger";
import { SiteHeader } from "@/components/site-header";
import { publicEnvironment } from "@/lib/public-environment";

export const metadata = {
  title: "For creators | Sherwood Forest",
  description:
    "Build a fixed-supply token whose activity grows an immutable reward basket.",
};

export default function CreatorsPage() {
  return (
    <main id="main" className="marketing-page">
      <div className="ambient ambient-left" aria-hidden="true" />
      <SiteHeader />
      <section className="marketing-hero creator-hero">
        <div>
          <p className="eyebrow">For creators</p>
          <h1>Launch a market people can understand.</h1>
          <p className="lede">
            Choose the identity. Choose up to three reward assets. The basket,
            weights, and fixed token supply are visible before the first trade
            and cannot be quietly rewritten later.
          </p>
          <div className="hero-actions">
            <LaunchTokenTrigger className="button primary">
              Launch a token
            </LaunchTokenTrigger>
            <Link className="button ghost" href="/discover">
              Study live markets
            </Link>
          </div>
          {publicEnvironment.isDevnet ? (
            <p className="fixture-note">
              Devnet only · testing assets and transactions have no real-world
              value.
            </p>
          ) : null}
        </div>
        <aside className="creator-offer-card">
          <span>Creator share</span>
          <strong>25%</strong>
          <p>
            of applicable protocol fees, assigned onchain and claimed by the
            configured recipient.
          </p>
        </aside>
      </section>

      <section
        className="creator-steps"
        aria-labelledby="creator-steps-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">From idea to open market</p>
            <h2 id="creator-steps-heading">Four deliberate steps.</h2>
          </div>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <h3>Give it an identity</h3>
              <p>
                Add a name, symbol, artwork, description, website, and social
                links. The public profile stays connected to the canonical
                token.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Choose the reward roots</h3>
              <p>
                Select up to three supported assets and lock their weights.
                Every holder sees the same immutable basket.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Grow through bonding</h3>
              <p>
                Buys and sells follow a visible curve. There is no hidden
                creator token allocation and no promise that the market will
                graduate.
              </p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>Graduate into locked liquidity</h3>
              <p>
                When the threshold is reached, the token moves to its configured
                pool and the launch liquidity principal remains permanently
                locked.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="creator-grid">
        <article className="marketing-card highlight">
          <p className="eyebrow">Creator rewards</p>
          <h2>Assigned, not improvised.</h2>
          <p>
            The creator recipient receives the immutable 25% share through pull
            claims. Recipient changes and split locking follow the public
            contract rules; nobody needs to push payouts to every wallet.
          </p>
        </article>
        <article className="marketing-card">
          <p className="eyebrow">Discovery</p>
          <h2>A place in the forest.</h2>
          <p>
            Every launch enters the shared market catalog. Sustained progress
            and distinct traders can earn the onchain King of the Forest crown.
          </p>
        </article>
        <article className="marketing-card risk-card">
          <p className="eyebrow">What is not promised</p>
          <h2>Attention must be earned.</h2>
          <p>
            A launch is not guaranteed activity, graduation, liquidity, rewards,
            income, or a lasting market. Smart-contract and market risks remain.
          </p>
          <Link className="text-link" href="/security">
            Read security and risks →
          </Link>
        </article>
      </section>

      <section className="marketing-cta">
        <div>
          <p className="eyebrow">Ready to plant?</p>
          <h2>Make the basket as clear as the story.</h2>
        </div>
        <LaunchTokenTrigger className="button primary">
          Launch a token
        </LaunchTokenTrigger>
      </section>
    </main>
  );
}

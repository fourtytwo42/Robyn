import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { MarketingFilm } from "@/components/marketing-film";

export const metadata = {
  title: "The Sherwood story | Devnet product demo",
  description:
    "A three-minute, transaction-backed Devnet demonstration of Sherwood Forest.",
};

export default function DemoPage() {
  return (
    <main id="main" className="marketing-page demo-page">
      <SiteHeader />
      <section className="demo-intro">
        <p className="eyebrow">Devnet demonstration · no real-world value</p>
        <h1>From a trade to a living reward basket.</h1>
        <p>
          This film uses deterministic testing fixtures and real Devnet
          receipts. Waiting periods are shown honestly; matured positions were
          prepared before recording.
        </p>
        <a
          className="text-link"
          href="/media/sherwood-story-media-manifest.json"
        >
          Inspect the media and transaction manifest →
        </a>
      </section>
      <MarketingFilm />
      <section
        id="transcript"
        className="film-transcript"
        aria-labelledby="transcript-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Accessible transcript</p>
            <h2 id="transcript-heading">The Sherwood story</h2>
          </div>
          <a
            className="text-link"
            href="/media/sherwood-story-devnet.vtt"
            download
          >
            Download captions
          </a>
        </div>
        <div className="transcript-copy">
          <article>
            <time>0:00–0:12</time>
            <p>
              In every market, a community gathers around a story. Sherwood
              Forest gives that story roots.
            </p>
          </article>
          <article>
            <time>0:12–0:42</time>
            <p>
              Start in the market grove. Every token shows its price, activity,
              ownership, and immutable reward basket before you trade. Choose
              the community you believe in, inspect the assets its market can
              grow, and enter with a bounded quote you can verify before
              signing.
            </p>
          </article>
          <article>
            <time>0:42–1:08</time>
            <p>
              When this Devnet trade confirms, ownership updates onchain. The
              transaction succeeds on its own terms. Then, as a best-effort
              second step, the protocol advances one piece of that token&apos;s
              maintenance work.
            </p>
          </article>
          <article>
            <time>1:08–1:35</time>
            <p>
              Every fee is assigned before anything external happens. Fifty
              percent belongs to holder baskets. Twenty-five percent belongs to
              the creator. Twenty percent flows to eligible RDAO stakers. Five
              percent belongs to the governed treasury. A delayed conversion
              cannot silently change those shares. As activity continues, each
              healthy basket leg converts independently. Purchased assets are
              held for that launch and streamed to eligible holders. Claims pull
              already-accounted rewards from custody; they do not sell the token
              and buy the basket at withdrawal.
            </p>
          </article>
          <article>
            <time>1:35–2:02</time>
            <p>
              Creators begin with one guided launch. Name the token, publish its
              media and links, and choose up to three supported reward assets.
              Supply, basket weights, fee rules, and creator identity take root
              together. There is no hidden creator token allocation.
            </p>
          </article>
          <article>
            <time>2:02–2:25</time>
            <p>
              The market begins on a transparent bonding curve. When it
              graduates, reserved tokens and collected principal seed its
              open-market pool. The liquidity position is locked, while the
              creator&apos;s fee share remains claimable through its declared
              recipient split.
            </p>
          </article>
          <article>
            <time>2:25–2:45</time>
            <p>
              The forest also has a common token. RDAO begins with a disclosed
              bonding sale and locked-liquidity allocation. Stake it after the
              twenty-four-hour warm-up to share in WETH rewards, while one token
              remains one vote. Governance keeps its quorum, proposal threshold,
              vote, and Timelock visible.
            </p>
          </article>
          <article>
            <time>2:45–3:00</time>
            <p>
              Markets can be volatile. Routes can pause. Smart contracts and
              chains carry risk. Sherwood does not promise profit, graduation,
              liquidity, or rewards. It promises rules you can inspect,
              accounting you can follow, and emergency controls you can see.
              Explore the markets. Plant a token. Devnet demonstration only.
              These assets and transactions have no real-world value.
            </p>
          </article>
        </div>
      </section>
      <section className="marketing-cta">
        <div>
          <p className="eyebrow">Choose your path</p>
          <h2>Explore a market or plant one.</h2>
        </div>
        <div className="hero-actions">
          <Link className="button primary" href="/discover">
            Explore markets
          </Link>
          <Link className="button ghost" href="/creators">
            Why launch here?
          </Link>
        </div>
      </section>
    </main>
  );
}

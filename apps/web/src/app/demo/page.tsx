import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { MarketingFilm } from "@/components/marketing-film";

export const metadata = {
  title: "The Sherwood story | Sherwood Forest",
  description:
    "See how Sherwood Forest turns token markets into communities that can trade, launch, earn, and govern together.",
};

export default function DemoPage() {
  return (
    <main id="main" className="marketing-page demo-page">
      <SiteHeader />
      <section className="demo-intro">
        <p className="eyebrow">The Sherwood story</p>
        <h1>A launchpad where every market can grow more.</h1>
        <p>
          Trade the communities you believe in. Share in what their activity
          creates. Or launch the next story everyone wants to join.
        </p>
        <p className="marketing-disclosure">
          This preview uses testing fixtures with no real-world value.
        </p>
        <a
          className="text-link"
          href="/media/sherwood-sizzle-media-manifest.json"
        >
          View film credits and technical details →
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
            href="/media/sherwood-sizzle.vtt"
            download
          >
            Download captions
          </a>
        </div>
        <div className="transcript-copy">
          <article>
            <time>0:00–0:05</time>
            <p>
              Welcome to Sherwood Forest, where a token can become more than a
              ticker.
            </p>
          </article>
          <article>
            <time>0:05–0:10</time>
            <p>Find a community. Follow the story. Make your move.</p>
          </article>
          <article>
            <time>0:10–0:15</time>
            <p>
              Every trade helps the market grow. A share of the fees can build
              a reward basket chosen when the token is created.
            </p>
          </article>
          <article>
            <time>0:15–0:22</time>
            <p>
              Holders can claim what they earn. Creators can build a following
              and share in the success they help create.
            </p>
          </article>
          <article>
            <time>0:22–0:32</time>
            <p>
              Launching is simple. Pick a name. Add your look. Choose up to
              three reward assets. Then let the market decide how far your idea
              can run.
            </p>
          </article>
          <article>
            <time>0:32–0:40</time>
            <p>
              As momentum builds, the token moves from its bonding curve into
              open trading, with liquidity locked for the long haul.
            </p>
          </article>
          <article>
            <time>0:40–0:49</time>
            <p>
              And the whole forest has a heartbeat. Stake RDAO to share in
              platform rewards and take part in the decisions that shape what
              comes next.
            </p>
          </article>
          <article>
            <time>0:49–0:59</time>
            <p>
              No empty hype. No mystery box. Just visible markets, clear rules,
              real communities, and rewards designed to move with them.
            </p>
          </article>
          <article>
            <time>0:59–1:06</time>
            <p>
              Find the next breakout. Launch the story everyone wants to join.
              Trade communities. Harvest what they grow. Enter Sherwood Forest.
            </p>
          </article>
        </div>
      </section>
      <section className="marketing-cta">
        <div>
          <p className="eyebrow">Choose your path</p>
          <h2>Find the next breakout or launch it.</h2>
        </div>
        <div className="hero-actions">
          <Link className="button primary" href="/discover">
            Explore markets
          </Link>
          <Link className="button ghost" href="/creators">
            Launch your story
          </Link>
        </div>
      </section>
    </main>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

export function MarketingFilm({
  compact = false,
  available = true,
}: {
  compact?: boolean;
  available?: boolean;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <section
      className={compact ? "story-film compact" : "story-film"}
      aria-labelledby="story-film-heading"
    >
      <div className="story-film-copy">
        <p className="eyebrow">A Devnet story · 2½ minutes</p>
        <h2 id="story-film-heading">See a market become a community.</h2>
        <p>
          Follow one testing-only token from discovery and trade to basket
          rewards, creator launch, locked liquidity, and RDAO staking.
        </p>
        <div className="story-film-links">
          <Link className="text-link" href="/demo#transcript">
            Read the transcript →
          </Link>
          {compact ? (
            <Link className="text-link" href="/demo">
              Open the film page →
            </Link>
          ) : null}
        </div>
      </div>
      <div className="story-film-stage">
        {!available ? (
          <div className="story-film-coming" role="status">
            <span>Film production underway</span>
            <strong>The upgraded Devnet is ready for its close-up.</strong>
            <p>
              The transaction-backed film is being recorded against this exact
              Schema-20 deployment. The accessible transcript is available now.
            </p>
          </div>
        ) : playing ? (
          <video
            autoPlay
            controls
            playsInline
            preload="metadata"
            poster="/media/sherwood-story-poster.webp"
            aria-label="Sherwood Forest product demonstration"
          >
            <source src="/media/sherwood-story-devnet.mp4" type="video/mp4" />
            <track
              default
              kind="captions"
              src="/media/sherwood-story-devnet.vtt"
              srcLang="en"
              label="English"
            />
            Your browser does not support HTML video. Read the transcript
            instead.
          </video>
        ) : (
          <button
            className="story-film-poster"
            type="button"
            onClick={() => setPlaying(true)}
          >
            <Image
              src="/media/sherwood-story-poster.webp"
              alt="A stylized Sherwood Forest market interface glowing between trees"
              width={1600}
              height={900}
              sizes="(max-width: 900px) 100vw, 56vw"
            />
            <span className="story-film-play" aria-hidden="true">
              ▶
            </span>
            <span>Play the Devnet story</span>
          </button>
        )}
      </div>
    </section>
  );
}

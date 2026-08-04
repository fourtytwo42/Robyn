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
        <p className="eyebrow">A Sherwood story · 66 seconds</p>
        <h2 id="story-film-heading">Where markets become communities.</h2>
        <p>
          Find the next breakout, earn alongside the community, or launch the
          story everyone wants to join.
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
            <span>The next story is taking root</span>
            <strong>A new Sherwood film is almost ready.</strong>
          </div>
        ) : playing ? (
          <video
            autoPlay
            controls
            playsInline
            preload="metadata"
            poster="/media/sherwood-sizzle-poster.webp"
            aria-label="The Sherwood Forest story"
          >
            <source src="/media/sherwood-sizzle-web.mp4" type="video/mp4" />
            <track
              default
              kind="captions"
              src="/media/sherwood-sizzle.vtt"
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
              src="/media/sherwood-sizzle-poster.webp"
              alt="A glowing path through Sherwood Forest"
              width={1920}
              height={1080}
              sizes="(max-width: 900px) 100vw, 56vw"
            />
            <span className="story-film-play" aria-hidden="true">
              ▶
            </span>
            <span>Watch the Sherwood story</span>
          </button>
        )}
      </div>
    </section>
  );
}

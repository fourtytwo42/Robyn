"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

type WatchItem = { chainId: number; token: string };
const watchlistKey = "robyn-watchlist:v1";

function readWatchlist() {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(watchlistKey) ?? "[]",
    ) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is WatchItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as WatchItem).chainId === "number" &&
        /^0x[0-9a-f]{40}$/.test((item as WatchItem).token),
    );
  } catch {
    return [];
  }
}

export function TokenActions({
  chainId,
  token,
  symbol,
  creator,
  createdBlock,
  creatorProfile,
  projectLinks,
  mediaId,
}: {
  chainId: number;
  token: string;
  symbol: string;
  creator: string;
  createdBlock: string;
  creatorProfile?: {
    displayName: string;
    bio: string;
    website: string | null;
    xUrl: string | null;
    telegramUrl: string | null;
    discordUrl: string | null;
    avatarMediaId: string | null;
  };
  projectLinks?: {
    website: string | null;
    xUrl: string | null;
  };
  mediaId?: string;
}) {
  const canonicalToken = token.toLowerCase();
  const [watched, setWatched] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reporting, setReporting] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setWatched(
      readWatchlist().some(
        (item) => item.chainId === chainId && item.token === canonicalToken,
      ),
    );
  }, [canonicalToken, chainId]);

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(message);
    } catch {
      setStatus("Clipboard access is unavailable in this browser.");
    }
  }

  function toggleWatchlist() {
    const current = readWatchlist();
    const next = watched
      ? current.filter(
          (item) =>
            !(item.chainId === chainId && item.token === canonicalToken),
        )
      : [...current, { chainId, token: canonicalToken }];
    window.localStorage.setItem(watchlistKey, JSON.stringify(next));
    setWatched(!watched);
    setStatus(
      watched
        ? `${symbol} removed from watchlist.`
        : `${symbol} added to watchlist.`,
    );
  }

  async function share() {
    const data = {
      title: `${symbol} on Sherwood Forest`,
      text: `View the ${symbol} reward market on Sherwood Forest.`,
      url: window.location.href,
    };
    try {
      if (navigator.share) await navigator.share(data);
      else await copy(data.url, "Market link copied.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setStatus("Sharing is unavailable in this browser.");
    }
  }

  async function reportMedia() {
    if (!mediaId || reportReason.trim().length < 10) return;
    setReporting(true);
    try {
      const response = await fetch(`/api/media/${mediaId}/reports`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reportReason }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "report_failed");
      setReportReason("");
      setReportOpen(false);
      setStatus(
        "Artwork report recorded for operator review. The report does not automatically hide media.",
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Artwork report failed.",
      );
    } finally {
      setReporting(false);
    }
  }

  return (
    <section className="token-actions" aria-label="Token actions">
      <div>
        <button
          type="button"
          onClick={() => copy(canonicalToken, "Token address copied.")}
        >
          Copy token
        </button>
        <button type="button" onClick={share}>
          Share
        </button>
        <button type="button" aria-pressed={watched} onClick={toggleWatchlist}>
          {watched ? "Watching" : "Watchlist"}
        </button>
        <button
          type="button"
          aria-expanded={proofOpen}
          onClick={() => setProofOpen((value) => !value)}
        >
          Creator proof
        </button>
        {projectLinks?.website ? (
          <a href={projectLinks.website} target="_blank" rel="noreferrer">
            Website
          </a>
        ) : null}
        {projectLinks?.xUrl ? (
          <a href={projectLinks.xUrl} target="_blank" rel="noreferrer">
            X / Twitter
          </a>
        ) : null}
        <a href="#recent-trades">Recent activity</a>
        {mediaId ? (
          <button
            type="button"
            aria-expanded={reportOpen}
            onClick={() => setReportOpen((value) => !value)}
          >
            Report artwork
          </button>
        ) : null}
      </div>
      {proofOpen ? (
        <aside className="creator-proof" aria-label="Canonical creator proof">
          {creatorProfile ? (
            <div className="creator-profile-summary">
              {creatorProfile.avatarMediaId ? (
                <Image
                  src={`/api/media/${creatorProfile.avatarMediaId}`}
                  width={56}
                  height={56}
                  alt=""
                  unoptimized
                />
              ) : null}
              <span>
                <Link className="text-link" href={`/users/${creator}`}>
                  <b>{creatorProfile.displayName}</b>
                </Link>
                <small>
                  Wallet-owned profile · social links not externally verified
                </small>
              </span>
              {creatorProfile.bio ? <p>{creatorProfile.bio}</p> : null}
              <nav aria-label="Creator links">
                {[
                  ["Website", creatorProfile.website],
                  ["X", creatorProfile.xUrl],
                  ["Telegram", creatorProfile.telegramUrl],
                  ["Discord", creatorProfile.discordUrl],
                ].map(([label, url]) =>
                  url ? (
                    <a href={url} target="_blank" rel="noreferrer" key={label}>
                      {label}
                    </a>
                  ) : null,
                )}
              </nav>
            </div>
          ) : null}
          <strong>Factory-recorded creator</strong>
          <Link className="text-link" href={`/users/${creator}`}>
            <code>{creator}</code>
          </Link>
          <span>
            Recorded at launch block {createdBlock}. This proves the launch
            wallet, not a legal or social identity.
          </span>
          <button
            type="button"
            onClick={() => copy(creator, "Creator address copied.")}
          >
            Copy creator
          </button>
        </aside>
      ) : null}
      {reportOpen && mediaId ? (
        <aside className="media-report" aria-label="Report token artwork">
          <label>
            Why should an operator review this artwork?
            <textarea
              minLength={10}
              maxLength={500}
              value={reportReason}
              onChange={(event) => setReportReason(event.target.value)}
            />
          </label>
          <p>
            Reports are recorded for operator review and do not automatically
            hide artwork.
          </p>
          <div className="action-row">
            <button
              type="button"
              disabled={reporting || reportReason.trim().length < 10}
              onClick={() => void reportMedia()}
            >
              {reporting ? "Sending…" : "Submit report"}
            </button>
            <button type="button" onClick={() => setReportOpen(false)}>
              Cancel
            </button>
          </div>
        </aside>
      ) : null}
      <p className={status ? "token-action-status" : "sr-only"} role="status">
        {status}
      </p>
    </section>
  );
}

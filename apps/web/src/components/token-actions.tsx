"use client";

import { useEffect, useState } from "react";

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
}: {
  chainId: number;
  token: string;
  symbol: string;
  creator: string;
  createdBlock: string;
}) {
  const canonicalToken = token.toLowerCase();
  const [watched, setWatched] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
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
      title: `${symbol} on Robyn`,
      text: `View the ${symbol} reward market on Robyn.`,
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
        <a href="#recent-trades">Recent activity</a>
      </div>
      {proofOpen ? (
        <aside className="creator-proof" aria-label="Canonical creator proof">
          <strong>Factory-recorded creator</strong>
          <code>{creator}</code>
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
      <p className="sr-only" role="status">
        {status}
      </p>
    </section>
  );
}

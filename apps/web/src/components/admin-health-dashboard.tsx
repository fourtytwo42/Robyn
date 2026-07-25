"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminHealthSnapshot } from "@/lib/admin-health";

function value(value: string | number | null) {
  return value === null ? "Unavailable" : String(value);
}

function time(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

export function AdminHealthDashboard({
  initial,
}: {
  initial: AdminHealthSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/admin/health/status", {
        cache: "no-store",
      });
      const next = (await response.json()) as AdminHealthSnapshot;
      setSnapshot(next);
      setError(response.ok ? "" : "One or more components are degraded.");
    } catch {
      setError(
        "Health refresh failed. The last successful snapshot remains visible.",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const cards = [
    {
      name: "Web application",
      status: snapshot.web.status,
      rows: [
        ["Release", snapshot.releaseSha],
        ["Environment", snapshot.environment],
      ],
    },
    {
      name: "Robinhood RPC",
      status: snapshot.rpc.status,
      rows: [
        ["Chain ID", snapshot.rpc.chainId],
        ["Latest block", value(snapshot.rpc.blockNumber)],
        [
          "Response",
          snapshot.rpc.latencyMs === null
            ? "Unavailable"
            : `${snapshot.rpc.latencyMs} ms`,
        ],
      ],
    },
    {
      name: "Canonical indexer",
      status: snapshot.indexer.status,
      rows: [
        ["Ingested block", value(snapshot.indexer.asOfBlock)],
        ["Projected block", value(snapshot.indexer.projectionAsOfBlock)],
        [
          "Ingestion lag",
          `${value(snapshot.indexer.ingestionLagBlocks)} blocks`,
        ],
        [
          "Projection lag",
          `${value(snapshot.indexer.projectionLagBlocks)} blocks`,
        ],
        ["Ingestion cycle", `${value(snapshot.indexer.ingestionCycleMs)} ms`],
        ["Projection cycle", `${value(snapshot.indexer.projectionCycleMs)} ms`],
        ["RPC retries", value(snapshot.indexer.rpcRetryCount)],
        ["Last RPC degradation", time(snapshot.indexer.lastRpcDegradationAt)],
      ],
    },
    {
      name: "Keeper",
      status: snapshot.keeper.status,
      rows: [["Last heartbeat", time(snapshot.keeper.updatedAt)]],
    },
    {
      name: "Artifacts and IPFS",
      status: snapshot.artifacts.status,
      rows: [["Last heartbeat", time(snapshot.artifacts.updatedAt)]],
    },
    {
      name: "Indexed data",
      status: snapshot.indexer.status,
      rows: [
        ["Launches", snapshot.data.launchCount],
        ["Canonical logs", snapshot.data.rawLogCount],
        ["Indexed at", time(snapshot.indexer.indexedAt)],
      ],
    },
  ];

  return (
    <section aria-live="polite">
      <div className="admin-health-toolbar">
        <div>
          <span className={`health-badge health-${snapshot.overall}`}>
            <span className="status-dot" /> Overall {snapshot.overall}
          </span>
          <p>Updated {new Date(snapshot.generatedAt).toLocaleString()}</p>
        </div>
        <button
          className="button"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "Refreshing…" : "Refresh now"}
        </button>
      </div>
      {error ? <p className="transaction-status">{error}</p> : null}
      <div className="admin-health-grid">
        {cards.map((card) => (
          <article className="health-card" key={card.name}>
            <h2>{card.name}</h2>
            <span className={`health-badge health-${card.status}`}>
              {card.status}
            </span>
            <dl>
              {card.rows.map(([label, reading]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{reading}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      <p className="freshness admin-health-note">
        This unlinked read-only page exposes operational health only. It
        contains no keys, credentials, wallet controls, or privileged RPC
        methods.
      </p>
    </section>
  );
}

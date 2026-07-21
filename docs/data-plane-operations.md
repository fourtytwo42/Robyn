# Native data-plane operations

Status: PostgreSQL, Redis, MinIO, reorg-aware indexing, read API, bounded conversion keeper and content-addressed artifact service implemented
Last verified: 2026-07-21

## Native services

Robyn uses the VM's systemd-managed PostgreSQL 16 and Redis 7 services. Both are enabled, active and bound only to loopback. Docker and containers are not involved.

- PostgreSQL: 127.0.0.1:5432
- Redis: 127.0.0.1:6379 and [::1]:6379
- Database: robyn
- Database owner: hendo420
- Local authentication: PostgreSQL peer authentication over the Unix socket
- Redis: protected loopback-only development service

No database password or Redis secret is stored in the repository or PM2 configuration.

## Schema and migrations

The shared package is packages/db. Ordered migrations 0001 through 0004 create:

- canonical chain blocks;
- append-only raw logs with transaction/log identity;
- rebuildable launch projections with formula version;
- durable indexer checkpoints;
- bounded-job current state and dead-letter status;
- append-only job transition history and receipts;
- service heartbeats; and
- content-addressed artifact metadata;
- an idempotent migration ledger.

Run on the VM:

~~~bash
cd /home/hendo420/Robyn
pnpm --filter @robyn/db build
pnpm --filter @robyn/db migrate
~~~

Every migration is transactional and idempotent. Reapplying the ordered set succeeded on 2026-07-21; the migration ledger records all four versions.

## Service checks

~~~bash
systemctl is-enabled postgresql redis-server
systemctl is-active postgresql redis-server
ss -ltn | grep -E ':(5432|6379) '
redis-cli ping
pg_dump -s robyn
~~~

## Live indexer and API

The robyn-indexer and robyn-api processes run under PM2 and are saved for systemd resurrection. The indexer stores every canonical devnet block/log from the deployment boundary, verifies its durable checkpoint hash before advancing, resets derived state on disagreement and rebuilds launch projections from the public factory registries.

The read-only API listens on port 3100 and exposes /health, /status, /launches, /launches/{token}, /launches/{token}/activity and /assets. Every chain-derived response includes asOfBlock and indexedAt freshness. Pagination and request limits are bounded.

`GET /launches` accepts the following optional discovery parameters:

- `limit`: 1 through 100, default 20;
- `before`: a PostgreSQL bigint launch cursor; malformed or overflowing values return HTTP 400;
- `q`: an 80-character maximum, case-insensitive literal name or symbol substring, or an exact canonical token address;
- `asset`: an exact basket-asset address; and
- `basketSize`: 1, 2 or 3.

Address-like malformed searches return an empty result with `queryStatus: invalid_address` instead of fuzzy matching. Invalid optional asset and basket filters are ignored so stale bookmarks degrade safely. Exact token matches are ranked first; otherwise launches remain newest-first. The API deliberately excludes raw volume and projected returns from ranking.

A destructive derived-data rebuild test truncated blocks, raw logs, launch projections and the checkpoint, restarted the indexer, and reproduced 75 logs plus both launches through block 90. Subsequent API/indexer restarts retained the same results. The live web status surface independently displayed Indexer ok at block 90.

## Redis-backed faucet quotas

The RPC gateway uses atomic Redis Lua reservations for its one-address-per-hour and five-requests-per-source-IP windows. Successful quota state survived a PM2 gateway restart with 3,589 seconds remaining and rejected the repeated address with HTTP 429. When Redis was deliberately stopped, a fresh faucet request failed closed with HTTP 503 before any privileged RPC call; restarting Redis and the gateway restored service. Unit tests retain an injectable in-memory limiter so failure/release semantics remain deterministic.

## Remaining work

- Keep the scheduled encrypted backup and periodic clean-target restore rehearsal green.
- Add metrics, alerts, kill/restart and deterministic rebuild tests.

## Content-addressed artifacts

The loopback-only `robyn-artifacts` PM2 service stores immutable SHA-256-addressed
objects in the versioned native MinIO bucket and records their metadata in
PostgreSQL. Its heartbeat participates in API health, so a MinIO outage makes
both the artifact service and public API fail closed with HTTP 503 after the
freshness window. See [Native object storage operations](object-storage-operations.md).

## Conversion keeper

`robyn-keeper` is a single-concurrency BullMQ worker on the native Redis
service. Every executable vault leg gets a deterministic job ID derived from
the vault, leg, pending timestamp and observed amount. Jobs retry at most three
times with exponential backoff. `job_audit` stores the current state while
`job_audit_events` preserves an append-only transition/receipt trail.
Exhausted jobs become `dead_letter`, and both views remain visible through
`GET /operations` on the read API.

The keeper deliberately starts only when `ROBYN_ENV=robyn-devnet`, the
manifest chain is 31337 and the loopback operator RPC exposes an unlocked
account. It cannot silently run against testnet. A testnet keeper requires a
separately approved scoped signer and quote/oracle policy.

Every scan pings Redis before refreshing the PostgreSQL heartbeat. A controlled
Redis outage aged the heartbeat to `degraded` and made API health return 503;
restoring Redis and restarting its two consumers returned all health checks to
`ok`.

Useful checks:

```bash
pm2 status robyn-keeper
curl -fsS http://127.0.0.1:3100/operations
psql -d robyn -c "select state,count(*) from job_audit group by state"
ROBYN_ENV=robyn-devnet pnpm --filter @robyn/keeper jobs:retry
```

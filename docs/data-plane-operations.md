# Native data-plane operations

Status: PostgreSQL schema, reorg-aware indexer and read API implemented; queue workers and artifact service remain in progress
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

The shared package is packages/db. Migration 0001_initial creates:

- canonical chain blocks;
- append-only raw logs with transaction/log identity;
- rebuildable launch projections with formula version;
- durable indexer checkpoints;
- bounded-job audit and dead-letter state; and
- an idempotent migration ledger.

Run on the VM:

~~~bash
cd /home/hendo420/Robyn
pnpm --filter @robyn/db build
pnpm --filter @robyn/db migrate
~~~

The migration is transactional and idempotent. It was applied twice successfully on 2026-07-21. PostgreSQL schema inspection confirmed all six tables.

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

A destructive derived-data rebuild test truncated blocks, raw logs, launch projections and the checkpoint, restarted the indexer, and reproduced 75 logs plus both launches through block 90. Subsequent API/indexer restarts retained the same results. The live web status surface independently displayed Indexer ok at block 90.

## Redis-backed faucet quotas

The RPC gateway uses atomic Redis Lua reservations for its one-address-per-hour and five-requests-per-source-IP windows. Successful quota state survived a PM2 gateway restart with 3,589 seconds remaining and rejected the repeated address with HTTP 429. When Redis was deliberately stopped, a fresh faucet request failed closed with HTTP 503 before any privileged RPC call; restarting Redis and the gateway restored service. Unit tests retain an injectable in-memory limiter so failure/release semantics remain deterministic.

## Remaining work

- Add BullMQ workers and durable job audit/dead-letter visibility.
- Install and harden native MinIO for content-addressed artifacts.
- Add database backup, off-VM copy and destructive restore rehearsal.
- Add metrics, alerts, kill/restart and deterministic rebuild tests.

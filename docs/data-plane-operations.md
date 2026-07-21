# Native data-plane operations

Status: Foundation implemented; API, indexer, queue workers and artifact service remain in progress
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

## Remaining work

- Add the reorg-aware indexer and Fastify read API.
- Move faucet quota state into Redis with bounded expiry.
- Add BullMQ workers and durable job audit/dead-letter visibility.
- Install and harden native MinIO for content-addressed artifacts.
- Add database backup, off-VM copy and destructive restore rehearsal.
- Add metrics, alerts, kill/restart and deterministic rebuild tests.

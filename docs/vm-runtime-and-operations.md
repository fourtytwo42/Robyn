# VM runtime and operations

Status: Settled implementation policy
Owner: Platform engineering TBD
Date: 2026-07-20

## Binding decisions

1. The Ubuntu VM `robyn` at `192.168.50.250` is the only project development and runtime host.
2. The authoritative repository checkout is `/home/hendo420/Robyn`.
3. The Windows workstation is only an SSH/control client and optional read-only mirror. It does not run project code or infrastructure.
4. Docker, Docker Compose, Kubernetes, container images and container registries are outside the architecture.
5. Node.js application processes use PM2 with persistent `systemd` startup state.
6. Databases, queues, object storage, monitoring, reverse proxy and any self-hosted RPC node run natively on the VM.
7. Third-party blockchain, wallet, quote, registry and GitHub APIs remain external dependencies; no Robyn-owned workload runs on another compute host.

Docker was installed during initial VM provisioning before this decision. No containers or images existed, and `docker.service`, `docker.socket` and `containerd.service` were disabled on 2026-07-20. Package removal is a separate administrative action.

8. Development starts on a native VM-hosted Anvil chain with chain ID `31337`; Hardhat Network is not part of the settled Foundry stack.
9. Every user-facing story is accepted through the Codex in-app browser, while lower-level VM-native tests remain mandatory.
10. Every major validated change is committed and pushed from the VM; main remains deployable.
## Authoritative workflow

```bash
ssh hendo420@192.168.50.250
cd /home/hendo420/Robyn
git status --short --branch
git pull --ff-only
```

All package installs, builds, tests, migrations, contract compilation, forks, browser tests, service commands, commits and pushes execute from this checkout.

## Native service topology

| Responsibility | Runtime | Persistence manager |
|---|---|---|
| Next.js web | Node.js | PM2 plus `systemd` startup |
| Fastify API | Node.js | PM2 plus `systemd` startup |
| Indexer | Node.js | PM2 plus `systemd` startup |
| Keeper | Node.js | PM2 plus `systemd` startup |
| Adapter epoch builder | Future adapter-mode only; absent from the native candidate | PM2 plus `systemd` when that mode is implemented |
| PostgreSQL | Native Ubuntu package | `systemd` |
| Redis | Native Ubuntu package | `systemd` |
| MinIO, when S3-compatible artifacts are needed | Native pinned binary | `systemd` |
| Reverse proxy/TLS | Native Caddy or Nginx package, selected before public beta | `systemd` |
| Prometheus/Grafana and local telemetry collector | Native packages or pinned binaries | `systemd` |
| Self-hosted Robinhood Chain RPC/node, if required and officially supported | Native pinned node release | `systemd` |
| GitHub Actions runner, when enabled | Native self-hosted runner | `systemd` |

PostgreSQL is the durable application source for raw and derived offchain state. Redis is rebuildable coordination and quota state. MinIO stores immutable content-addressed artifacts; a future adapter mode may also store epoch artifacts there. None of these services may be replaced by an in-memory development-only implementation in a release environment.

## PM2 persistence

The current implementation:

1. Pins PM2 7.0.3 through the workspace.
2. Commit `infrastructure/pm2/ecosystem.config.cjs` with one named process per application/worker.
3. Runs each application as the non-root `hendo420` PM2 service user.
4. Uses the generated `pm2-hendo420.service` plus ordering drop-in for `systemd` resurrection.
5. Saves the reviewed process set with `pm2 save`.
6. Has passed cold-start recovery; the exact d90e218 candidate will repeat the reboot gate after its uninterrupted soak.

PM2 configuration contains no secrets. Each process receives only its scoped environment file or systemd credential at runtime.

## Native data services

- PostgreSQL uses a dedicated database and role per environment, committed Drizzle migrations, loopback binding unless remote access is explicitly required, and scheduled `pg_dump` plus restore rehearsals.
- Redis binds to loopback, uses authentication/ACLs where supported, has no public listener, and may be rebuilt from PostgreSQL/onchain checkpoints.
- MinIO binds to a private interface or loopback behind the reverse proxy, uses a dedicated data directory and service account, and verifies object hashes during backup/restore.
- Service data lives outside the Git checkout under documented paths such as `/var/lib/postgresql`, `/var/lib/redis`, and `/var/lib/minio`.
## Controlled development network

The first implementation environment is the persistent Robyn Devnet described in [Devnet-to-testnet readiness plan](devnet-to-testnet-readiness-plan.md):

- native Anvil on chain ID `31337`, supervised by `robyn-anvil.service`;
- raw JSON-RPC bound to `127.0.0.1:8545`;
- an implemented restricted LAN gateway at `192.168.50.250:8546`;
- state outside Git under `/var/lib/robyn/anvil/state.json`;
- a rate-limited faucet that funds arbitrary development addresses; and
- production-shaped mock assets, feeds, exchange routes and issuer-control failure modes.

The LAN gateway must deny privileged Anvil, impersonation, destructive, unsafe debug and state-manipulation methods. Automated contract and service tests use separate ephemeral Anvil processes and never reset the shared devnet.

For devnet browser UAT only, the application may expose an explicitly labeled ephemeral session wallet so the in-app browser can sign transactions without an extension. That connector, its keys, the faucet and chain ID 31337 must be compile-time excluded from testnet/production bundles and confirmed absent by bundle scans.

The Anvil service, restricted gateway and faucet are implemented and verified on the VM. The native candidate uses transfer-integrated cumulative accounting and therefore does not run an epoch builder.

- Service configuration lives under `/etc`, while repository-owned templates and runbooks live under `infrastructure/`.

## RPC policy

Routine browser reads and transaction submission continue to use Robinhood's public RPC, the connected wallet provider, or a user-supplied RPC so ordinary user traffic does not consume VM resources.

Correctness-critical indexing, keeper simulation and reconciliation require protected RPC capacity; a future adapter-mode epoch builder also requires it. Start with protected external providers if a supported Robinhood node distribution is unavailable. If Robyn needs to operate its own RPC or archive node and Robinhood provides supported software/snapshots, install it natively on this VM under `systemd`.

Before installing a node:

- document supported client, version, snapshot source and verification method;
- measure CPU, memory, storage growth, IOPS and bandwidth requirements;
- expand this VM's resources if needed;
- isolate node data from PostgreSQL/MinIO capacity alerts; and
- retain an independent external RPC for disagreement detection.

The workstation is never an RPC host.

## Deployments without containers

- Build reviewed artifacts on the VM from a pinned commit and frozen lockfile.
- Store releases under `/opt/robyn/releases/<commit-or-release-id>`.
- Record source commit, dependency lock hash, build hashes, migrations and test evidence in a release manifest.
- Point `/opt/robyn/current` at the approved release using an atomic symlink change.
- Run migrations as an explicit gated step.
- Reload Node processes with PM2 and native services with `systemctl` only when their configuration changed.
- Roll back application code by restoring the previous symlink and PM2 process set. Contract deployments and incompatible database migrations use forward remediation, not fictitious rollback.

## CI on the VM

If GitHub Actions is used, register a dedicated self-hosted runner account on this VM and install its runner unit through `systemd`. Workflows must target only the labeled Robyn runner and must not use GitHub-hosted runners.

Because the runner shares a host with project services:
## Browser acceptance and Git checkpoints

All anonymous, wallet, create, trade, reward, claim, recovery and responsive user journeys must be exercised through the Codex in-app browser against the VM-served application. Release evidence includes DOM assertions, screenshots, console/network failures and desktop/tablet/mobile results. This browser gate supplements rather than replaces Foundry, Vitest, service, database, security and operational verification.

After each major validated slice, commit and push from the VM. Use feature branches for incomplete or risky slices and merge only after their required checks and browser acceptance pass.

- do not execute workflows from untrusted forks;
- use a dedicated unprivileged Unix account and workspace;
- do not grant the runner passwordless unrestricted sudo;
- scope environment secrets to protected jobs; and
- serialize resource-heavy fork/E2E jobs to avoid starving production processes.

## Backups and recovery

Backup jobs execute on the VM, but recoverable copies must leave the VM failure domain. Back up PostgreSQL dumps, raw event checkpoints, MinIO objects, deployment manifests and service configuration to encrypted attached/NAS/offsite storage. Redis is not a required financial backup source. Secrets and signing keys follow separate recovery procedures and are never placed in general data backups.

Restore rehearsals must rebuild a clean database, verify content hashes, replay deterministic state and meet the PRD recovery target.

## Capacity and security gates

- Track disk, inode, memory, load, IOPS and service-level capacity on the VM.
- Reserve headroom for PostgreSQL replay, Foundry forks, Playwright and release builds.
- Bind internal services to loopback/private interfaces and expose only the reverse proxy and explicitly approved RPC ports.
- Use dedicated non-root service accounts and least-privilege file permissions.
- No mainnet signing key resides in the repository, PM2 configuration, shell history or general CI environment.
- A single VM is an accepted current availability constraint. Monitoring and tested backups are mandatory before mainnet beta.

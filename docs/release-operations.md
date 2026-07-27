# Immutable release operations

Status: implementation in progress

Robyn application processes run from an exact, read-only release under `/opt/robyn/releases`. The atomic `/opt/robyn/current` symlink selects the active release. The authoritative checkout remains the only build and Git workspace; it is never the production process working directory after migration.

## One-time installation

~~~bash
sudo /home/hendo420/Robyn/scripts/install-release-system.sh
~~~

The first run creates operator-writable staging/release roots and a protected release-history directory. It deliberately defers the PM2 systemd override until a valid `current` release exists, so an interrupted first migration cannot break reboot recovery. Run the installer again after the first successful promotion to activate resurrection through `/opt/robyn/current`.

## Build a release

The checkout must be clean and `HEAD` must exactly equal pushed `origin/main`.

~~~bash
cd /home/hendo420/Robyn
scripts/build-release.sh
~~~

The builder:

- runs formatting, lint, typecheck, all tests, production build, traceability and static security gates; Robinhood Testnet journey and stack rehearsal remain explicitly deferred;
- archives the exact Git commit instead of copying the mutable checkout;
- installs the frozen pnpm lockfile with dependency copies rather than links to the shared pnpm store, then rebuilds inside staging;
- records source, lock, dependency, license, CycloneDX SBOM, protected-build-input fingerprint, migration, build and gate hashes;
- writes `release-manifest.json`, `release-files.sha256` and retained gate evidence; and
- removes write permission and rejects writable files/directories, shared dependency hardlinks or external symlinks before accepting `/opt/robyn/releases/<git-sha>`.

Runtime never invokes pnpm from a release. PM2 executes the pinned Node binary and built entrypoints directly; the artifact wrapper only loads its protected service environment before executing Node. This keeps dependency tooling from attempting writes inside the read-only artifact.

## Promote and verify

~~~bash
scripts/promote-release.sh <release-id>
readlink -f /opt/robyn/current
/opt/robyn/current/scripts/verify-release.sh
~~~

Promotion verifies artifact hashes, atomically switches the symlink, updates all six named PM2 processes, waits for web/API/RPC/artifact and process-binding health, saves the PM2 process set and records JSON evidence under `/var/lib/robyn/release-history`. A failed health gate restores the prior symlink and process set.

## Roll back compatible application code

~~~bash
/opt/robyn/current/scripts/rollback-release.sh
~~~

Rollback swaps `current` and `previous`, reloads PM2, verifies the same release gate and records evidence. Contract deployments and incompatible database migrations require forward remediation; this mechanism must not pretend to reverse them.

## Run the exact-release soak

~~~bash
sudo /home/hendo420/Robyn/scripts/install-soak-service.sh
sudo systemctl start robyn-soak.service
systemctl status robyn-soak.service --no-pager
sudo find /var/lib/robyn/soak -name "*-summary.json" -type f -print
~~~

The static service is installed but cannot be enabled and is started only by the
explicit command above. Its eight-hour run is bound to the selected release and
uses 100 stable actor identities for mixed market, portfolio, DAO, asset and
token reads. Every ten samples it performs bounded real buys/sells and any
currently eligible holder, creator and RDAO claims; the permissionless keeper
continues conversions.

Every four write cycles, one rotating creator persona also completes the real
launch path: SIWE authentication, sanitized artwork upload, local IPFS pinning,
immutable ERC-1046 metadata preparation, one atomic launch transaction,
receipt-derived token identification, indexer confirmation, one-time metadata
binding, and live bonding trades. Every second generated token is bought
through graduation and sold again through the graduated venue. New launches
join subsequent actor reads and ordinary trade/claim rotation. With the default
timing this creates at most 23 new launches during eight hours, remains within
the per-wallet upload rate limit, and exercises both bonding and graduated
populations. It does not advance chain time, so multi-day Governor lifecycle
completion remains covered by deterministic contract/browser tests rather than
fabricated during the soak.

The run fails if the symlink changes, an app leaves that immutable directory, a
process restarts, health or onchain conservation fails, indexed state moves
backward, an alert fires, p95 exceeds 500 ms, resource floors are crossed or
RSS grows beyond the bounded allowance. Thirty-second samples, transaction
hashes, metadata CIDs, launch-lifecycle events, the final summary and SHA-256
evidence are mode `0600` under
`/var/lib/robyn/soak/<release-id>/`. A shortened run validates the harness only
and never satisfies the release gate.

After the completed evidence is preserved:

~~~bash
sudo /home/hendo420/Robyn/scripts/remove-soak-service.sh
~~~

This removes the temporary unit. No recurring timer or scheduled soak remains.

## Release acceptance

Before identifying a release as a candidate:

- verify all release hashes;
- confirm all six PM2 process working directories resolve to the selected immutable release;
- run LAN edge/security smoke and in-app-browser journeys;
- reboot and prove PM2 systemd resurrection through `current`;
- complete a compatible promotion/rollback rehearsal;
- run the exact release for a real uninterrupted eight-hour soak; and
- push the release manifest/evidence and candidate tag.

TLS remains mandatory before access leaves the trusted LAN. Human alert delivery and independent protocol/security review remain separate release gates.

## Robinhood Testnet immutable release

The public testnet uses a parallel immutable root and never changes the local
devnet release:

```bash
cd /home/hendo420/Robyn
scripts/build-testnet-release.sh
sudo scripts/promote-testnet-release.sh <release-id>
/opt/robyn/testnet-current/scripts/verify-testnet-release.sh
```

The builder accepts only a clean exact pushed commit, runs the complete release
gates, builds the protected chain-46630 bundle from a Git archive, scans it for
devnet markers and records checksums under
`/opt/robyn/testnet-releases/<release-id>`.

Promotion atomically selects `/opt/robyn/testnet-current`, restarts only the
five `*-testnet` PM2 processes, verifies schema v8 and at least nine canonical
launches through both local and public routes, and reruns the deployment
verifier against Robinhood's official public RPC. A failed application
cutover restores the prior application symlink and process set; it never
pretends to roll back onchain state.

The deployment manifest's `gitCommit` is the commit whose contract bytecode was
deployed. `testnet-release-manifest.json.gitSha` is the later application
release that serves and indexes that immutable deployment. Both identities are
required and intentionally distinct.

## Testnet and mainnet isolation

Network selection is a build-time deployment profile, never a user-facing
switch inside one running application:

| Resource | Testnet | Mainnet |
| --- | --- | --- |
| Build mode | `testnet` | `mainnet` |
| Chain ID | `46630` | `4663` |
| Public host | `testnet.sherwoodforest.trade` | `sherwoodforest.trade` |
| Web origin | `127.0.0.1:3012` via Nginx `3081` | `127.0.0.1:3022` via a future isolated Nginx origin |
| API | `127.0.0.1:3111` | `127.0.0.1:3121` |
| Artifacts | `127.0.0.1:3210` | `127.0.0.1:3220` |
| Redis | database `1` | database `2` |
| PostgreSQL | `robyn_testnet_*` | `robyn_mainnet` |
| PM2 suffix | `-testnet` | `-mainnet` |
| Release root | `/opt/robyn/testnet-releases` | `/opt/robyn/mainnet-releases` |

`NEXT_PUBLIC_ROBYN_NETWORK_MODE` controls public presentation, wallet switching,
RPC and explorer targets, faucet visibility, disclosures and metadata.
`ROBYN_NETWORK_MODE` selects the matching build aliases. The public-release
validator refuses a chain, hostname or deployment-manifest mismatch and refuses
mock-only or testnet-marked assets in a mainnet manifest.

The mainnet builder is deliberately non-promoting:

```bash
scripts/build-mainnet-candidate.sh
```

It requires a clean pushed commit, `/home/hendo420/.config/robyn/mainnet/release.env`,
a verified chain-4663 deployment manifest, production RPC/explorer settings and
the mainnet WalletConnect origin. Building produces an immutable candidate but
does not activate it. Mainnet activation remains a separate explicit operation
after contracts, assets, legal review, security review, recovery and real-wallet
acceptance pass.


Keep credentialed mainnet server RPC configuration in
`/home/hendo420/.config/robyn/mainnet/server-rpc.env` with mode `0600`. Load it
only for backend, indexer, projector, keeper, and operator processes. Never use
the credentialed URL as `NEXT_PUBLIC_ROBYN_RPC_URL`, because that value is
compiled into the browser bundle. The browser must use a non-secret endpoint or
a rate-limited Sherwood RPC gateway. Before activation, verify the paid provider
supports the production `eth_getLogs` range and request mix. The protected
Alchemy PAYG endpoint passed chain-ID and canonical-hash checks, 200-block and
1,000-block `eth_getLogs` probes, ordinary read methods, and a bounded 40-request
mixed-read burst with 40/40 successes and 727 ms p95 latency on 2026-07-27. This
is provider preflight evidence only; it does not authorize a mainnet process
cutover. Rotate credentials disclosed through chat and apply least-privilege
provider restrictions before production activation.
When mainnet is eventually authorized, load
`infrastructure/pm2/ecosystem.mainnet.config.cjs`. It reuses the reviewed public
service topology while replacing every process name, port, queue, Redis
database, PostgreSQL database, manifest, RPC, secret file and origin. A testnet
crash or experiment therefore cannot share application processes or state with
mainnet. The apex holding page remains in place until that separate activation.

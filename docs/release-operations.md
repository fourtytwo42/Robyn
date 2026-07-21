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

- runs formatting, lint, typecheck, all tests, production build, traceability, static security, full chain-46630 transaction journey and isolated five-service testnet rehearsal gates;
- archives the exact Git commit instead of copying the mutable checkout;
- installs the frozen pnpm lockfile and rebuilds inside staging;
- records source, lock, dependency, migration, build and gate hashes;
- writes `release-manifest.json`, `release-files.sha256` and retained gate evidence; and
- removes write permission before moving the result into `/opt/robyn/releases/<git-sha>`.

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

The service is installed but deliberately not enabled or started automatically. Its 24-hour run is bound to the selected release and fails if the symlink changes, an app leaves that immutable directory, a process restarts, health or onchain conservation fails, indexed state moves backward, an alert fires, p95 exceeds 500 ms, resource floors are crossed or RSS grows beyond the bounded allowance. Samples and the final summary are mode `0600` under `/var/lib/robyn/soak/<release-id>/`. A shortened run validates the harness only and never satisfies the release gate.

## Release acceptance

Before identifying a release as a candidate:

- verify all release hashes;
- confirm all six PM2 process working directories resolve to the selected immutable release;
- run LAN edge/security smoke and in-app-browser journeys;
- reboot and prove PM2 systemd resurrection through `current`;
- complete a compatible promotion/rollback rehearsal;
- run the exact release for a real uninterrupted 24-hour soak; and
- push the release manifest/evidence and candidate tag.

TLS remains mandatory before access leaves the trusted LAN. Human alert delivery and independent protocol/security review remain separate release gates.

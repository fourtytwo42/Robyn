# Mainnet staging-to-production architecture

## Trust boundary

192.168.50.108 is the keyless public application host. It runs only the web,
API, scoped indexer, projector, artifact service, and public RPC gateway.
User wallets sign client-side. The host has no keeper, deployer, governance
runner, recovery runner, private key, mnemonic, keystore, signer FIFO, or
reusable signature.

192.168.50.250 remains the private staging and secure operator host. Devnet,
Testnet, LAN-only Mainnet staging, the keeper, release builder, and blockchain
signing material stay there. Production cannot SSH into operator directories.

The sole Mainnet application and transaction upstream is the LAN node at
192.168.50.173:8547. Alchemy is comparison-probe-only. Automatic fallback is
false. A degraded LAN node leaves reads visibly degraded and disables signed
raw-transaction relay.

## Storage and retention

The production VM uses one expanded LVM root filesystem so PostgreSQL and
indexer history can consume all present capacity. The 248 GiB LV formats to
roughly 244 GiB, with application data organized under /srv/robyn-data and
normal PostgreSQL state under /var/lib/postgresql.

Production retains Sherwood-scoped history indefinitely. It permanently tracks
protocol roots, dynamically discovered launch contracts, and only approved
PoolManager topics for Sherwood pool IDs. Global WETH, Permit2,
PositionManager, Universal Router, stock-token, and unrelated-pool logs are
excluded.

Capacity alerts fire at 60, 75, and 85 percent. At 60 percent, refresh the
growth model. At 75 percent, schedule a virtual-disk and LVM extension. At 85
percent, stop nonessential backfills while preserving current ingestion,
reads, and user claims. Add future virtual disks to ubuntu-vg and extend
ubuntu-lv online.

Mainnet staging on .250 is disposable and retains seven days of detailed logs
and job history. The retention job defaults to a dry run, uses bounded
deletions, and vacuums only after an explicit --execute.

## Backups

Production uses pgBackRest with AES-256 encrypted storage on the dedicated LAN
share //192.168.50.102/Q/Sherwood-DBbackups, mounted only at
/mnt/robyn-backups. PostgreSQL WAL archiving provides point-in-time recovery.
Daily incremental and weekly full backups retain exactly the newest three full
backup sets; pgBackRest expires the oldest full set and no-longer-needed
dependent backups and WAL after a fourth full completes. The root-only CIFS
credential and encryption passphrase are never stored in Git or application
environments.

An isolated restore is required before DNS cutover and monthly afterward. The
NAS is a separate storage host but remains on the same LAN and is not complete
second-site disaster recovery. A geographically separate encrypted copy
remains a follow-up.

## Release promotion

Ordinary pushes never deploy production. main remains the deployable integration
branch. The explicit promotion command is:

    pnpm release:promote:mainnet --sha <qualified-sha>

The SHA must be clean, pushed, and reachable from protected origin/main.
Devnet, Testnet, and LAN-Mainnet staging acceptance records must exist for the
same SHA. Scope classification selects the minimum safe gate:

- UI-only: web tests/build plus frozen Schema-18 contract-closure attestation.
- API/indexer/database: affected service, migration, rebuild, and browser gates.
- Contract: complete contract qualification.
- Mixed or ambiguous: the stricter combined gate.

The robyn-release account builds the runtime without access to deployer
material. The bundle contains built runtime files, additive migrations, the
sanitized Schema-18 deployment manifest, checksums, SBOM, topology hash, frozen
contract closure, and acceptance references. A dedicated SSH release key signs
both the annotated mainnet-prod-* tag and production-release.json.

The production updater polls every two minutes. It pins the public signing key,
rejects unsigned or modified releases, wrong chain, stale contract closure,
wrong prior release, secret-bearing files, destructive migrations, missing
acceptance, reused SHA/tag, and unauthorized RPC fallback. Releases extract
under /opt/robyn/releases/<sha> and /opt/robyn/current switches atomically.
Health failure restores the prior symlink and PM2 process set.

## Cloudflare and cutover

Nginx listens on loopback for Cloudflare and 192.168.50.108:3082 for LAN
acceptance. Direct Internet ports 80 and 443 remain closed. Cloudflare denies
or protects /admin, /metrics, internal health, and debug paths and rate limits
API/RPC traffic.

Cutover order:

1. Rebuild the scoped production database from Schema-18 deployment block
   25321851.
2. Reach zero ingestion and projection lag and compare projections with direct
   onchain reads.
3. Complete an encrypted backup and isolated restore.
4. Deploy the signed release with transaction submission disabled.
5. Verify preview desktop/mobile, API, artifacts, IPFS, RPC policy, simulations,
   reboot behavior, and emergency controls.
6. Point sherwoodforest.trade and www to the production tunnel.
7. Verify the exact release externally, then enable raw-transaction relay in
   one controlled configuration change.
8. Remove the Mainnet hostname from .250; retain its Mainnet app only on LAN.
9. Monitor the new host for 24 hours.

On failure, disable transaction relay and serve maintenance or roll back on
.108. Never silently expose staging as public fallback.

# Backup and restore operations

Status: implemented and live-verified
Last verified: 2026-07-21

## Recovery model

The VM creates the backup, but the private GitHub repository's encrypted release assets are the required copy outside the VM failure domain. A same-disk archive is only a staging copy and is never considered a successful backup by itself.

Each backup contains:

- a PostgreSQL custom-format dump plus per-table row counts;
- a consistent Anvil `anvil_dumpState` snapshot and deployment manifest;
- every content-addressed MinIO artifact, verified against its SHA-256 object name;
- the PM2 topology, systemd service definitions and dependency lockfile;
- the exact clean Git commit; and
- a checksum manifest covering every recovered file.

Redis is intentionally excluded because it contains reconstructible queues and rate-limit windows, not canonical financial state. General backups never include MinIO credentials, wallet keys, signing keys or the age recovery identity.

## Encryption and identity custody

`scripts/install-backup-service.sh` creates a dedicated age identity at `/etc/robyn/backup-age-identity.txt` with mode `0600`. Only its public recipient is used by the backup job. The identity must be exported to a separately protected operator recovery store before the timer is accepted. It must never be committed, uploaded with the backup or printed into routine logs.

The current operator recovery copy is stored outside the VM in an OS-protected secret file. Restoration on a replacement VM requires explicitly importing that identity to `/etc/robyn/backup-age-identity.txt`.

## Install

Run on the authoritative VM:

~~~bash
sudo apt-get update
sudo apt-get install -y age
sudo /home/hendo420/Robyn/scripts/install-backup-service.sh
systemctl status robyn-backup.timer --no-pager
~~~

The persistent timer runs daily at 02:17 UTC with up to 20 minutes of randomized delay. It runs as `hendo420` with `NoNewPrivileges`, PostgreSQL peer access, a separate read-only/no-write MinIO account and only the public age recipient. The private GitHub release retains the newest seven encrypted backup/checksum pairs.

## Manual backup

~~~bash
sudo systemctl start robyn-backup.service
sudo systemctl status robyn-backup.service --no-pager
sudo journalctl -u robyn-backup.service -n 100 --no-pager
sudo ls -l /var/backups/robyn
gh release view robyn-state-backups
~~~

A successful run prints the encrypted local staging path, exact Git SHA, artifact count and off-VM release tag. The accompanying `.sha256` file protects the encrypted transfer before decryption.

## Clean-target restore rehearsal

The rehearsal does not overwrite the live database, MinIO volume or Anvil service. It:

1. verifies the encrypted transfer checksum;
2. decrypts into a root-only temporary directory;
3. verifies every file in `SHA256SUMS`;
4. restores PostgreSQL into a new temporary database and compares every table count;
5. verifies each recovered artifact's bytes against its content-addressed filename;
6. loads Anvil state on loopback port 18545 and confirms chain ID 31337 plus factory bytecode; and
7. destroys all temporary targets.

~~~bash
latest="$(sudo find /var/backups/robyn -maxdepth 1 -name 'robyn-state-*.tar.zst.age' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
sudo /home/hendo420/Robyn/scripts/rehearse-restore.sh "$latest"
~~~

Acceptance requires `restore=passed`, matching database/artifact evidence, `chainId=0x7a69`, nonempty factory bytecode and `liveStateTouched=false`. The rehearsal target is outside every live data directory.
Last verified 2026-07-21: the clean-target rehearsal completed in 830 ms, restored and compared 9 PostgreSQL tables, verified 1 content-addressed artifact, loaded the RPC snapshot into an isolated Anvil process, confirmed chain `0x7a69` and factory bytecode, removed its temporary database/port and left every live service healthy. The encrypted backup and checksum were independently visible as uploaded assets on the private GitHub release.


## Replacement-VM recovery

1. Provision the VM and check out the recorded Git SHA.
2. Install native PostgreSQL, Redis, MinIO, Foundry/Anvil, Node/pnpm, PM2, age and GitHub CLI.
3. Retrieve the encrypted release asset and checksum from private GitHub storage.
4. Import the separately held age identity with owner `root:root` and mode `0600`.
5. Verify and decrypt the bundle.
6. Restore PostgreSQL, copy verified content-addressed objects to a newly provisioned bucket, and place the Anvil state in a new generation directory.
7. Apply committed migrations, start services, force an index reconciliation and run the full release gate plus browser UAT.

The controlled milestone recovery target is under four hours. The measured clean-target rehearsal duration must be recorded in `MEMORY.md` and the release evidence before this gate is complete.
# IPFS recovery policy

Kubo's blockstore is intentionally excluded from encrypted backups. Before
backup, `scripts/reconcile-ipfs-pins.sh` proves that every recursive CIDv1
application pin maps to exact content-addressed bytes in MinIO and an
`ipfs_pins` database row. Kubo's internal CIDv0 MFS root is not application
content and is recreated by `ipfs init`.
The backup contains `ipfs/pins.txt` plus `ipfs/pin-artifacts.tsv`.

The isolated restore starts an empty offline Kubo repository on alternate
loopback ports, re-adds every restored MinIO object with the production CIDv1
settings, compares each reproduced CID, and compares the complete pin set.
The restored application and CID-only gateway are then smoke-tested against
that empty-node reconstruction. This avoids treating a mutable blockstore as
the recovery source of truth.

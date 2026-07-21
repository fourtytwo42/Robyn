# Native object storage operations

Status: native MinIO and content-addressed artifact service implemented and live
Last verified: 2026-07-21

Robyn uses the MinIO Community server as a loopback-only S3-compatible artifact
store on the authoritative VM. It is a native systemd service; Docker and
containers are prohibited.

## Pinned installation

The installer pins and checksum-verifies these official MinIO downloads:

- MinIO Community server `20250907161309.0.0`
- MinIO client `20250813083541.0.0`

Run only on the VM:

```bash
cd /home/hendo420/Robyn
sudo bash scripts/install-minio-service.sh
```

The installer creates the unprivileged `minio-user`, stores data under
`/var/lib/robyn-minio`, keeps root credentials only in
`/etc/default/minio` with mode 0640, disables the browser console and binds
the S3 API only to `127.0.0.1:9000`. It installs a systemd hardening override
with a read-only host filesystem except for the data directory.

Never copy the root password into the repository, PM2 configuration, logs,
shell history or project memory. Application credentials must be a separate
least-privilege service account.

## Health checks

```bash
systemctl is-enabled minio
systemctl is-active minio
curl -fsS http://127.0.0.1:9000/minio/health/live
curl -fsS http://127.0.0.1:9000/minio/health/ready
ss -ltn | grep ':9000 '
systemd-analyze security minio.service
```

The service is not an off-VM backup. Artifact and database backup copies must
still leave the VM failure domain before production readiness.

## Provisioning and persistence

After installing the service, create the versioned bucket and least-privilege
application service account:

```bash
cd /home/hendo420/Robyn
sudo bash scripts/provision-minio-artifacts.sh
pnpm --filter @robyn/db migrate
pnpm exec pm2 startOrReload infrastructure/pm2/ecosystem.config.cjs --update-env
pnpm exec pm2 save
```

The provisioner is idempotent. It creates the versioned `robyn-artifacts`
bucket, stores service credentials only in `/etc/robyn/artifacts.env` with
`root:hendo420` ownership and mode 0640, and verifies the service account.
The application policy permits list, read, write and multipart operations only
inside that bucket. It deliberately omits object and bucket deletion.

`robyn-artifacts` is the sixth persistent PM2 process. It listens only on
`127.0.0.1:3200`, caps request bodies at 2 MiB, and sources the protected
environment through `scripts/start-artifact-service.sh`. PostgreSQL migration
`0004_artifacts.sql` stores the SHA-256 digest, object key, byte length, media
type and creation time.

## Application interface

- `GET /health` verifies both MinIO and PostgreSQL.
Uploads accept only JSON, plain text or generic binary media types. Retrievals
set `X-Content-Type-Options: nosniff` to prevent active-content interpretation.
- `PUT /artifacts` accepts `application/octet-stream`, computes SHA-256, writes
  once with an S3 precondition, and returns 201 for a new object or 200 for an
  already-verified duplicate.
- `GET /artifacts/{sha256}` returns immutable bytes with a digest ETag and
  one-year immutable cache policy.
- `GET /artifacts/{sha256}/metadata` on the read API returns the PostgreSQL
  record without exposing MinIO.

The service heartbeat is part of public API health. A stale or failed artifact
heartbeat changes `GET /health` on port 3100 to HTTP 503.

## Verified evidence

On 2026-07-21 the authoritative VM passed all of these checks:

- checksum-pinned installation and provisioning were rerun successfully;
- the systemd unit was enabled and active, bound only to loopback, and received
  a `2.7 OK` overall exposure score from `systemd-analyze security`;
- a 44-byte deterministic JSON object returned 201 on first write and 200 with
  `created:false` on an identical second write;
- retrieval matched the expected digest and exact input bytes;
- malformed digest, missing object, empty body and 2 MiB plus one byte requests
  returned 400, 404, 400 and 413 respectively;
- an application-credential deletion attempt was denied and the object remained;
- MinIO plus PM2 restart preserved and returned the exact stored bytes;
- a controlled MinIO outage made artifact and API health return 503/degraded,
  then both recovered automatically after service restoration; and
- the in-app browser showed `Artifacts ok` with no warnings or errors.

## Recovery boundary

MinIO versioning protects against application overwrites but is not a backup.
Do not delete `/var/lib/robyn-minio` during ordinary recovery. Restore testing
must cover the MinIO data directory together with PostgreSQL metadata, verify
every restored object's SHA-256, and retain a copy outside the VM failure
domain. That destructive restore rehearsal remains a release blocker.

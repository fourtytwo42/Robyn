# Immutable IPFS Token Metadata

Robyn token metadata follows ERC-1046 and is committed at launch through an
immutable `ipfs://` token URI. Sanitized source artifacts remain in MinIO for
recovery, while the VM Kubo node and a vendor-neutral remote pinning service
provide content-addressed availability.

## Trust and moderation

- Kubo RPC is loopback-only and is never exposed through Nginx.
- The local gateway has `Gateway.NoFetch=true`; it serves Robyn-pinned content
  instead of acting as an open recursive gateway.
- Direct contract users may supply any syntactically valid IPFS URI. The API
  marks content verified only when it came through Robyn's sanitizer.
- Quarantine changes Robyn rendering and token-list inclusion. It cannot change
  an onchain URI or erase content already published to IPFS.
- Original uploads, pinning credentials, wallet secrets, and source image
  metadata are never published or stored in PostgreSQL.

## Native service

Run `sudo scripts/install-ipfs-service.sh`. The installer downloads the pinned
official Kubo archive and SHA-512 checksum, installs `/usr/local/bin/ipfs`, and
creates:

- service account `robyn-ipfs`
- repository `/var/lib/robyn-ipfs`
- configuration `/etc/robyn/ipfs.env`
- RPC `127.0.0.1:5001`
- gateway `127.0.0.1:8080`

Optional remote pinning configuration uses:

```text
ROBYN_REMOTE_PIN_URL=https://provider.example/api/v1
ROBYN_REMOTE_PIN_TOKEN=replace-outside-git
```

Local development remains usable without those values. Protected testnet
readiness requires every launch image and metadata object to have local and
remote `pinned` status.

## Recovery

Backups retain MinIO artifacts, PostgreSQL CID records, and a pin manifest.
Recovery initializes an empty Kubo repository, re-adds the exact bytes, checks
that every CID reproduces, restores local pins, and resubmits remote pins. The
Kubo blockstore is intentionally not duplicated in backups.

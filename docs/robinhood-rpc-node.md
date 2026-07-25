# Robinhood RPC node operations

Last verified: 2026-07-25

## Boundary and topology

Robyn operates a dedicated Robinhood Chain node host at `192.168.50.117`. It is a separate LAN-only infrastructure host; it is not a public wallet RPC and it is not routed through Cloudflare.

- Robyn application VM: `192.168.50.250`
- Private testnet JSON-RPC edge: `http://192.168.50.117:8547`
- Nitro process RPC: `127.0.0.1:18547` on the node host only
- Nitro Prometheus edge: `http://192.168.50.117:16071/metrics`
- Host node-exporter: `http://192.168.50.117:9100/metrics`
- SSH: LAN subnet only

UFW permits ports `8547`, `16071`, and `9100` only from `192.168.50.250`. Nginx repeats the source restriction and proxies only the method-limited Nitro HTTP interface. Nitro exposes only `net`, `web3`, and `eth`; debug, admin, personal, engine, and raw container ports are not exposed. Browser builds must continue using a public HTTPS RPC because RFC1918 endpoints are invalid for remote wallets.

## Supported runtime

Robinhood documents Arbitrum Nitro in Docker as its supported full-node path. This dedicated node host is an explicit, narrow exception to Robyn's no-container application rule; the Robyn application, databases, workers, and controlled devnet remain native on `192.168.50.250`.

The pinned runtime is:

- Image: `offchainlabs/nitro-node:v3.11.2-3599aca`
- Digest: `sha256:ebc985e3b105980734630744981e1542001c22d74cba57509fe0d5ed8bb84c14`
- Chain: Robinhood Chain Testnet, ID `46630`
- Parent: Ethereum Sepolia, ID `11155111`
- Feed: `wss://feed.testnet.chain.robinhood.com`
- Transaction forwarding: `https://sequencer.testnet.chain.robinhood.com`

The L1 execution and beacon URLs live in `/etc/robinhood/testnet/node.env`, mode `0640`, and never enter Git. The initial bootstrap uses public Sepolia execution and beacon endpoints. Replace them with dedicated authenticated endpoints before treating the node as a production correctness dependency; public parent-chain services can rate-limit or omit historical data.

## Capacity decision

The server exposes 16 vCPUs, about 30 GiB usable RAM, 8 GiB swap, and a 500 GB NVMe-backed virtual disk. The Ubuntu LVM/root filesystem was expanded from 100 GiB to the full 498 GiB logical volume, yielding a 490 GiB filesystem.

This is sufficient to start one pruned node, not simultaneous testnet and mainnet nodes:

- Official testnet pruned snapshot dated 2026-07-15: `180589076480` bytes, SHA-256 `9234e53eedd3c7a1e12b122f7ba747576d6c2685c9d0b9fdd625c20ab3c73077`.
- Official mainnet pruned snapshot dated 2026-07-23: about 141 GiB.
- Official testnet archive snapshot is about 2.87 TiB and cannot fit.
- Robinhood's official baseline is 64 GB RAM, 128 GB recommended, and several TB of NVMe capacity.

Testnet is prioritized because it is Robyn's current active environment. Mainnet configuration files are staged under `/etc/robinhood/mainnet`, but no mainnet service is enabled. Before adding mainnet, expand to at least 2 TB NVMe and preferably 64 GB RAM. Do not try to fit both nodes by weakening disk headroom or deleting testnet evidence.

## Bootstrap and persistence

The node cannot start before `robinhood-testnet-snapshot.service` succeeds. The snapshot job:

1. Resumes the official Offchain snapshot download.
2. Requires enough space for the download, extraction, and a 40 GB safety floor.
3. Verifies the published SHA-256.
4. Extracts into `/srv/robinhood/testnet/data`.
5. Writes `/etc/robinhood/testnet/snapshot.ready` only after successful extraction.
6. Removes the downloaded tar only after the verified database exists.

`robinhood-testnet-node.service` is enabled at boot and waits for that marker. The database mount is `/home/user/.arbitrum` inside the pinned image; this was verified from the image's actual runtime user and startup paths rather than relying on the stale `/home/nitro` example.

Useful checks:

```bash
sudo systemctl status robinhood-testnet-snapshot.service robinhood-testnet-node.service
sudo journalctl -u robinhood-testnet-snapshot.service -f
sudo journalctl -u robinhood-testnet-node.service -f
sudo du -sh /srv/robinhood/snapshots /srv/robinhood/testnet/data
curl -sS -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_syncing","params":[]}' \
  http://127.0.0.1:18547
```

A node is usable only when `eth_chainId` is `0xb626`, `eth_syncing` is `false`, its head matches an independent Robinhood Testnet RPC within the alert threshold, historical `eth_getLogs` probes pass, and the service survives a controlled reboot without database repair.

## Application cutover

Do not change the browser RPC. After full sync and verification, set the server-side testnet environment on `192.168.50.250`:

```text
ROBYN_TESTNET_RPC_URL=http://192.168.50.117:8547
```

This value flows into `ROBYN_OPERATOR_RPC_URL` for the API, indexer, and keeper through `infrastructure/pm2/ecosystem.testnet.config.cjs`. Retain an independent public/provider endpoint for divergence checks and automatic operator rollback. Restart only the testnet backend processes after validation, save PM2 state, and verify index continuity before declaring cutover complete.

## Recovery and upgrades

The chain database is rebuildable and is not included in normal Robyn application backups. Back up the small configuration, published checksum manifest, and service definitions; recover chain state from a newly verified trusted snapshot. Pin image digests. On ArbOS or Nitro upgrades, compare Robinhood's current required version, stage the image, verify its digest and snapshot compatibility, then perform a controlled restart with the public RPC retained as fallback.

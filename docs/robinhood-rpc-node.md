# Robinhood RPC node operations

Last verified: 2026-07-27

## Boundary and topology

Sherwood Forest testnet uses protected Alchemy testnet HTTP and WebSocket
endpoints for server, indexer, projector, keeper and operator traffic. Browser
configuration never contains an Alchemy credential. The dedicated host at
`192.168.50.117` is reserved for an experimental Robinhood Chain Mainnet pruned
node and is not a dependency of the testnet application.

- Application VM: `192.168.50.250`
- Testnet RPC: `https://rpc.testnet.chain.robinhood.com`
- Mainnet LAN JSON-RPC edge: `http://192.168.50.117:8547`
- Mainnet Nitro process RPC: `127.0.0.1:18547` on the node host
- Mainnet Nitro metrics edge: `http://192.168.50.117:16071/metrics`
- Host node-exporter: `http://192.168.50.117:9100/metrics`

UFW and Nginx permit the LAN RPC and metrics ports only from `192.168.50.250`. Nitro exposes only `net`, `web3`, and `eth`. Debug, admin, personal, engine, WebSocket, and public internet access remain disabled.

## Runtime and data

Robinhood documents Docker as its supported Nitro deployment path. The RPC host is a narrow exception to the project's no-container application rule. The application, databases, workers, and controlled devnet remain native on `192.168.50.250`.

- Image tag: `offchainlabs/nitro-node:v3.11.2-3599aca`
- Pinned digest: `sha256:ebc985e3b105980734630744981e1542001c22d74cba57509fe0d5ed8bb84c14`
- Chain: Robinhood Chain Mainnet, ID `4663`
- Parent chain: Ethereum Mainnet, ID `1`
- Feed: `wss://feed.mainnet.chain.robinhood.com`
- Forwarding target: `https://sequencer.mainnet.chain.robinhood.com`
- Data: `/srv/robinhood/mainnet/data`
- Configuration: `/etc/robinhood/mainnet`

The node currently uses `https://eth.drpc.org` for Ethereum execution and
`https://ethereum-beacon-api.publicnode.com` for consensus. There is no paid
fallback. dRPC serves the historical log range Nitro requires but does not
implement the optional `eth_config` method; Nitro records that warning and uses
its static chain configuration. A failure or rate limit in either parent-chain dependency may stall the node and must remain visible through alerts.

## Capacity trial

The host has 16 vCPUs, about 30 GiB usable RAM, 8 GiB swap, and a 490 GiB root filesystem. Robinhood documents 64 GB RAM, recommends 128 GB, and expects substantially more NVMe storage. This node is therefore an experimental 32 GB pruned-node trial, not an accepted production dependency.

The trial fails if any of these remain true:

- Available memory is below 2 GiB for five minutes.
- Swap use exceeds 2 GiB for five minutes.
- The node is more than 50 blocks behind after initial synchronization.
- LAN RPC p95 exceeds 500 ms under the Sherwood read workload.
- Disk falls below 100 GB or 20 percent free.
- Nitro is OOM-killed, restarts unexpectedly, or disagrees with the canonical public endpoint.


As of 2026-07-27 the pinned node is running on chain `4663`, consuming about
5 GiB under its 28 GiB container limit, with healthy execution and beacon
dependencies. It is still performing initial catch-up, so the 48-hour trial has
not started and no production-readiness conclusion may be drawn yet.
## Bootstrap and persistence

`robinhood-mainnet-snapshot.service` prepares a checksum-verified stable-compatible pruned snapshot before `robinhood-mainnet-node.service` may start. The bootstrap script refuses a nonempty unverified data directory and requires space for the archive, extraction, and a 100 GB safety floor.

The selected bootstrap snapshot is the official Offchain Labs 2026-07-12 pruned snapshot produced for Nitro commit `3599aca`:

- Bytes: `46011832320`
- SHA-256: `12fc2f2dd77460ab2d61a810d79e930bc26a7a7129befdf1f27cae7d0dbb4178`

The newer 2026-07-23 snapshot was produced by a release-candidate Nitro build and is not used with the pinned stable runtime.

Useful checks:

```bash
sudo systemctl status robinhood-mainnet-snapshot.service robinhood-mainnet-node.service
sudo journalctl -u robinhood-mainnet-node.service -f
sudo docker logs --tail 100 robinhood-mainnet-node
curl -sS -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  http://127.0.0.1:18547
curl -sS -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_syncing","params":[]}' \
  http://127.0.0.1:18547
```

A synchronized node returns chain ID `0x1237` and `eth_syncing: false`. Acceptance also compares recent block hashes, receipts, logs, balances, bytecode, calls, fee history, and gas estimates against `https://rpc.mainnet.chain.robinhood.com` without broadcasting a transaction.

Run `/usr/local/sbin/verify-robinhood-mainnet-rpc` after synchronization. It
writes checksum-protected read-only comparison evidence under
`/var/lib/robinhood/mainnet-acceptance/latest/`.

## Monitoring

`robinhood-mainnet-health.timer` samples every 30 seconds and exports chain identity, local and public heads, lag, synchronization state, parent-chain health, data size, and service restarts through node-exporter's textfile collector.

Prometheus scrapes:

- `robinhood-rpc-host` at `192.168.50.117:9100`
- `robinhood-mainnet-nitro` at `192.168.50.117:16071`

Initial catch-up may intentionally fire the head-lag warning. Chain mismatch, unavailable RPC, parent-chain failure, memory floor, swap, disk, and restart alerts are never suppressed.

After `eth_syncing` becomes `false` and the local head is within 50 blocks,
install and start `robinhood-mainnet-trial.service`. The static one-shot service
runs the 48-hour read and capacity gate, samples every minute, exercises six
ordinary JSON-RPC read methods, checks a recent canonical block hash against the
public mainnet RPC, and fails closed on a chain mismatch, sync regression, lag,
restart, OOM, memory, swap, disk, or latency violation. Evidence is written
under `/var/lib/robinhood/mainnet-trial/active/`. It never submits or signs a
transaction.

```bash
sudo systemctl start robinhood-mainnet-trial.service
sudo journalctl -u robinhood-mainnet-trial.service -f
sudo jq . /var/lib/robinhood/mainnet-trial/active/status.json
```

The completed trial records the actual mainnet database growth rate and
projected disk runway. A projected runway below 60 days fails the trial; below
120 days requires a capacity warning and expansion plan.

## Testnet continuity and recovery

All protected testnet processes use Alchemy testnet for
`ROBYN_TESTNET_SERVER_RPC_URL` and `ROBYN_OPERATOR_RPC_URL`. The canonical
ingester additionally uses the protected `ROBYN_TESTNET_WS_RPC_URL` as a
filtered log wake source with 30-second HTTP reconciliation. No credentialed URL
may be compiled into the browser, and no testnet process may reference
`192.168.50.117:8547` after it becomes chain `4663`.

The former testnet database is reproducible public data and is not backed up. Its service definitions, configuration, snapshot metadata, image provenance, and checksums are archived before deletion. Recreating a private testnet node requires a fresh trusted snapshot and a separate capacity decision.

If the mainnet trial fails, stop and disable the mainnet services, preserve the
database and evidence when safe, and keep the testnet application on its
protected Alchemy testnet endpoints. Do not silently point testnet traffic back
at the repurposed LAN endpoint.

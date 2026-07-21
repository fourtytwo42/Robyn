# Incident response

Every alert is scoped to chain, component, launch and asset labels and links to one of these procedures. Capture the alert start time, current release SHA, last good indexed block, affected transaction/launch/asset when applicable, commands run and resolution evidence. Never delete canonical data or retry a financial action until its onchain state is reconciled.

## Component down
1. Check `systemctl status` for native services and `pnpm exec pm2 status` for Node processes.
2. Query `/health`, `/status` and `/operations` from loopback.
3. Inspect only the affected service journal/log; redact credentials and signed payloads.
4. Restart the smallest affected component and confirm index/accounting freshness.
5. Escalate if recovery needs data deletion or state changes unexpectedly.

## Indexer lag
1. Compare raw RPC head, restricted RPC head and API `asOfBlock`.
2. Confirm the stored checkpoint hash still matches the canonical block.
3. Stop publication if a reorg or hash mismatch is unresolved.
4. Rebuild derived state only from the documented deployment boundary.

## RPC divergence
1. Compare `eth_chainId`, `eth_blockNumber` and known deployment bytecode through both endpoints.
2. Keep privileged RPC loopback-only; never bypass the gateway for users.
3. Stop dependent keeper/indexer actions before raw-RPC restart and reconcile afterward.

## Conversion failure
1. Read idempotency key, attempts, input and transaction hash from `/operations`.
2. Query vault pending state and receipt before retrying.
3. Never retry when a transaction may have succeeded but indexing is delayed.
4. Escalate unexpected deltas or repeated route failure.

## Backup stale
1. Inspect `robyn-backup.timer`, its journal and private GitHub assets.
2. Confirm the checkout is clean and recovery identity has a protected off-VM copy.
3. Run a manual backup and clean-target restore.
4. Never accept a same-disk archive as recovery.

## Monitoring stale
1. Check `robyn-metrics-collector.timer` and its journal.
2. Validate the textfile with `promtool check metrics`.
3. Confirm node-exporter and Prometheus targets before restarting the collector.

## Capacity
1. Capture disk, inode, memory, load and per-process use.
2. Pause builds, CI, backups or load tests before live financial services.
3. Preserve at least 15 percent disk and 10 percent memory headroom.
4. Expand this VM before introducing another runtime host.

## Database restore
1. Take a fresh encrypted backup if the live database remains readable.
2. Restore into a clean target and compare checksums/counts.
3. Stop writers before an approved live replacement.
4. Apply migrations, force reconciliation, run release gates and browser UAT.

## Key compromise
1. Stop only the affected signer/keeper path and preserve evidence.
2. Revoke or rotate the credential using its dedicated procedure.
3. Keep signing material out of backups and incident notes.
4. Reconcile all transactions since last known-safe use.

## Invalid reward state
1. Scope exact launch, asset, vault, block and transaction.
2. Pause conversion/claim publication for that scope.
3. Compare vault input, router output, deposit and cumulative accounting.
4. Preserve principal; never redistribute a failed basket weight.

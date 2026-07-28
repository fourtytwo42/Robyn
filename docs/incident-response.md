# Incident response

Every alert is scoped to chain, component, launch and asset labels and links to one of these procedures. Capture the alert start time, current release SHA, last good indexed block, affected transaction/launch/asset when applicable, commands run and resolution evidence. Never delete canonical data or retry a financial action until its onchain state is reconciled.

## Component down
1. Check `systemctl status` for native services and `pnpm exec pm2 status` for Node processes.
2. Query `/health`, `/status` and `/operations` from loopback.
3. Inspect only the affected service journal/log; redact credentials and signed payloads.
4. Restart the smallest affected component and confirm index/accounting freshness.
5. Escalate if recovery needs data deletion or state changes unexpectedly.

## Indexer lag
1. Compare the public RPC head with API `asOfBlock`, `projectionAsOfBlock`,
   `ingestionLagBlocks`, and `projectionLagBlocks`.
2. Inspect `robyn-indexer-testnet` and `robyn-projector-testnet` separately.
   The ingester owns `chain-indexer`; the projector owns `launch-projector`.
3. Confirm the stored ingestion checkpoint hash still matches the canonical
   block. Never move either checkpoint forward manually.
4. If ingestion is healthy but projection is behind, inspect the first
   unprojected coordinator event and its factory/market validation failure.
   Correct the cause and let the unchanged projector checkpoint retry it.
5. Stop publication if a reorg or hash mismatch is unresolved. A deterministic
   reset clears chain-derived logs, blocks, launches, and both checkpoints from
   the deployment boundary while retaining offchain metadata bindings.
6. Do not restart or replay a journaled financial transaction to repair an
   indexing problem.

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
3. Confirm node-exporter, Prometheus, Alertmanager and
   `robyn-alert-receiver.service` before restarting the collector.
4. Alertmanager and its append-only receiver must remain bound to loopback.
   Inspect `/var/lib/robyn/alerts/deliveries.jsonl` for both firing and resolved
   records; this is local evidence, not external human notification.

## Accounting drift
1. Stop keeper conversions and release promotion without deleting pending work.
2. Record the exact block, deployment manifest and affected launch/asset.
3. Reconcile basket, creator, RDAO and treasury liabilities against contract
   balances and cumulative events.
4. Restore the last proved baseline in isolation if the drift is unexplained.
5. Resume only after the defect has a regression test and reconciliation is
   exact.

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

## Release soak
1. Treat any assertion, alert, restart, release change or interruption as a
   failed candidate; preserve the raw sample and checksum evidence.
2. Do not restart the soak against a dirty tree or changed artifact.
3. Diagnose and fix the defect, rebuild one immutable candidate, and rerun all
   affected gates before explicitly starting a new two-hour clock.
4. Remove the one-shot soak unit after completion; do not leave a recurring
   scheduler or automation behind.

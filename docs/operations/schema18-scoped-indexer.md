# Schema-18 Scoped Indexer Operations

## Scope contract

The Schema-18 indexer accepts only a deployment manifest with a valid
`indexingPolicy` version and deterministic SHA-256 policy hash. Its retained
log scope is:

1. Explicit Sherwood protocol roots.
2. Launch token, vault, market, graduation adapter, and locker addresses decoded
   from canonical `AtomicV4LaunchCreated` events.
3. PoolManager `Initialize`, `ModifyLiquidity`, `Swap`, and `Donate`
   events whose indexed pool ID belongs to a Sherwood launch.

Launch addresses and pool IDs are permanent. They are reconstructed from the
launch projection and canonical coordinator logs after every restart. New
addresses are queried from their creation block through the current range end,
which retains same-block activity.

The indexer never makes unfiltered log requests for WETH, Permit2,
PositionManager, Universal Router, stock tokens, or PoolManager. Route health,
balances, liquidity, quotes, and solvency are bounded reads or Sherwood-router
events.

## Manifest generation

Generate or refresh a policy deterministically:

```bash
node scripts/add-schema18-indexing-policy.mjs deployments/schema18.json
```

The generator rejects non-Schema-18 manifests, zero or incomplete protocol
roots, and external dependencies in the root set. Testnet and Mainnet manifest
finalizers add the same policy automatically.

## Storage controls

The ingester publishes policy identity, tracked launch/address/pool counts,
query counts, retained logs, excluded global sources, database size, daily
growth, estimated runway, filesystem utilization, and backfill status in its
heartbeat. API `/status` exposes these values.

Disk alerts fire at 60%, 75%, and 85% utilization. At 85%, the ingester refuses
material historical backfills while API reads remain available. Near-head
canonical reconciliation remains allowed. Do not override this guard to finish
a rebuild.

Public activation additionally requires at least 12 GiB and 15% free space.
Measure observed bytes per launch, transaction, retained log, and day after 30
days. The expected permanent starting target is 1 TB primary NVMe plus at least
1 TB of backup capacity outside the VM failure domain.

## Rebuild procedure

1. Stop the indexer; keep API reads and onchain claims available.
2. Seal broad-index counts, address distribution, relation sizes, checkpoints,
   failure logs, and checksums.
3. Create a fresh Schema-18 database or isolated schema and run migrations.
4. Start the corrected ingester at the Schema-18 deployment block.
5. Confirm no excluded global address exists in `raw_logs`.
6. Run the projector and compare launches, rewards, governance, pools, balances,
   and liabilities with direct onchain reads and sealed receipts.
7. Require zero missing or duplicate Sherwood logs, database size below 100 MB,
   lag no greater than 100 blocks, and normal p95 no greater than 50.
8. Keep Mainnet writes disabled until focused Testnet acceptance and the
   replacement Gate-3 manifest both pass.

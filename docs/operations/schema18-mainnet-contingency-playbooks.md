# Schema-18 Mainnet Contingency and Emergency Playbooks

## Purpose and scope

This is the controlling incident runbook for the Schema-18 Robinhood Mainnet
deployment and its supporting application. It covers containment, evidence,
recovery, and reopening. It does not grant transaction authority and does not
replace an exact deployment, Canary, Public-activation, or recovery manifest.

The operating priority is:

1. Protect user and protocol funds.
2. Preserve canonical chain state and transaction evidence.
3. Preserve safe claims, withdrawals, and exits where the contracts permit.
4. Restore correct service only after exact reconciliation.
5. Optimize availability last.

Never conceal an incident, improvise calldata, replay a confirmed or ambiguous
transaction, advance a checkpoint manually, use liabilities as operating funds,
or weaken a reopening gate to shorten an outage.

## Schema-18 authority and containment limits

The Safe guardian can immediately:

- Move the launch coordinator to `Paused`.
- Pause asset conversions.
- Pause native protocol-fee conversions.
- Disable individual routes or every configured route with a recorded reason.
- Cancel eligible Timelock operations.

The guardian cannot:

- Resume launches or asset conversions.
- Install a new graduation profile.
- Enable or reconfigure a route.
- Change fixed supplies, fee allocation, reward duration, accrued liabilities,
  existing launch profiles, creator locks, or locked LP principal.
- Freeze existing graduated pools, ordinary token transfers, or permissionless
  contract calls that have no pause control.

The application transaction-disable switch and stopped keepers reduce exposure
but do not prevent a user from calling contracts directly. Pausing new launches
does not pause existing bonding, graduated trading, claims, or withdrawals.
Do not claim that a frontend shutdown freezes the protocol.

LAN `192.168.50.173:8547`, through the loopback gateway, is the only authorized
Mainnet application and transaction upstream. Alchemy is limited to chain ID,
sync, and block-height comparison probes. It never becomes an automatic fallback.

## Severity levels

### SEV-0: critical financial or control incident

Examples include confirmed or suspected asset loss, signer compromise,
unauthorized governance, reward insolvency, fixed-supply drift, locked-principal
drift, or a reproducible contract exploit.

Target response: disable application submissions within one minute and execute
the applicable guardian containment as soon as the authorized signer can safely
do so.

### SEV-1: contained financial-risk incident

Examples include one unsafe route, incorrect quote or reference tick, RPC
divergence, ambiguous financial transaction, keeper duplication, or projection
state capable of producing incorrect transactions.

Target response: disable the affected financial path within five minutes. Use
global containment when the scope is uncertain.

### SEV-2: production degradation without known financial drift

Examples include stale reads, non-financial API failure, artwork or metadata
failure, monitoring degradation, or a frontend regression with transaction
construction already disabled.

Target response: mark the affected surface degraded, preserve read-only service
where accurate, and repair through the normal release path.

### SEV-3: informational event

Examples include a transient alert that self-resolves without failed work or
state divergence. Record and review it; promote it to a higher severity if its
scope is not proven.

## Universal five-minute containment drill

Use this sequence for every SEV-0 and for any SEV-1 whose scope is not proven.

### Minute 0 to 1: stop new application-originated risk

1. Disable Mainnet transaction submission in the application.
2. Stop automated financial submissions and keepers without deleting queues.
3. Mark the public Mainnet connection or transaction surface degraded.
4. Freeze the affected signer nonce lane. Do not submit a replacement.

### Minute 1 to 3: contain onchain entry points

From the exact verified Safe and only when the signer itself is trusted:

1. Pause new launches.
2. Pause the asset router.
3. Pause the native protocol-fee router.
4. Disable affected routes. Disable all routes when scope is uncertain.
5. Cancel malicious or obsolete pending Timelock operations when possible.

Journal every intent before signing and append the normalized receipt after
confirmation. If a submission becomes ambiguous, stop the signer lane and move
to the ambiguous-transaction playbook.

### Minute 3 to 5: establish the evidence boundary

Record without secrets:

- Incident start time and severity.
- Chain ID, latest trusted block number, timestamp, and canonical hash.
- Contract, application, operational-tooling, and manifest hashes.
- LAN gateway health and comparison-probe results.
- Deployer, Safe, treasury, router, vault, locker, and reward balances.
- Launch modes, conversion pause states, route states, profiles, and pool phases.
- Outstanding liabilities, allowances, queues, and pending operations.
- Latest submitted, pending, confirmed, rejected, and ambiguous transaction hashes.
- Current application release and process restart counters.

Do not modify canonical data while collecting this baseline.

## Scenario playbooks

### Reward deficit, over-credit, or conservation mismatch

Containment:

1. Execute the universal containment drill.
2. Stop reward-settlement and conversion jobs.
3. Disable affected claim UI and API publication, while clearly stating that
   permissionless onchain claims may remain callable.

Investigation:

1. Pin the first divergent block, reward category, launch, asset, and recipient.
2. Compare deposits, vested amounts, unvested amounts, zero-supply queues,
   rounding carry, claims, backing balances, and event totals.
3. Rebuild the relevant projection from canonical logs in an isolated database.

Recovery:

- Never silently cap claims, erase liabilities, or transfer treasury funds to
  disguise a deficit.
- A contract-accounting defect requires a fresh schema, full contract-dependent
  qualification, and a separately authorized deployment and recovery plan.
- Reopen only after exact backing and conservation are proved independently for
  holder, creator, and DAO rewards.

### Active or suspected contract exploit

Containment:

1. Treat as SEV-0 and execute global containment.
2. Disable the public transaction interface and publish a direct warning.
3. Preserve traces, calldata, receipts, balances, and the pre-incident state.

Limitations:

Schema-18 is not an upgradeable proxy system. A vulnerable deployed contract
cannot be patched in place. Existing trading or claims without a pause control
may remain directly callable after the application is disabled.

Recovery:

1. Reproduce the exploit on an exact pinned fork.
2. Build a fresh schema and prove the correction through focused, adjacent,
   fuzz, invariant, simulation, recovery, Testnet, and Mainnet-fork gates.
3. Publish an explicit treatment for every legitimate outstanding liability.

### Route, pool, oracle, or reference-tick manipulation

Containment:

1. Disable the affected asset route with a specific reason.
2. Pause all conversions if manipulation may affect shared price assumptions.
3. Pause launches when new baskets could select the affected asset.

Recovery requires fresh verification of token and pool runtime identities,
liquidity, tick spacing, current and historical ticks, quote behavior, caps,
minimum outputs, deadlines, allowance cleanup, and bounded execution in both
directions. Re-enable only through the authorized governance path.

### Graduation, supply, phase, NFT, or locked-principal anomaly

Containment:

1. Disable application writes and pause new launches immediately.
2. Pause conversions and routes when settlement or routing may be involved.
3. Do not attempt a second graduation or liquidity initialization.

Recovery requires an exact fork reproduction and comparison of the launch
snapshot, bonding inventory, completion threshold, phase transitions, position
NFT, locker ownership, residuals, supplies, and principal. Any contract-level
difference requires a new schema. Existing launch profiles and locked LP
principal must never be rewritten to force reconciliation.

### LAN RPC outage, lag, wrong chain, or canonical divergence

Containment:

1. Mark the frontend `Connection degraded` and disable financial submissions.
2. Stop keepers and any process capable of broadcasting.
3. Keep Alchemy probe-only. Do not route application or transaction traffic to it.
4. Do not bypass the loopback gateway with a raw upstream URL.

Recovery requires chain ID `4663`, `eth_syncing=false`, acceptable head lag, and
canonical agreement for block hashes, receipts, logs, runtime code, balances,
calls, fee history, and estimates. Reconcile every transaction submitted before
the outage. Resume only after multiple healthy LAN probes and explicit operator
selection of LAN as primary.

### Ambiguous, missing, or rejected transaction

Containment:

1. Stop all submissions from the signer and nonce lane.
2. Preserve the pre-signing intent, signed hash when available, node response,
   pending/latest nonce, and journal state.
3. Do not automatically replace, speed up, cancel, or replay it.

Classification:

- Confirmed success: append the canonical receipt and continue from resulting state.
- Confirmed failure: append the receipt and diagnose before a new authorized intent.
- Rejected before admission with unchanged nonce and absent hash: record the
  rejection; a new intent still requires the runner's restart-safe admission checks.
- Pending or not provably absent: keep the lane frozen.

### Indexer, projector, database, or queue divergence

Containment:

1. Disable writes whenever stale projected data could construct a transaction.
2. Keep canonical ingestion read-only if hashes remain correct.
3. Stop only the faulty projector or worker. Never delete its pending journal.

Recovery:

1. Verify the stored checkpoint hash against canonical chain state.
2. Restore backups only into isolated names, paths, and ports.
3. Rebuild a separate empty projection from the deployment block.
4. Require equality between rebuilt projection, live projection, direct onchain
   reads, API responses, queues, liabilities, and transaction journals.

Never advance a checkpoint manually or replay a transaction to fix indexing.

### Keeper duplicate, stuck job, or settlement failure

Containment:

1. Stop the affected worker without deleting its queue or journal.
2. Pause the associated conversion path if it can create additional pending work.

Recovery:

1. Match the job's idempotency key to its intent, hash, receipt, and onchain state.
2. A confirmed transaction is complete even when projection is late.
3. Retry only work proven never submitted, using a new authorized intent where required.
4. Verify exact accounting and zero duplicate credit before restarting the worker.

### Application, API, release, DNS, or frontend compromise

Containment:

1. Disable application writes and automated submissions.
2. Serve a static maintenance or accurate read-only state when possible.
3. Remove the compromised release from traffic without deleting its artifact.
4. Rotate only credentials proven exposed; do not rotate blindly during evidence collection.

Recovery requires clean source, reproducible artifact hashes, protected
configuration review, exact served SHA, DNS/TLS verification, dependency and
secret scans, browser acceptance, and confirmation that no unauthorized Mainnet
transaction was constructed or submitted.

### Deployer, Safe owner, or signing-environment compromise

Treat any suspected signing compromise as SEV-0.

Containment:

1. Stop the affected signer service and every process that can access it.
2. Disable application submissions through a separately trusted control path.
3. Inventory all transactions and governance operations since the last known-safe use.
4. Cancel pending Timelock operations only with a signer that is independently trusted.

Current critical limitation:

The bootstrap deployment uses one deployer-controlled Safe owner at threshold
one and the deployer holds all RDAO. Compromise of that one control domain can
compromise the guardian and unanimous governance together. The one-hour
Timelock provides detection time but no independent cancellation authority when
the only Safe owner is compromised.

Before outside-user activation, the preferred mitigation is three independently
controlled Safe owners at threshold two, including at least one offline owner,
plus a tested external human alert path. Until then, key compromise has no fully
independent onchain containment path and must remain an explicitly accepted SEV-0 risk.

### Low operating balance or fee spike

Containment:

1. Stop before the protected `0.02 ETH` liquid Mainnet reserve would be breached.
2. Do not use treasury, DAO, reward, basket, or locked-principal funds for gas.
3. Do not bridge or fund automatically.

Recovery requires a fresh measured budget, a separately authorized funding
action, and verification of both-chain receipts and reserves.

### Robinhood token restriction, freeze, or incompatible behavior

Containment:

1. Disable the affected route and pause conversions that may produce the asset.
2. Prevent new launches from selecting an unsafe asset through the public application.
3. Record the exact token runtime, issuer status, balance, and affected liabilities.

Do not substitute another token, force redistribution, or treat a successful
ERC-20 call as proof of legal transferability. Recovery requires both technical
qualification and the applicable issuer/legal review.

### VM, service, storage, or capacity failure

Containment:

1. Disable writes when signer, database, queue, or RPC correctness is uncertain.
2. Pause builds, CI, backups, and nonessential workloads before financial services.
3. Restart only the smallest affected component.

Recovery requires sufficient disk and memory headroom, clean service restart
counters, exact queue and transaction reconciliation, isolated backup restore
evidence when data was affected, and fresh health samples before writes resume.

### Reorg or canonical-hash mismatch

Containment:

1. Stop financial submissions, ingestion publication, projection, and keeper work.
2. Preserve the conflicting blocks, hashes, logs, and checkpoints.
3. Never move a checkpoint forward manually.

Resume only after the canonical chain stabilizes, affected transactions are
reclassified, ingestion catches up from a trusted ancestor, and rebuilt/live
projections match direct onchain state.

## Public incident communication

The first notice should state only verified facts:

- Start time and affected chain.
- Affected and unaffected functions.
- Whether transaction submission is disabled.
- Whether contracts remain directly callable.
- Whether user funds or accounting are known to be affected.
- Next update time.

Do not announce resolution until canonical transactions, balances, liabilities,
supplies, principal, routes, and application state have been reconciled. During
a SEV-0 incident provide updates at least every 30 minutes, even when the update
is that investigation continues.

## Reopening checklist

Financial submissions may resume only when all applicable items pass:

- Root cause identified and incident scope bounded.
- Every submitted hash classified; no ambiguous nonce remains.
- LAN gateway healthy with canonical agreement and no fallback traffic.
- Contract bytecode, roles, route identities, and release hashes verified.
- Exact chain, live-database, rebuilt-database, API, and queue reconciliation.
- All liabilities backed; fee and reward conservation exact.
- Fixed supplies and locked principal unchanged.
- No unexpected allowances or unattributed assets.
- Focused and adjacent regression tests pass.
- Any code correction completed Devnet, Testnet, fork, and release gates required
  by its scope.
- A clean reproducible release and exact recovery manifest are sealed.
- Guardian pause and application transaction-disable controls are retested.
- The incident commander records the explicit reopen decision and evidence hash.

A contract or accounting correction requires a fresh schema. An application or
infrastructure correction follows Devnet to Testnet to Mainnet promotion. Neither
path permits replay of confirmed work.

## Required drills before and after Public activation

Before outside-user activation and quarterly thereafter:

1. Dry-run the application transaction-disable switch.
2. Rehearse guardian pause and route-disable calldata on an exact fork.
3. Rehearse an ambiguous transaction without broadcasting to Mainnet.
4. Rebuild a clean projection from canonical logs.
5. Restore the latest encrypted backup into isolated services.
6. Exercise LAN degradation and prove Alchemy receives probe traffic only.
7. Test the external human alert path.
8. Verify Safe owners, threshold, modules, fallback handler, and Timelock cancellation.
9. Time the five-minute containment drill and record gaps.

Seal drill evidence and feed every missed step back into this runbook.

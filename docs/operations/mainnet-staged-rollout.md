# Schema-17 Unanimous-Bootstrap Mainnet Staged Rollout

## Authority boundary

Schema-17 replaces the unused, fully Paused Schema-16 deployment with a fresh
RDAO, one-hour Timelock, Governor V2, and protocol stack. It reuses the existing
Safe and verified Robinhood/Uniswap infrastructure. Passing this runbook produces a frozen Mainnet manifest and an
internal GO recommendation. It does not authorize an Ethereum bridge
transaction, Robinhood Mainnet deployment, route activation, canary launch,
profile change, or public activation. Every Mainnet transaction requires
authorization for the exact frozen manifest and phase.

No temporary EOA may replace the production Safe, Timelock, treasury, or
governance roles. Keys, passwords, allocation secrets, signatures, raw
calldata, and protected configuration never belong in Git, evidence, or
`MEMORY.md`.

## Plan-bound bootstrap and unanimous-owner governance

The canonical Safe v1.4.1 proxy remains the guardian and Timelock canceller,
with the protected deployer as its only owner and threshold one. A fresh fixed
one-billion RDAO supply is allocated entirely to the deployer. The fresh
Schema-17 Timelock is the Governor execution authority.

The Timelock commits at construction to exactly two zero-value bootstrap
batches. Only the deployer may execute them, only in order, and only during the
48-hour bootstrap window. Step one enables the qualified bounded routes,
resumes conversions, and enters Canary for the deployer. Step two installs the
6 ETH/0.5 ETH future-launch profile, applies public caps equal to exactly 10%
of the qualified maxima, and enters Public. Completing step two, the first
nonzero RDAO transfer away from the deployer, expiry, explicit owner
finalization, or Safe abort ends bootstrap irreversibly. Reacquiring every RDAO
cannot restore bootstrap.

After bootstrap, an account that currently owns the fixed supply and held and
delegated the full supply at the previous governance timestamp may schedule an
operation without a vote. The operation still waits the current Timelock delay
and remains cancellable by the Safe. Initial governance timing is a one-hour
voting delay, four-hour voting period, one-hour Timelock, 1% proposal threshold,
and 10% quorum.

This initial mode intentionally concentrates voting, DAO rewards, and emergency pause
authority. Record that residual risk in every readiness and activation report.
When team distribution begins, checkpoint rewards, transfer RDAO, add two
independently controlled Safe owners, raise the threshold to two, and verify a
new `distributed` governance manifest before relying on distributed control.

## Immutable evidence

Record the clean pushed Git SHA, source and deployment-manifest hashes,
creation/runtime bytecode, ABI and storage-layout hashes, application artifact
hashes, external addresses/runtime hashes, Safe owners and threshold,
Timelock, treasury, governor, guardian, deployer, RDAO allocation-file hash,
chain ID, fork block, direct v4 pool state, and route caps.

The protected transaction journal is
`/home/hendo420/robyn-evidence/mainnet/<release-id>/transactions.jsonl`.
Before every transaction append an intent with
`scripts/mainnet-transaction-journal.mjs`; append its receipt immediately after
confirmation. Never reuse an idempotency key or replay a confirmed transaction.

## Contract invariants

- Coordinator deploys in `Paused`.
- Guardian can move any mode only to `Paused`.
- The two exact bootstrap batches or later Timelock governance alone select
  `Canary`, change the canary launcher, resume, or select `Public`.
- `Canary` permits creation only by the protected project deployer.
- Pausing creation does not pause existing trades, claims, or withdrawals.
- Timelock alone updates graduation profiles.
- Target is 0.01 to 100 ETH; maximum purchase is nonzero and at most half the
  target.
- Each request commits to an expected profile version.
- Each launch snapshots its full curve; later governance cannot alter it.
- The DAO may change governance clocks, proposal threshold, quorum, and the
  Timelock delay through their respective governance-only paths.
- The DAO cannot change fixed supplies, the 50/25/20/5 allocation, one-hour
  reward duration, locked creator assignments, locked LP principal, accrued
  liabilities, or existing launch snapshots.
- Allocations, fees, supply, locked principal, and 50/25/20/5 routing remain
  invariant.

## Gate 1: Devnet and internal security

Deploy a fresh native-Anvil stack. Test both exact bootstrap plans, sequencing,
wrong payloads, replay, expiry, distribution, reacquisition, guardian abort,
atomic rollback, all modes, permissions, profile bounds,
rounding, version races, configuration hashes, CREATE2 identity, and existing
launch immutability. Graduate real 0.01 ETH/0.001 ETH and 6 ETH/0.5 ETH
profiles. Verify pool initialization, terminal price, residual ceilings,
position ownership, locked principal, supplies, liabilities, and conservation.

Run all Foundry tests, fuzzing, 256-run/depth-128 invariants, the
512-wallet/25,000-action simulation, line review, Slither, dependency, secret,
license, size, ABI, and storage-layout gates. Require zero unresolved critical,
high, or medium findings.

## Gate 2: Fresh Testnet

Deploy fresh Schema-17 contracts on chain 46630 from the exact candidate.
Archive Schema-16 history and rebuild an empty database from the new block. Verify
runtime hashes, roles, bindings, routes, mode, profile, liabilities, and
release identity.

Exercise the complete two-step bootstrap through one real reward hour and prove
the canary retains its snapshot after step two. Complete focused recovery,
reconciliation, LAN degradation checks with Alchemy probe-only, and browser
acceptance. Any contract change invalidates all contract-dependent evidence.

## Gate 3: Exact Mainnet fork

Pin chain 4663 immediately before execution. Requery every Robinhood token,
Uniswap contract, direct v4 route, and runtime hash. Use real direct v4
liquidity; never seed synthetic route liquidity. Fund only local fork actors.

Execute this sequence:

1. Deploy Paused with conversions and all routes disabled and verify both exact
   bootstrap hashes.
2. Verify roles, hashes, balances, supplies, and zero liabilities.
3. Execute bootstrap step one and enter Canary for the project deployer.
4. Create and graduate a WETH-basket canary.
5. Exercise bonding, graduated swaps, fees, conversion, settlement, one-hour
   streams, pull claims, and creator split locking.
6. Test every required core asset with a guarded bounded round trip.
7. Execute bootstrap step two to install 6 ETH/0.5 ETH and exact 10% public
   route caps.
8. Prove the canary is unchanged and a second launch snapshots the new version.
9. Verify Public permissionless creation and irreversible bootstrap
   finalization, then use the guardian to return the rehearsal to Paused.

A missing, synthetic, or non-v4 required route fails the rehearsal. Optional
routes remain disabled individually.

## Gate 4: RPC and funding

Observe `192.168.50.173:8547` for 48 consecutive healthy hours with bounded
Alchemy chain/head/sync comparison probes. LAN is the sole active application
upstream and automatic fallback is prohibited. Require chain 4663,
`eth_syncing=false`, normal lag at
most 50 blocks, no corruption/OOM/unplanned restart, canonical agreement,
healthy recovery, and sufficient disk runway.

The approved funding ceiling is exactly `0.04707292 ETH`. Measure every
deployment, binding, activation, launch, bonding, graduation, swap, settlement,
claim, governance, unwind, and post-unwind transaction from successful
chain-4663 fork receipts. Synthetic estimates and omitted lifecycle phases
fail the gate. L2 funding must cover 150% of measured deployment cost, 150% of
measured canary cost, 0.01 ETH locked principal, and a retained 0.02 ETH
operational reserve. L1 must retain twice the current `depositEth()` estimate
plus the 0.01 ETH emergency reserve.

Use `pnpm estimate:mainnet-bridge` to verify chain ID 1, the official Delayed
Inbox address and pinned runtime hash, and estimate `depositEth()` without
signing or broadcasting. Use `pnpm measure:mainnet-funding` only with the exact
fork receipt ledger and bridge estimate. A failed report means no bridge and no
deployment; reserves, headroom, and coverage cannot be reduced to make it pass.

At execution verify chain ID 1, deployer identity, and official bridge runtime
code. Bridge only the calculated amount from deployer to itself. Journal the
L1 intent/receipt, retryable identity, L2 redemption, balances, and checksums.
Do not deploy until the deposit and L2 balance are independently verified.

## Gate 5: Paused deployment

After explicit authorization, deploy the fresh RDAO, Schema-17 Timelock,
Governor V2, and protocol stack in Paused with the canary profile,
conversions paused, routes disabled, and application transactions disabled.
Complete bindings while Paused. Verify constructor arguments, bytecode, Safe,
Timelock, roles, supplies, allocation, routes/caps, profile, liabilities, and
balances. Any mismatch archives the deployment and stops rollout.

## Gate 6: Controlled canary

After separate exact-manifest authorization, execute bootstrap step one to
enter Canary and enable only independently qualified routes at bounded caps.
Create one project WETH basket launch.
Exercise bonding, graduation, both swap directions, fees, conversion,
settlement, streams, all pull claims, and creator split locking.

All bonding tokens remain in protected project software wallets. After the
one-hour claims and governance checks, quote the complete project-held launch
token balance and submit at most one bounded exact-input unwind with a deadline
and quote-derived minimum output. Do not retry a submitted transaction blindly.
Then harvest and settle the resulting fees, process one bounded final reward
cycle, and reconcile. The position NFT and locked LP principal are never
removed. Count only liquid native ETH returned to the deployer as recovered
capital; report treasury, DAO, basket assets, gas, fees, and locked liquidity
separately. Observe 24 consecutive healthy hours after the final action.

Test required assets with the smallest safe round trip. A route failing its
runtime hash, pool liquidity, v4 quote, TWAP/reference-tick protection, cap, or
round trip remains disabled. Observe 24 consecutive healthy hours after the final action with
exact reconciliation and zero accounting, supply, principal, or solvency
anomaly.

## Gate 7: Public promotion

After exact canary reconciliation, execute the precommitted bootstrap step two.
It installs 6 ETH/0.5 ETH for future launches, applies route caps equal to 10%
of qualified maxima, enters Public, and irreversibly finalizes bootstrap.
Verify the canary retains its snapshot before enabling Mainnet application
writes in the same controlled window. Staff the first 24 public hours.

## Failure policy and final report

For contract, accounting, principal, or supply anomalies, guardian pauses
launches and conversions, disables affected routes, and the app disables
transactions. Existing claims and safe exits remain available. Preserve
evidence and never replay confirmed transactions.

For RPC/application failure, pause automated writes and mark the application
connection degraded. Do not route application traffic to Alchemy unless the
owner explicitly authorizes the protected operator selection after chain/head
checks pass. Repair through Devnet, Testnet, then Mainnet. A
contract correction requires a fresh schema and every contract-dependent gate.

Final GO requires exact reconciliation, zero insolvency, exact fee/reward
conservation, unchanged supply and principal, evidence checksums, clean
`origin/main`, reproducible builds, exact served SHA, an annotated tag, and
explicit authorization for the frozen manifest. Disclose internal-only audit
coverage and that no independent audit, external penetration test, or legal
review is claimed.

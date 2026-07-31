# Schema-16 V4-Only Mainnet Staged Rollout

## Authority boundary

Schema-16 retains governed launch activation and future-launch-only graduation
profiles while removing every external execution-adapter path. Passing this runbook produces a frozen Mainnet manifest and an
internal GO recommendation. It does not authorize an Ethereum bridge
transaction, Robinhood Mainnet deployment, route activation, canary launch,
profile change, or public activation. Every Mainnet transaction requires
authorization for the exact frozen manifest and phase.

No temporary EOA may replace the production Safe, Timelock, treasury, or
governance roles. Keys, passwords, allocation secrets, signatures, raw
calldata, and protected configuration never belong in Git, evidence, or
`MEMORY.md`.

## Sole-owner bootstrap governance

The initial protected governance mode is `sole-owner-bootstrap`. The canonical
Safe v1.4.1 proxy has the protected deployer as its only owner and threshold
one. The fixed one-billion RDAO supply is allocated entirely to that deployer;
the Timelock receives no RDAO but remains the Governor execution authority.
The Safe is still the guardian and Timelock canceller, so protocol roles never
point directly at an EOA.

This mode intentionally concentrates voting, DAO rewards, and emergency pause
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
- Timelock alone selects `Canary`, changes the canary launcher, resumes, or
  selects `Public`.
- `Canary` permits creation only by the protected project deployer.
- Pausing creation does not pause existing trades, claims, or withdrawals.
- Timelock alone updates graduation profiles.
- Target is 0.01 to 100 ETH; maximum purchase is nonzero and at most half the
  target.
- Each request commits to an expected profile version.
- Each launch snapshots its full curve; later governance cannot alter it.
- Allocations, fees, supply, locked principal, and 50/25/20/5 routing remain
  invariant.

## Gate 1: Devnet and internal security

Deploy a fresh native-Anvil stack. Test all modes, permissions, profile bounds,
rounding, version races, configuration hashes, CREATE2 identity, and existing
launch immutability. Graduate real 0.01 ETH/0.001 ETH and 6 ETH/0.5 ETH
profiles. Verify pool initialization, terminal price, residual ceilings,
position ownership, locked principal, supplies, liabilities, and conservation.

Run all Foundry tests, fuzzing, 256-run/depth-128 invariants, the
512-wallet/25,000-action simulation, line review, Slither, dependency, secret,
license, size, ABI, and storage-layout gates. Require zero unresolved critical,
high, or medium findings.

## Gate 2: Fresh Testnet

Deploy fresh contracts on chain 46630 from the exact candidate. Archive
Schema-13 history and rebuild an empty database from the new block. Verify
runtime hashes, roles, bindings, routes, mode, profile, liabilities, and
release identity.

Exercise governance from canary to production and prove old launches retain
their snapshots. Complete encrypted backup, isolated restore, one-fault
recovery, LAN-primary/Alchemy-fallback drills, reconciliation, browser
acceptance, and a fresh uninterrupted endurance campaign. Any contract change
invalidates all contract-dependent evidence.

## Gate 3: Exact Mainnet fork

Pin chain 4663 immediately before execution. Requery every Robinhood token,
Uniswap contract, direct v4 route, and runtime hash. Use real direct v4
liquidity; never seed synthetic route liquidity. Fund only local fork actors.

Execute this sequence:

1. Deploy Paused with conversions and all routes disabled.
2. Verify roles, hashes, balances, supplies, and zero liabilities.
3. Install 0.01 ETH/0.001 ETH and enter Canary for the project deployer.
4. Create and graduate a WETH-basket canary.
5. Exercise bonding, graduated swaps, fees, conversion, settlement, one-hour
   streams, pull claims, and creator split locking.
6. Test every required core asset with a guarded bounded round trip.
7. Install 6 ETH/0.5 ETH.
8. Prove the canary is unchanged and a second launch snapshots the new version.
9. Enter Public, prove permissionless creation, then return to Paused.

A missing, synthetic, or non-v4 required route fails the rehearsal. Optional
routes remain disabled individually.

## Gate 4: RPC and funding

Observe `192.168.50.173:8547` for 48 consecutive healthy hours with Alchemy
comparison/fallback. Require chain 4663, `eth_syncing=false`, normal lag at
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

After explicit authorization, deploy in Paused with the canary profile,
conversions paused, routes disabled, and application transactions disabled.
Complete bindings while Paused. Verify constructor arguments, bytecode, Safe,
Timelock, roles, supplies, allocation, routes/caps, profile, liabilities, and
balances. Any mismatch archives the deployment and stops rollout.

## Gate 6: Controlled canary

After separate authorization, enter Canary and enable only independently
qualified routes at bounded caps. Create one project WETH basket launch.
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

DAO governance installs 6 ETH/0.5 ETH. Verify the canary retains its snapshot.
Remain Paused until the proposal is final, routes pass, state reconciles,
monitoring is staffed, and public activation is authorized.

Enter Public and enable Mainnet submissions in one controlled window. Begin
route caps at 10% of qualified maxima and staff the first 24 public hours.

## Failure policy and final report

For contract, accounting, principal, or supply anomalies, guardian pauses
launches and conversions, disables affected routes, and the app disables
transactions. Existing claims and safe exits remain available. Preserve
evidence and never replay confirmed transactions.

For RPC/application failure, pause automated writes and use Alchemy only after
chain/head checks pass. Repair through Devnet, Testnet, then Mainnet. A
contract correction requires a fresh schema and every contract-dependent gate.

Final GO requires exact reconciliation, zero insolvency, exact fee/reward
conservation, unchanged supply and principal, evidence checksums, clean
`origin/main`, reproducible builds, exact served SHA, an annotated tag, and
explicit authorization for the frozen manifest. Disclose internal-only audit
coverage and that no independent audit, external penetration test, or legal
review is claimed.

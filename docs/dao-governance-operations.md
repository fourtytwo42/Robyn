# DAO Governance and Fee Operations

## Architecture

`RobynDaoLaunchCoordinator` atomically registers each launch with `RobynProtocolFeeRouter`. The router recognizes only that launch's market and immutable LP locker. It immediately forwards the basket half and records three base-asset liabilities. `UniswapV3NativeFeeConverter` performs guarded launch-to-base and base-to-wrapped-native swaps, unwraps, and returns native ETH. Creator balances stay in the router, RDAO rewards enter transfer-aware token accounting, and treasury ETH enters `TimelockController`.

RDAO delegates govern the timelock through `RobynGovernor`. The guardian Safe is intentionally outside treasury custody and has only conversion-pause and queued-operation cancellation authority.

## Operational controls

- Keeper default minimum base queue: `KEEPER_MINIMUM_PROTOCOL_BASE=10000000000000000`.
- Keeper default maximum base batch: `KEEPER_MAXIMUM_PROTOCOL_BASE=100000000000000000`.
- Keeper default minimum launch-token batch: `KEEPER_MINIMUM_LAUNCH_FEES=1000000000000`.
- Every conversion recomputes its safe minimum immediately before simulation and submission.
- Repeated safety failure is an expected queued state, not permission to relax TWAP, impact, or deadline limits.
- Guardian pause stops both conversion paths. Only the timelock can unpause.
- Do not manually transfer fee-router assets; reconcile contract liabilities and event totals first.

## Reconciliation

For each `BaseFeesRouted`, total equals basket + creator + DAO + treasury. Basket is `total - creator - DAO - treasury`, so pre-conversion integer dust favors holders. For each bounded native conversion, the selected input is consumed proportionally from all three queues. Native output is assigned proportionally to creator and DAO; the remainder goes to treasury.

Reconcile:

1. Sum canonical market and locker fee events.
2. Match router `cumulativeBaseFees` plus launch-fee sale output.
3. Match basket vault receipts and the three remaining base queues.
4. Match native conversion input against queue reductions.
5. Match creator liabilities/claims, `totalDaoNativeRewards`, RDAO deposits/claims, `totalTreasuryNative`, and timelock receipts.

## Threat model

- Pool/TWAP manipulation: reject insufficient observations and excessive current/mean tick deviation.
- Large trade price impact: compare quoter output with the pool's post-fee spot output and reject beyond the configured impact bound.
- Keeper sandwich or stale transaction: enforce quoter-derived minimum and deadline; keeper is permissionless and gains no custody.
- Queue denial of service: bounded partial native conversion prevents one oversized queue from requiring a single unsafe swap.
- Reentrancy or reverting recipients: routing and claims are non-reentrant pull payments; failed recipient transfer reverts only that claim.
- Reward sniping: intentionally accepted for instant deposits and disclosed in product/legal copy.
- Flash voting: Governor reads timestamp checkpoints and applies a one-day delay.
- Governance capture: 10% quorum, 1% threshold, three-day voting, two-day timelock, visible calldata, and cancellable malicious queue; these reduce but do not eliminate capture risk.
- Guardian compromise: guardian cannot move treasury, unpause, change rewards, or alter votes.
- System-balance dilution: permanent reward exclusions remove protocol and timelock balances from eligible supply.

## Incident response

For unsafe conversion behavior, guardian pauses immediately, operators preserve RPC/log/queue evidence, and governance reviews settings or route replacement. Never move treasury or fee-router balances as an ad hoc recovery. A timelock proposal may replace the approved converter for future retries only after review. Existing economic liabilities remain unchanged.

## Deployment gates

Schema-v4 manifests bind RDAO, Governor, Timelock, guardian, `RobynProtocolFeeRouterV2`, native converter, native pool, fee policy, `per-token-v2` creator accounting, allocation, DEX provenance hash, and exact Git commit. Verification proves code presence, bindings, role renunciation, supply, exclusions, governance settings, expanded launch fee registration, and chain ID. The isolated chain-46630 rehearsal must prove bonding, graduation, basket rewards, bounded native conversion, token-attributed creator claim, and RDAO claim. Public testnet remains no-broadcast until separately authorized.

## Creator reward operations

- Keeper conversion remains permissionless and bounded. Pending creator base is not claimable or presented as ETH until native conversion succeeds.
- Creator claims are launch-token scoped. Operators diagnose claims with `launchAccount(token)` and reconcile `claimableCreatorNative + claimedCreatorNative == cumulativeCreatorNative` for completed conversion credit.
- The active v4 router assigns creator fees to one to eight creator-selected
  recipients under a rolling one-hour linear release. Shares must total 10,000
  basis points. Open splits affect future fees only; locked splits are
  irreversible. Reconcile each recipient's claimable, unvested, and claimed
  amounts against its cumulative assigned amount, then reconcile recipient
  totals to the launch-level creator liability.
- Batch claim failures are fail-closed: an unknown token, foreign creator, invalid recipient, reentrancy, or failed native receiver reverts every debit and event.
- The public DAO surface shows aggregate creator liability for solvency only. Personal creator claim controls live on the canonical token page and `/portfolio`.
- Incident response must compare the sum of all launch `claimableCreatorNative` values with `totalCreatorNativeLiability` before and after any recovery, index rebuild, or release promotion.

### Initial RDAO allocation

Real Robinhood Testnet deployment requires `ROBYN_RDAO_ALLOCATION_MANIFEST` to point to a reviewed JSON file matching `config/rdao-allocation.example.json`. Each row names a unique wallet, an integer `shareBps`, and a non-empty purpose. Shares must total exactly 10,000 basis points. The reserved `timelock` account is resolved only after deployment and must appear with purpose `dao-treasury-reserve`. The deployment records the resolved allocation plus the source file SHA-256 and the verifier independently checks every onchain balance. Do not commit the real member allocation until the participants approve public association of their wallet addresses.

The isolated rehearsal deliberately substitutes a deterministic 80% contributor / 20% timelock allocation. It is test data only and cannot satisfy the real-broadcast gate.

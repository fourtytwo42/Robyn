# Sherwood Forest schema-11 internal security review

Status: source review and automated contract gates passed; fresh testnet
deployment and operational acceptance remain pending

Verdict: NO-GO for Robinhood Mainnet

Last verified: 2026-07-28

This is an internal AI-assisted engineering review. It is not an independent
professional audit, does not prove that the contracts contain no undiscovered
defects, and does not authorize a Robinhood Mainnet deployment.

## Audited target

- Authoritative worktree:
  `/home/hendo420/Robyn-one-hour-rewards`
- Branch: `codex/one-hour-pull-claims`
- Base commit: `2eb489404841b589d0e3510d1aba0b8619b96b1b`
- Intended deployment schema: 11
- Target chain: Robinhood Testnet `46630`
- Mainnet transactions broadcast: none

The review covers the complete active schema-11 contract set, with particular
attention to:

- `RobynLaunchToken`
- `RobynDaoToken`
- `RobynNativeProtocolFeeRouterV4`
- `RobynV4BondingCurveMarket`
- the phase-aware hook, position locker, graduation adapter, asset router,
  launch factory, deployers, coordinator, basket vault, governor, and timelock
  wiring

Archived v3, devnet, and predecessor contracts remain regression inputs but are
not active schema-11 runtime contracts.

## Security result

No unresolved critical, high, or medium finding remains in the reviewed
schema-11 source.

The automated security gate reported:

- Git-history secret findings: 0
- Known high or critical dependency vulnerabilities: 0
- Slither detector results:
  - High: 1 reviewed call-graph false positive
  - Medium: 57 reviewed
  - Low: 42
  - Informational: 39
  - Optimization: 1
- Unresolved high findings: 0
- Unresolved medium findings: 0
- License inventory: 793 packages across 24 license groups

The one high Slither result is limited to a terminal bonding purchase that can
route a fee and refund excess input before `_graduate` clears
`curveNativePrincipal`. Both purchase entry points use the same
`nonReentrant` guard. Curve reserves and principal are committed before those
calls, and `_graduate` sets `graduated` and clears principal before calling the
immutable adapter. No callback can buy, sell, graduate, sweep, or extract the
principal. The automated gate recognizes only this exact call graph and fails
on any other high result.

## One-hour reward review

### Launch-holder basket rewards

Each converted basket asset has an independent rolling one-hour stream.
Deposits checkpoint vested value and extend only the remaining unvested amount.
Transfers checkpoint both accounts before balances move, so the prior holder
keeps rewards earned while holding and the recipient earns only after receipt.
Excluded protocol inventory cannot earn rewards.

When eligible supply is zero, undistributed value is queued. Anyone may
activate the queue after eligible supply returns. Claims remain pull-based and
transfer only the currently vested amount.

### DAO rewards

DAO native rewards use the same transfer-aware rolling one-hour release.
Previously earned rewards remain claimable after an RDAO transfer. Zero
eligible supply queues rewards without blocking fee intake or other
settlements.

### Creator rewards

The router maintains a separate one-hour native stream for every launch and
recipient. Each fee allocation uses the creator split active at that moment.
Changing an open split affects only later fees; removed recipients retain and
continue unlocking previously assigned value. A locked split cannot be
changed.

Individual, batch, claim-to, and batch-claim-to functions debit vested
liabilities before the external transfer. Failed transfers revert the entire
claim and restore the liability.

### Rounding and solvency

Holder and DAO accumulators use full-precision `Math.mulDiv`. Amounts too small
to represent at the current eligible supply remain queued rather than becoming
unattributed revenue. Creator streams track exact per-recipient amounts without
a per-share accumulator.

Router solvency includes vested and unvested creator value. Holder, DAO,
creator, basket, and treasury conservation remain subject to the immutable
50/25/20/5 allocation.

## Forced-ETH handling

The bonding market separately tracks curve principal and unattributed native
value. A forced balance cannot increase buy reserves, fund a sell, become
graduation principal, or be misclassified as fees. Anyone may sweep only the
unattributed amount to the immutable router treasury.

The existing adapter, asset-router, locker, and fee-router forced-asset
protections remain part of the fresh deployment set.

## Validation evidence

Completed source gates:

- Repository formatting, lint, and all seven workspace typechecks pass.
- Production application build passes.
- Contract size gate passes for every active deployable contract.
- Complete repository test command passes.
- Foundry result: 188 passed, 0 failed, 1 environment-gated skip.
- Required invariant profile passes at 256 runs and depth 128.
- The deterministic 512-wallet, 32-launch, 25,000-action simulation passes all
  20 fixed seeds.
- Claims at 0, 10, 30, 59, and 60 minutes pass.
- Rolling deposits preserve vested value.
- Holder and DAO transfer-boundary tests pass.
- Creator future-only split, irreversible lock, direct, batch, claim-to,
  batch-claim-to, and failed-recipient tests pass.
- Zero-supply queue and permissionless activation tests pass.
- Forced-ETH segregation, graduation, and treasury-only sweep tests pass.
- Schema-11 deployment verifier and campaign policy tests pass.

Security output is stored on the authoritative VM at:

`/tmp/one-hour-security-final.json`

Release evidence must be copied into the sealed schema-11 evidence directory
before deployment promotion.

## Remaining blockers

Schema 11 remains testnet-only until all of the following pass against one
exact pushed release:

1. Two clean reproducible builds.
2. Live gas and funding preflight while preserving the `0.0015 ETH` reserve.
3. Fresh immutable Robinhood Testnet deployment and runtime/role verification.
4. Archive of the predecessor deployment and canonical empty-database rebuild.
5. Full 100-software-wallet lifecycle campaign, including all 24 basket routes,
   multiple launches and graduations, direct and routed swaps, settlements,
   conversions, one-hour accrual, claims, and governance.
6. Browser acceptance for public UI, responsive, accessibility, disconnected,
   and error states. Transactional wallet testing uses only the encrypted
   VM-only software-wallet campaign.
7. Recovery, encrypted backup, and isolated restore.
8. A fresh endurance gate against the exact deployed release.
9. Independent professional smart-contract audit of the final exact commit.

Robinhood Mainnet deployment remains unapproved.

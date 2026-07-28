# Sherwood Forest security remediation review

Status: implementation candidate validated locally; testnet deployment and independent audit pending

Last verified: 2026-07-27

This is an internal engineering and AI-assisted security review. It is not an
independent professional audit and does not approve Robinhood mainnet
deployment.

## Scope

The reviewed candidate replaces every contract coupled to launch-pool phases,
fee collection, reward settlement, or reward eligibility:

- `RobynLaunchToken`
- `RobynDaoToken`
- `RobynTokenSink`
- `RobynNativeBasketVaultV2`
- `RobynNativeProtocolFeeRouterV4`
- `RobynV4FeeAndPhaseHook`
- `RobynV4FeePositionLocker`
- `RobynV4GraduationAdapter`
- `RobynV4BondingCurveMarket`
- v4 factories, deployers, coordinator, and asset router
- testnet Governor and immutable Timelock bindings

Archived contracts remain compiled for regression coverage but are excluded
from active-runtime detector counts.

## Finding closure

| ID | Prior severity | Remediation | Proof status |
|---|---:|---|---|
| SF-01 | High | The phase hook blocks swaps, liquidity additions, and donations in `Bonding`. Only the immutable PositionManager can add liquidity during the adapter-controlled `Graduating` phase. The adapter changes to `Trading` only after the locker verifies ownership and principal liquidity. Phase changes are atomic, one-way, and have no administrator override. | Focused pre-graduation direct-swap, liquidity, donation, unchanged-price, unchanged-observation, graduation, and post-graduation liquidity tests pass. |
| SF-02 | Medium | The locker records principal liquidity, native residual, token residual, collected native fees, collected token fees, and unattributed balances separately. Only exact balance increases measured around `collectFees` become fee balances. Principal residual cannot be converted, routed, rescued, or swept. | Principal segregation and unsolicited-balance tests pass. Native residual remains held and excluded from unattributed ETH after sweeping. Position liquidity is unchanged. |
| SF-03 | Medium | Fee intake performs accounting only. Basket, DAO, treasury, and creator amounts become separate liabilities. DAO settlement is unavailable while eligible supply is zero, but trading and all other settlement paths remain live. The full DAO liability remains queued. | Zero-supply trade and later settlement regression passes. Router solvency is included in invariants and admin-health reconciliation. |
| SF-04 | Medium | Basket and DAO deposits form transfer-aware rolling one-hour streams. Transfers settle both accounts before balances change. New holders receive no previously vested rewards, and same-block entries receive zero. Zero eligible supply pauses unvested value and permissionlessly restarts it when supply returns. | Same-block capture, ten-minute accrual, transfer timing, prior-holder preservation, zero-supply pause, and permissionless-resume tests pass. |
| SF-05 | Low | Unsolicited launch tokens can only move to an immutable excluded sink. Unsolicited locker ETH and router ETH can only move to the Timelock treasury. Principal and tracked liabilities are excluded from sweepable amounts. | Forced/unattributed balance tests and accounting invariants pass. |

## Manual review conclusions

### Phase authority and atomic graduation

Pool registration is restricted to the one-time-bound market factory. Each pool
records one immutable adapter as its phase controller. The adapter itself can
only be invoked by the immutable bonding market. `beginGraduation`, position
minting, locker ownership checks, principal checks, `activateTrading`, and the
market's final graduation state occur in one transaction. A revert at any step
restores `Bonding`.

The `beforeAddLiquidity` callback permits the PositionManager during
`Graduating`. External transactions cannot interleave with the atomic
graduation transaction. The launch token is a fixed implementation without
callbacks, and the adapter and locker are non-reentrant.

### Principal and fee attribution

The locker does not infer fees from its total balances. It measures native and
token deltas around a zero-liquidity-decrease collection call, confirms
position liquidity before and after, and credits only those deltas. Routing and
conversion debit tracked balances before interaction.

Native and token residual ceilings are immutable per deployment. Both the
rehearsal testnet configuration and proposed production configuration now cap
native residual at 1 gwei and token residual at 0.000001 launch token.

The first mainnet-fork run failed with roughly 0.5 ETH of native residual. The
cause was a mismatch between the virtual reserves and the 800 million bonding,
200 million graduation, and 6 ETH target allocations. The corrected production
curve uses a 1,066,666,666.666666666666666666 virtual-token reserve and 2 ETH
virtual-native reserve. Curve exhaustion occurs at 6 ETH plus one wei and the
200 million graduation tokens consume that native inventory at the exact
terminal price. The corrected no-broadcast mainnet-fork lifecycle passes the
residual ceilings.

### Non-blocking liabilities

`routeNativeFees` divides every receipt into exact 50/25/20/5 liabilities and
does not call an external recipient. Permissionless settlement functions debit
only the chosen liability. A failed vault, DAO, treasury, or creator transfer
reverts that isolated call and restores its liability without affecting fee
intake or another destination.

The basket settlement call is restricted to the immutable vault registered by
the atomic coordinator after validating `vault.launchToken()`. Slither's
arbitrary-send detector is suppressed at that exact call site after manual
authority tracing. No detector class is globally disabled.

### Streaming rewards

Stream vesting is linear in wall-clock seconds for one hour. A new deposit
first records vested value, then combines the remaining unvested value and new
deposit into a new one-hour stream. Account accrual is updated before every
eligible transfer. Claims clear state before token or native transfer and use
function-wide reentrancy guards.

The stream reduces predictable settlement sniping. It does not require holders
to retain tokens after rewards have vested, and it does not claim to prove that
distinct wallets represent distinct people.

## Automated evidence

Evidence directory:

`/home/hendo420/robyn-evidence/security-remediation/`

Completed gates:

- Full repository format, strict typecheck, lint, application tests, script
  checks, Anvil smoke tests, Foundry suites, deployment nonce test, and
  deployment-verifier test passed.
- Foundry full suite passed with 160 tests.
- Required invariant profile passed 32 invariants at 256 runs and depth 128.
- The deterministic 512-wallet, 32-launch, 25,000-action simulation passed its
  20 fixed seeds.
- Slither completed against the active remediation scope with zero unresolved
  critical, high, or medium findings. Forty-eight medium detector results are
  retained and reviewed across `incorrect-equality`, `reentrancy-no-eth`,
  `uninitialized-local`, and `unused-return`.
- Git-history secret findings: 0.
- Known high or critical dependency vulnerabilities: 0.
- Active contract size limits pass.
- A standard-limit chain-46630 fork deployment found and closed a missed
  EIP-170 blocker in the combined token-and-vault CREATE2 deployer. The
  remediated release uses separate token and vault deployers, and the size gate
  now covers every deployed component. The complete stack and genesis launch
  deploy without disabling the size limit.
- The exact fork rehearsal passes the deployment verifier and measures
  59,143,474 gas across 56 deployment and configuration transactions. At the
  sampled execution and L1-data prices, 25% headroom requires
  890,050,177,359,800 wei.
- The corrected production configuration passes a no-broadcast Robinhood
  mainnet fork lifecycle through the official read-only public RPC. It verifies
  chain 4663 venue and Stock Token code, atomic launch, the 6 ETH graduation
  target, residual ceilings, post-graduation trading, hook and LP settlement,
  basket conversion, one-hour vesting, all claim paths, treasury receipt, and
  unchanged locked principal.
- Database, indexer, keeper, API, and web strict typechecks pass.
- The indexer now ingests token, vault, market, adapter, and locker addresses
  from each canonical atomic launch receipt.

## Remaining release blockers

The following are not complete and must not be reported as passed:

1. Fresh Robinhood Testnet deployment and at least eight-launch lifecycle
   campaign.
2. Canonical empty-database reconstruction and reconciliation.
3. Desktop, tablet, mobile, MetaMask, and Robinhood Wallet acceptance.
4. Service interruption, RPC recovery, encrypted backup, and isolated restore.
5. A fresh uninterrupted eight-hour endurance gate.
6. Reproducible release builds and exact served-release verification.
7. Independent professional audit of the final exact commit.

The current public schema-v9 deployment remains archived testnet history. The
stopped endurance run remains stopped and provides no assurance for this
candidate.

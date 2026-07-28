# Sherwood Forest Smart Contract Security Audit - 2026-07-28

## Verdict

**NO-GO for Robinhood Mainnet.**

The current immediate-reward testnet contracts close the prior phase-gating, principal-accounting, zero-DAO-supply, and adapter/asset-router unsolicited-ETH issues, but the audit found one new high-severity launch-lifecycle denial-of-service issue and one medium-severity reward-timing issue.

This is an internal engineering audit of the current source and deployed testnet release. It is not an independent professional audit, penetration test, legal review, or mainnet approval.

## Scope

- Audited source commit: `2eb489404841b589d0e3510d1aba0b8619b96b1b`
- Served testnet release path: `/opt/robyn/testnet-releases/2eb489404841b589d0e3510d1aba0b8619b96b1b`
- Deployment manifest: `deployments/46630-v4.json`
- Deployment source commit in manifest: `721d008c539cdd13564c92c5c5c9e06c2af63be1`
- Active chain: Robinhood Testnet `46630`
- Evidence directory: `/home/hendo420/robyn-evidence/security-audit-2eb4894-2026-07-28`

The deployed Solidity in the active manifest matches the current audited source for `packages/contracts/src`.

## Summary Findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| SF-2026-07-28-01 | High | Forced ETH sent to a bonding market can permanently block graduation | Open |
| SF-2026-07-28-02 | Medium | Immediate holder and DAO rewards are captured by balance at settlement time | Open, product decision needed |
| SF-2026-07-28-03 | Low | Forced ETH can remain operationally stuck in already-graduated bonding markets and the hook | Open |
| SF-2026-07-28-04 | Informational | Slither medium findings are mostly known false positives or generic Solidity-0.8 defaults, but should stay documented | Reviewed |

## SF-2026-07-28-01 - Forced ETH Can Block Graduation

**Severity:** High

`RobynV4BondingCurveMarket` rejects normal direct ETH in `receive()`, but the EVM can still force ETH into the contract via `selfdestruct`. The market later graduates using the entire contract balance:

- `packages/contracts/src/uniswap/RobynV4BondingCurveMarket.sol:118` rejects normal receive calls unless they come from the graduation adapter.
- `packages/contracts/src/uniswap/RobynV4BondingCurveMarket.sol:316` calculates final price.
- `packages/contracts/src/uniswap/RobynV4BondingCurveMarket.sol:319` sets `nativeLiquidity = address(this).balance`.
- `packages/contracts/src/uniswap/RobynV4BondingCurveMarket.sol:323` forwards that full balance into `graduationAdapter.graduate`.
- `packages/contracts/src/uniswap/RobynV4FeePositionLocker.sol:223` calculates the native refund.
- `packages/contracts/src/uniswap/RobynV4FeePositionLocker.sol:225` reverts if the residual exceeds the strict native residual ceiling.

This means an attacker can force a small amount of ETH into a launch market before the terminal buy. That extra ETH is not part of the curve accounting, but it becomes part of the graduation liquidity payload. The locker sees the excess native refund and reverts with `ResidualTooLarge`, leaving the launch ungraduated. There is no market-level sweep or excluded-balance accounting path that can clear the forced ETH before graduation.

**Proof:**

Temporary proof test `testAuditForcedNativePermanentlyBlocksGraduation` passed in three inherited Foundry suites. It forced `0.01 ETH` into a fresh bonding market, advanced the curve to the terminal buy, and confirmed the terminal buy reverts with:

`ResidualTooLarge(10000000000000943, 6293)`

Evidence:

- `/home/hendo420/robyn-evidence/security-audit-2eb4894-2026-07-28/forced-market-proof.patch`
- `/home/hendo420/robyn-evidence/security-audit-2eb4894-2026-07-28/forced-market-proof-final.log`

**Impact:**

An attacker can permanently prevent a specific launch from graduating. This blocks the transition into the v4 trading phase and can trap the token in bonding even after buyers supply enough ETH to complete the curve.

**Recommendation:**

Do not base graduation liquidity on `address(this).balance`. Track canonical curve-raised native principal separately from any raw ETH balance. At graduation, forward only tracked curve principal plus the exact terminal buy contribution. Add `unattributedNative()` and a permissionless sweep to the bonding market for forced ETH that is not part of curve accounting. Add regression tests for forced ETH before first buy, mid-curve, immediately before the terminal buy, and after graduation.

## SF-2026-07-28-02 - Immediate Rewards Are Settlement-Time Capturable

**Severity:** Medium

The current product policy removed vesting delays. The contracts now assign rewards immediately to the eligible balances at deposit or settlement time.

Relevant code:

- `packages/contracts/src/RobynLaunchToken.sol:170` receives reward assets from the basket vault.
- `packages/contracts/src/RobynLaunchToken.sol:181` queues the received amount.
- `packages/contracts/src/RobynLaunchToken.sol:184` distributes immediately when eligible supply is nonzero.
- `packages/contracts/src/RobynLaunchToken.sol:206` calculates claimable reward from current reward-per-share plus accrued balance.
- `packages/contracts/src/dao/RobynDaoToken.sol:109` accepts DAO reward deposits.
- `packages/contracts/src/dao/RobynDaoToken.sol:113` queues the native amount.
- `packages/contracts/src/dao/RobynDaoToken.sol:115` distributes immediately when eligible supply is nonzero.
- `packages/contracts/src/uniswap/RobynNativeProtocolFeeRouterV4.sol:310` settles DAO fees by calling the DAO token.
- `packages/contracts/src/uniswap/RobynNativeBasketVaultV2.sol:174` deposits converted basket rewards into the launch token.

**Proof:**

Temporary proof test `testAuditDaoRewardsAreCapturedBySettlementTimeHolder` passed in three inherited Foundry suites. It created a DAO fee liability, transferred DAO to a temporary holder immediately before settlement, settled DAO fees, transferred the DAO back, and confirmed the temporary holder retained a nonzero claim while holding zero DAO afterward.

Evidence:

- `/home/hendo420/robyn-evidence/security-audit-2eb4894-2026-07-28/dao-reward-timing-proof.patch`
- `/home/hendo420/robyn-evidence/security-audit-2eb4894-2026-07-28/dao-reward-timing-proof.log`

**Impact:**

Anyone who can predict or trigger settlement can hold immediately before settlement, receive a pro-rata claim, and transfer or sell afterward. This applies to DAO rewards and, by the same immediate accounting path, launch-holder basket rewards after basket conversion. Creator rewards are different: they are assigned to the configured creator split at fee-routing time rather than by token balance.

**Recommendation:**

Make an explicit product/security decision before mainnet:

- Accept this behavior and disclose rewards as balance-at-settlement rewards, not time-held yield.
- Or restore a short anti-sniping mechanism such as epochs, time-weighted balances, or delayed settlement windows.

If accepted, keep tests that prove the intended behavior so future reviewers do not rediscover it as an accidental bug.

## SF-2026-07-28-03 - Residual Forced ETH Can Be Operationally Stuck

**Severity:** Low

The latest contracts added sweep paths to the graduation adapter, asset router, fee router, and locker. The bonding market still has no `unattributedNative()` or sweep path. After graduation, forced ETH sent into the market is not a solvency issue, but it can muddy operational balance checks. The hook also receives protocol accounting through explicit functions, but it does not expose a general forced-native sweep.

Relevant code:

- `packages/contracts/src/uniswap/RobynV4BondingCurveMarket.sol:118` rejects normal direct ETH only.
- `packages/contracts/src/uniswap/RobynV4BondingCurveMarket.sol:366` uses a private native send helper but has no public forced-native sweep.
- `packages/contracts/src/uniswap/RobynV4FeeAndPhaseHook.sol:250` handles post-trading swap fee accounting but has no general forced-native rescue.

**Recommendation:**

Add explicit unattributed-asset views and permissionless treasury/sink sweeps for all contracts that can retain balances, including the bonding market and hook. Make sure the bonding-market sweep cannot sweep tracked curve principal before graduation.

## SF-2026-07-28-04 - Static Analyzer Medium Findings

**Severity:** Informational

The repository security script passed, but Slither still emitted 50 medium findings. The script classifies them as reviewed under project policy. Manual review agrees most are generic patterns:

- Solidity local variables defaulting to zero.
- Intentional strict equality checks around exact accounting.
- Low-level native sends after liabilities are debited.
- Unused tuple return values where the used values are assigned and the ignored values are intentionally irrelevant.
- Reentrancy warnings on functions already protected by `nonReentrant`, phase checks, checks-effects-interactions, or constrained callers.

This does not create a separate blocker, but the triage policy should be updated to include the new immediate-reward and forced-ETH review notes so future audits do not treat a broad allowlist as proof of safety.

## Controls That Passed

- Fresh build passed.
- Foundry assurance suite passed.
- Assurance invariants passed with 256 runs and depth 128.
- 512-wallet, 32-launch, 25,000-action economic simulation passed.
- Gitleaks history scan found zero leaks.
- `pnpm audit` found zero known vulnerabilities.
- Repository security script passed with zero unresolved high or medium findings under its current triage policy.
- Focused tests already cover:
  - pre-graduation swap, liquidity, and donation blocking;
  - principal and collected fee segregation;
  - adapter forced-native sweep;
  - asset-router forced-native sweep;
  - zero eligible DAO supply queuing without blocking trades;
  - creator fee split authorization, future-only allocation, duplicate rejection, and irreversible locking.

## Mainnet Requirements Before Reconsidering GO

1. Fix SF-2026-07-28-01 with tracked curve principal and a safe bonding-market forced-ETH sweep.
2. Decide whether SF-2026-07-28-02 is acceptable product behavior or redesign reward timing.
3. Add explicit forced-asset sweep coverage for every balance-retaining contract.
4. Add the focused proof tests as permanent regression tests after the intended fixes or policy decisions.
5. Rerun Foundry unit, fuzz, invariants, economic simulation, Slither, dependency, secret, license, live testnet lifecycle, rebuild/reconcile, recovery, and endurance gates.
6. Obtain an independent professional smart-contract audit before any Robinhood Mainnet deployment.


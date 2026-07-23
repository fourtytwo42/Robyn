# Internal schema-v4 contract audit

Status: engineering audit in progress

This is an internal AI-assisted engineering review. It is not an independent
professional audit and must never be presented as one.

## Scope

The review covers the schema-v4 atomic launch coordinator and factories,
bonding market, graduation adapter, immutable LP locker, basket vault, protocol
fee router, native converter, RDAO reward token, Governor and Timelock wiring.
Legacy fixed-price and superseded factory deployments are reviewed only for
protected-build exclusion and migration safety.

## Required properties

- Launch creation is atomic and predictable-address squatting fails closed.
- Launch supply, RDAO supply, baskets, creators, fee policy and locked LP
  principal cannot be rewritten.
- Every fee is conserved through the immutable 50/25/20/5 policy.
- Holder, creator and RDAO liabilities never exceed controlled balances.
- Failed routes, unsafe prices, malicious callbacks and failed receivers leave
  recoverable liabilities rather than partial credits.
- Allowances are exact and cleared after external execution.
- Voting uses historical checkpoints and timelocked execution.
- Guardian authority cannot spend treasury funds or rewrite votes.

## Automated and manual review

The gate combines full-history Gitleaks, high/critical dependency audit,
license inventory, all Foundry suites, Slither 0.11.5, deterministic
multi-user economics, stateful invariants and manual access-control/data-flow
review.

### Findings and dispositions

| Severity | Finding | Disposition |
|---|---|---|
| High | Six advisories entered through deprecated `@uniswap/swap-router-contracts` Hardhat tooling. | Removed the executable dependency and retained only the exact checksummed official `SwapRouter02` deployment artifact under project-controlled vendor storage. |
| High | Converter balance-delta paths were flagged for possible reentrancy. | Added function-wide `ReentrancyGuard` protection to both conversion entry points and retained measured balance-delta verification. |
| High | Locker/router balance reads were flagged across external calls. | Existing function-wide guards, canonical source authorization, checks-effects-interactions and regression tests make the detector paths non-reentrant; narrow source annotations document rather than globally hide the rationale. |
| High | Creator claim-to was flagged as an arbitrary native send. | The immutable canonical creator is the only caller allowed to select the recipient, liabilities are debited before interaction and every claim entry point is non-reentrant. |
| Medium | Strict balance equalities and measured deltas. | Intentional fail-closed conservation checks; fee-on-transfer and dishonest-router tests prove they reject unmeasured value. |
| Medium | Divide-before-multiply in price bounds. | Conservative integer rounding with nonzero-output checks; boundary tests cover unsafe minimum and excessive impact. |
| Medium | Factory/market external-call ordering. | Coordinator-only or one-time initialization plus atomic rollback; callback, pool-precreation and failure-injection tests cover surviving state. |
| Medium | Solidity zero-initialized locals and ignored tuple fields. | Language-defined initialization or deliberately unused interface values; no uninitialized storage is consumed. |
| Medium | Timestamp comparisons. | Deadlines, TWAP windows and governance timing intentionally use block timestamps and are tested at boundaries. |

No detector output is treated as resolved merely because the tool labels it a
false positive. Each category must have a code-level guard, bounded trust
assumption, or executable regression.

## Economic risk disclosure

RDAO rewards are deposited immediately against current eligible balances.
Buying before a known conversion can therefore capture a pro-rata share of
that future deposit. The adversarial campaign quantifies this chosen behavior;
it is not described as historical reward theft. A streamed or time-weighted
model remains a future governance/economics option.

## Release gate

The internal audit passes only when:

1. dependency audit reports zero high or critical advisories;
2. Slither reports zero unresolved high findings;
3. all critical, high and actionable medium findings have regression tests;
4. the 512-wallet, 32-launch, 25,000-action campaign passes;
5. 256-run/depth-128 stateful invariants pass with zero handler reverts; and
6. exact deployment roles and bytecode match the release manifest.

Independent review remains a deferred real-value release requirement.

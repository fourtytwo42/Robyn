# Schema-v8 Internal Contract Audit

Date: 2026-07-24

Status: Passed for the local and exact-fork assurance checkpoint. Live Robinhood Testnet deployment remains gated.

## Scope and limitation

This is an internal, AI-assisted engineering review of the schema-v8 native-ETH/v4 release. It is not an independent professional smart-contract audit, an application penetration test, or a guarantee that no undiscovered defect exists.

The reviewed lineage starts at commit `efb79a54150b16f7d5b21ef1716b976b845c3b03` and includes the route-safety, invariant, dependency, deployment, and verifier changes committed with this report.

Reviewed contracts:

- Atomic launch coordinator, launch factory/deployer, market factory/deployers
- Native bonding market, v4 graduation adapter, oracle hook, and immutable position locker
- Native basket vault, protocol fee router, and v4 asset router
- Fixed-supply RDAO token, shortened testnet Governor, and Timelock role wiring
- ERC-1046 launch token reward accounting and transfer corrections

Reviewed invariants:

- Exact 50/25/20/5 fee conservation
- Creator liabilities remain token-specific and solvent
- Basket principal cannot disappear when conversion fails
- Holder and RDAO reward liabilities remain solvent across transfers and claims
- Fixed token supplies, immutable creator/vault bindings, sealed exclusions, and locked LP principal
- Coordinator-only factory creation, one-time authority binding, atomic rollback, and allowance cleanup
- Reference-price, price-impact, deadline, route-readiness, and slippage enforcement

## Methods

- Manual review of authorization, custody, external calls, callbacks, accounting, conversion safety, oracle use, governance roles, and deployment lock-down
- Slither `0.11.5` over 12 active schema-v8 targets using Solidity `0.8.30`
- Foundry `1.7.1` unit, fuzz, adversarial, economic, and stateful invariant tests
- A 512-wallet, 32-launch, 25,000-action deterministic campaign across 20 seeds
- A 256-run, depth-128 native-v4 stateful invariant campaign
- Exact-project-wallet chain-46630 fork deployment and independent state verification
- pnpm dependency audit, Git-history secret scanning, strict TypeScript, lint, application tests, optimized builds, and protected testnet bundle scanning

Raw outputs are retained outside Git under `/tmp/schema8-slither-route-safety`, `/tmp/native-v4-invariant-256x128-route-safety.log`, `/tmp/robyn-assurance-schema8.json`, and `/tmp/robyn-assurance-verifier-route-safety.json`.

## Finding register

### A-01: Permissionless basket conversion trusted caller minimum

- Severity: Medium
- Status: Resolved
- Affected invariant: Basket fees must not be converted at an attacker-selected execution price.
- Exploit condition: A permissionless caller supplied an intentionally weak minimum output while a hookless stock/mock pool was manipulated or the requested trade had excessive price impact.
- Remediation:
  - Every basket route freezes a deployment-time reference tick.
  - Route readiness fails when spot differs from the reference by more than 198 ticks, approximately 2%.
  - Protected native-to-asset swaps reject more than 1% estimated price impact relative to the current marginal price.
  - The caller-supplied minimum must be at least 99% of the current quoter result.
  - Launch-token routes are explicitly exempt from the fixed reference because their market price is expected to move.
  - The schema-v8 manifest freezes these values for all 24 basket routes and the verifier binds them to live contract state.
- Regression: `testProtectedBasketRouteRejectsWeakMinimumOutputAndReferenceDeviation`.

### A-02: Vulnerable transitive UUID releases

- Severity: Medium
- Status: Resolved
- Affected surface: Wallet connector dependency tree.
- Condition: MetaMask/wagmi transitive packages resolved `uuid` 8.x/9.x, covered by `GHSA-w5hq-g745-h8pq`.
- Remediation: The workspace override resolves all consumers to `uuid 11.1.1`.
- Verification: `pnpm why uuid` resolves only 11.1.1; `pnpm audit` reports zero info, low, moderate, high, or critical advisories; application and protected wallet builds pass.

### A-03: Buy-before-conversion RDAO reward capture

- Severity: Low, economic design
- Status: Accepted and disclosed
- Condition: RDAO rewards are deposited immediately, so a holder can acquire RDAO before a known conversion and participate in that deposit.
- Impact: Redistribution among RDAO holders, not protocol insolvency or unauthorized extraction.
- Rationale: Instant claimability was an explicit product decision. Streamed or epoch-based rewards remain a future governance option.

### A-04: Observation-ring saturation can delay launch-token fee sales

- Severity: Low, availability
- Status: Accepted with fail-closed behavior
- Condition: Sustained swaps can displace observations older than the five-minute TWAP window.
- Impact: Permissionless launch-token fee conversion pauses with `InsufficientHistory`; user trading, LP principal, collected fees, and basket liabilities remain intact.
- Recovery: Conversion succeeds after sufficient safe observation history accumulates. Keeper age and pending-conversion monitoring must alert on prolonged delay.

### A-05: Shared unlisted Robinhood Testnet v4 venue

- Severity: Informational, external trust assumption
- Status: Accepted for testnet only
- Condition: Chain 46630 is not in Uniswap's official deployment registry.
- Control: Runtime hashes, constructor wiring, pool identity, quotes, swaps, and route state are frozen and reverified. Any mismatch aborts deployment. No mainnet claim or official-Uniswap claim is made.

### A-06: Unsolicited native-token donations can be stranded

- Severity: Informational
- Status: Accepted
- Condition: Sending native ETH directly to permissive callback receivers outside a documented protocol entry point does not create a liability or recovery right.
- Impact: Only the sender's unsolicited funds are affected. Accounted fee and claim paths are unchanged.

## Static-analysis disposition

Slither produced 79 normalized observations: 16 high, 34 medium, 16 low, 12 informational, and one optimization observation. These are tool impacts, not confirmed severities.

No Slither high or medium observation remained a confirmed issue after manual review:

- Arbitrary ERC-20 sender reports originate in the PoolManager-authenticated `SafeCallback`; the payer is encoded by Robyn's guarded external entry point.
- Arbitrary ETH recipient reports are creator/holder pull payments, market refunds, or immutable protocol recipients.
- Reentrancy reports cover `nonReentrant` paths or coordinator-only atomic initialization. State is updated before interaction where liabilities are debited, and any failed downstream call reverts the complete transaction.
- Strict equality reports are zero guards, exact accounting assertions, same-block observation replacement, or immutable binding checks.
- Weak-PRNG reports describe signed TWAP division and deterministic address calculations; no randomness claim uses those values.
- Unused returns are intentionally ignored quote gas estimates, PoolManager settlement credits, and unused tuple members.
- Timestamp use is limited to deadlines, governance clocks, pending-age thresholds, and oracle freshness.

The report does not suppress the raw output. The raw JSON remains preserved for independent review.

## Verification results

- Complete Foundry suite: 120 passed, 0 failed.
- Native-v4 stateful invariant campaign: 256 runs, depth 128, 32,768 calls per invariant, 0 reverts, 0 failures.
- Economic campaign: 512 wallets, 32 launches, 25,000 state-changing actions, 20 deterministic seeds, passed.
- Exact chain-46630 fork deployment: 490 checks, 0 failures.
- All 24 basket routes: reference protected, 198-tick maximum deviation, 100-bps protected slippage ceiling.
- Application unit tests: API 48, web 17, keeper 15, artifacts 5, RPC gateway 11.
- Formatting, lint, strict typecheck, Anvil smoke, optimized monorepo build, and protected testnet build passed.
- Dependency audit: 0 advisories at every severity.
- Git-history secret scan: 0 findings.

## Release decision

There are zero known unresolved critical, high, or medium contract/security findings in this internal checkpoint. Live deployment remains blocked on the rest of the approved assurance program: reproducible builds, clean exact pushed release, live funding preflight, fresh schema-v8 deployment, public-testnet campaign, browser acceptance, recovery drills, and the uninterrupted two-hour endurance run.

Independent professional contract review and external penetration testing remain required before real-value or mainnet operation.

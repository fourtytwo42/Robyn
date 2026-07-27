# Protocol security review

Status: automated and manual engineering review passed the controlled-devnet/testnet-mock release threshold; independent external review remains required before real-value assets

Last verified: 2026-07-21

## Reviewed scope

Production core:

- `RobynLaunchFactory.sol`
- `FeeBasketVault.sol`
- `RobynLaunchToken.sol`

Testnet-only integration fixtures:

- `packages/contracts/src/testnet/`

Adversarial and stateful evidence:

- `packages/contracts/test/RobynProtocol.t.sol`
- `packages/contracts/test/RobynProtocolInvariant.t.sol`
- devnet/testnet deployment verification and full journey rehearsals

The earlier `FeeBasketAccounting` primitive is no longer production source. It is retained only under `packages/contracts/test/fixtures/` for regression comparison.

## Threat model

The design assumes creators, callers, keepers, routers and ERC-20 implementations may be adversarial. It does not assume a public caller supplies a trustworthy router, asset, receiver or price. The factory fixes the router and immutable basket; the vault measures base and reward balance deltas; callers provide only bounded execution parameters.

Protected properties include:

- fee principal cannot be created, lost silently or assigned twice;
- claims cannot exceed measured reward receipts;
- transfers preserve accrued rewards and cannot capture prior distributions;
- excluded inventory cannot dilute holders or claim;
- a router/token callback cannot reenter conversion or claim accounting;
- an invalid route, deadline, output or spend reverts atomically;
- one failed basket leg does not block other legs;
- approvals are exact and cleared;
- testnet/development fixtures cannot enter a protected build unnoticed; and
- deploy/runtime keys never enter browser bundles, Git or manifests.

Not solved by contracts alone: oracle correctness, market price quality, issuer transfer restrictions, canonical Stock Token eligibility, public RPC availability, legal classification and compromised operator infrastructure.

## Stateful invariant campaign

Foundry targets a handler with four actors and randomized deposit, partial conversion, transfer and claim operations. The configured campaign uses 128 runs, depth 64 and `fail_on_revert = true`. Each invariant completed 8,192 calls per run-set with zero handler reverts.

The asserted properties are:

1. pending base plus consumed base equals all measured fees received, and vault base solvency covers pending principal;
2. token reward balances plus claimed totals cover measured receipts and claims never exceed receipts;
3. fixed total supply and eligible-supply accounting remain internally consistent; and
4. factory, vault, token, router and basket bindings remain immutable.

Unit/adversarial coverage also includes a router that attempts a conversion callback and a reward token that attempts a claim callback. Both are rejected by the function-wide reentrancy guards without corrupting post-call accounting. The exclusion set is capped at 16 entries and tested at the rejection boundary.

## Automated review result

The release security script runs full Git-history secret scanning, dependency audit, license inventory, Foundry suites and Slither 0.11.5 against Solidity 0.8.30.

Fresh 2026-07-21 result:

- secret-history findings: 0;
- known high/critical dependency vulnerabilities: 0;
- unresolved Slither critical/high findings: 0;
- Slither medium: 8;
- Slither low: 5;
- Slither informational: 1; and
- all Foundry suites, including invariants: passed.

The raw result is regenerated into every immutable release as `release-evidence/static-security-audit.json`.

## Schema-v8 native-v4 review addendum

Last verified: 2026-07-24

The active release scanner now limits detector results to the 18 contracts in
the generated schema-v8 action inventory: the v4 coordinator, factories,
deployers, bonding market, graduation adapter, oracle hook, immutable locker,
asset router, native basket/fee accounting, launch token, RDAO token, shortened
testnet Governor, and sealed test-asset liquidity locker. Archived v3 and fixed
price test fixtures remain compiled and tested, but their findings are not
misrepresented as active schema-v8 runtime findings.

The current active-scope result is:

- Git-history secret findings: 0. One Solidity type declaration false positive
  is suppressed by its immutable commit/file/rule/line fingerprint only.
- Known high/critical dependency vulnerabilities: 0.
- Unresolved Slither critical/high findings: 0.
- Unresolved Slither medium findings: 0.
- Reviewed Slither medium findings: 37 across four known detector classes.
- All 123 Foundry tests pass, including the 512-wallet/25,000-action simulation
  and 128-run/depth-128 stateful invariants.

Every medium result belongs to a reviewed class enforced by
`scripts/security-audit.sh`; any new medium detector class fails the gate:

| Detector class | Active-v4 disposition |
|---|---|
| `incorrect-equality` | Exact zero, balance-delta, conservation, and same-block observation checks are intentional fail-closed accounting conditions. Unit and stateful invariants exercise each financial equality. |
| `reentrancy-no-eth` | The reported sell, market creation, and sealed-liquidity initialization paths use explicit guards or one-time coordinator/factory authority. State is committed before interaction where required, allowances are cleared, and malicious callback fixtures plus stateful invariants pass. |
| `uninitialized-local` | Solidity value types and memory structs are deliberately zero-initialized before additive accounting or field assignment. Deployment and campaign invariants prove no stale-memory assumption exists. |
| `unused-return` | Tuple members are intentionally ignored when the consumed member, measured balance delta, post-call ownership/liquidity assertion, or downstream revert is authoritative. No ignored return is used as proof of payment or solvency. |

The high-severity `arbitrary-send-*`, `weak-prng`, and reentrancy detector false
positives carry line-scoped annotations beside the reviewed code. No detector
class is globally disabled. In particular, the v4 callback payer is always the
external swap caller encoded by Robyn, and `SafeCallback` permits invocation
only by the immutable PoolManager.

## Finding triage

| Finding | Scope | Disposition |
|---|---|---|
| `incorrect-equality` conservation and zero checks | Core vault/token | Intentional exact accounting/guard conditions. They revert on mismatch and are exercised by stateful conservation/solvency properties. |
| `reentrancy-balance` around router/token calls | Core vault | Reviewed false positive after explicit `nonReentrant`; adversarial router and reward-token callback fixtures prove the guard. Narrow Slither annotations sit at the external calls. |
| `reentrancy-benign/events` during factory creation/sealing | Core factory | No mutable shared financial balance is exposed across the calls; factory bindings are immutable and invariant-tested. Retained as low visibility. |
| timestamp comparisons | Core vault and testnet router | Deadline/maximum-delay semantics intentionally use block time. No randomness or price calculation depends on timestamp. |
| strict multiply/divide ordering | Testnet fixed-price mock only | Deterministic mock pricing with bounded rehearsal amounts, not a real pricing primitive. It must never be used as a real market/oracle. |
| ignored `recordFees` return | Testnet fixed-price mock only | Vault balance deltas and reverts are authoritative; the market does not use the advisory return. Retained as explicit mock-only finding. |
| exclusion loop cost | Core token | One-time initialization, hard-capped at 16 addresses; accepted informational risk. |

No finding is being reclassified as independently audited. This is an internal engineering review with reproducible automated evidence.

## Release blockers

The candidate is blocked if any of these occurs:

- critical/high detector finding is unresolved;
- invariant or adversarial fixture fails;
- protected bundle contains a devnet key/faucet/marker;
- exact release evidence is missing or does not match the Git SHA;
- accounting/reward conservation fails during soak; or
- a testnet/public deployment uses mock contracts without clear mock labeling.

Before any real-value asset deployment, obtain an independent contract audit/review, resolve its findings, repeat all release gates, and cut a new immutable candidate. A local testnet-mock rehearsal does not substitute for that review.
# Atomic launch and pool-precreation controls

- The token and vault use CREATE2 salts bound to chain ID, factory, creator, supply recipient, configuration hash, and a browser-generated cryptographically random `bytes32` salt.
- Salts are generated immediately before wallet submission and never prepublished. Reuse is rejected.
- A pre-existing canonical token/base/fee pool causes `PoolAlreadyExists` and reverts the complete transaction. Tests prove no counter increment, mapping, deployed token/vault, approval, or surviving log.
- Coordinator and both v2 factories are immutable fresh deployments. One-time binding prevents an initializer race after activation, and the factories are unusable before binding.
- The coordinator asserts exact inventory custody, zero residual token balance and allowance, seeded state, and all five exclusions before emitting the canonical event.
- Metadata and artwork remain offchain after confirmation. Their failure cannot change or obscure the onchain transaction result.

Chain-46630 uses a project-controlled test-only Uniswap v3 fallback only when the official registry still lacks that chain. Its manifest binds every address, deployment transaction, constructor encoding, creation-input hash, runtime hash, package artifact hash, wiring, owner, and enabled fee tier. The configuration is explicitly rejected outside chain 46630 and must never be accepted as mainnet infrastructure.
# DAO release security addendum

The DAO release adds transfer-corrected native rewards, timestamp vote checkpoints, Timelock/Governor roles, bounded partial conversions, current/TWAP tick agreement, post-fee spot price-impact enforcement, permissionless keeper execution, and a pause-only guardian. The detailed threat model and response process are in [DAO Governance and Fee Operations](dao-governance-operations.md). Public or mainnet distribution remains blocked on independent contract, legal, and tax review.
# Token-specific creator reward threat update

Schema v4 removes the wallet-aggregated creator claim mapping and makes the launch token the accounting key. The security properties are:

- Creator identity comes only from coordinator/factory launch registration and is immutable.
- Every claim validates the caller against the selected token's creator. Batch input containing one unknown or foreign token reverts the entire transaction.
- Liabilities clear before the native call and the router remains non-reentrant. A failed recipient restores all balances and emitted events.
- Duplicate tokens in a batch cannot double-pay because the first debit clears the token balance and later duplicates contribute zero.
- Claiming one token cannot mutate another token's fee account. The global liability decreases only by the exact aggregate amount paid.
- Wallet-gated UI visibility does not provide confidentiality and must never be described as private accounting.
- Remaining public-network gate: independent review of the expanded router, coordinator bindings, conversion path, and deployment manifest before real-value operation.
# Immutable metadata threat controls

- The token URI is constructor-set and has no update authority.
- CIDv1 syntax is validated onchain, while content trust is explicitly a
  separate Robyn-sanitized status.
- Metadata participates in the launch configuration hash and CREATE2 address,
  preventing a preparation from being silently substituted at submission.
- The Kubo RPC and gateway bind to loopback. Nginx permits only exact CID-shaped
  GET paths and Kubo `NoFetch` prevents recursive gateway abuse.
- Original uploads, SVG, animation, polyglots, decompression bombs, mutable
  profiles, and credentials are excluded from public metadata.
- Quarantine changes application rendering but cannot erase immutable public
  content; interfaces must never promise deletion from IPFS.
- External pin credentials stay in `/etc/robyn/ipfs.env` and are excluded from
  bundles, logs, source, and backups.

# Schema-v9 fee-hook security addendum

This review covers the deployed schema-v9 fee-and-oracle hook, native fee
router, graduation adapter, immutable position locker, native basket vault,
bonding market, factories, atomic coordinator, launch token, reward accounting,
Governor, and Timelock. It is an internal AI-assisted engineering review, not
an independent professional audit.

The review found that the production configuration's `maximumNativeSwap` was
enforced only after graduation while bonding purchases had no onchain
per-transaction cap. This release-blocking mismatch is remediated by an
immutable `maximumCurvePurchase`, enforced by both quoting and execution,
validated not to exceed the graduation threshold, recorded in the deployment
manifest, and regression-tested. Existing deployed markets do not gain this
protection and must not be promoted as the mainnet candidate.

The hook's custom-accounting delta was reviewed and tested for exact-input and
exact-output swaps in both currency directions. Exact-input fees are charged
against actual output. Exact-output fees add input using upward rounding so a
sufficiently small nonzero swap cannot evade the configured fee. Slippage,
price-limit, deadline, partial-fill, callback-authority, and PoolManager-only
entry conditions are covered by unit, fuzz, adversarial, and stateful tests.

Hook accrual is intentionally non-blocking. Native and launch-token fees remain
queued when routing or conversion is unavailable. Permissionless settlement is
bounded by TWAP maturity, spot-to-TWAP deviation, price impact, deadline,
minimum output, and allowance cleanup. State changes precede external calls,
and failed settlement leaves the liability available for retry without
duplicating credit.

Third-party liquidity is an expected economic condition. The
`testThirdPartyLiquidityDilutesLockedLpFeesButNotHookFees` regression test adds
an equal external full-range position, executes otherwise-equivalent graduated
trades, and proves that Sherwood's locked-position LP revenue is diluted while
the immutable hook fee still accrues and locked principal remains unchanged.
Both revenue sources enter the same exact 50/25/20/5 accounting policy.

The assurance profile runs 256 invariant campaigns at depth 128 and a
deterministic 512-wallet, 32-launch, 25,000-action campaign across 20 seeds.
Slither, dependency, secret, and Foundry gates currently report no unresolved
critical, high, or medium finding under the documented line-scoped triage.
These results do not remove the mainnet blocker: an independent professional
smart-contract audit and remediation rerun remain mandatory before real-value
deployment.

## Security-remediation review

Last verified: 2026-07-27

The schema-v9 audit findings SF-01 through SF-05 are addressed in a fresh,
undeployed candidate with phase-aware pools, principal-safe fee collection,
non-blocking destination liabilities, seven-day transfer-aware reward streams,
and explicit unsolicited-asset handling. The detailed authority trace,
finding-by-finding closure, automated evidence, and remaining release blockers
are recorded in
[Sherwood Forest security remediation review](assurance/security-remediation-review.md).

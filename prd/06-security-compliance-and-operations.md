# Security, compliance and operations requirements

Status: Draft  
Owners: Security, legal and operations TBD  
Date: 2026-07-20

## Security objective

A compromise of the frontend, quote service, indexer, keeper or individual operator must not permit theft or redirection of holder rewards. Accounting errors must be detectable before claims finalize and recoverable through objective, predeclared mechanisms.

## Trust model

| Actor/system | Trusted for | Not trusted for |
|---|---|---|
| Robinhood Chain | Canonical transaction ordering/finality subject to chain governance | RPC uptime, third-party application safety |
| Upstream launchpad | Token/market creation and documented fee entitlement | Immutable implementation, uninterrupted claims, Robyn accounting |
| Robyn indexer | Timely derived UI data | Final ownership truth without reproducible logs |
| Epoch builder | Candidate deterministic root | Unchallengeable discretionary allocations |
| Quote provider | Candidate route/price | Choosing recipient, output asset or unrestricted calldata |
| Keeper | Liveness | Custody, arbitrary calls or policy changes |
| Safe signers | Emergency and governed changes within role scope | Editing immutable baskets or taking accrued rewards |
| Stock Token issuer | Token contract operation and legal product rights | Continuous transferability or recognition of every holder |

## Security requirements

| ID | Requirement | Priority | Verification |
|---|---|---:|---|
| SEC-001 | Contracts MUST enforce exact quote target, spender, selector, input/output token, amount bound and receiver | MUST | Mutation/fuzz suite |
| SEC-002 | Every external-call contract MUST use reentrancy protection and checks-effects-interactions where applicable | MUST | Static/dynamic tests |
| SEC-003 | ERC-20 operations MUST use safe wrappers and measured balance deltas | MUST | Nonstandard/malicious token tests |
| SEC-004 | No role MAY alter a deployed launch's basket assets or weights | MUST | Authorization tests |
| SEC-005 | Emergency controls MUST pause only affected execution/registration paths, not confiscate claims | MUST | Role review and incident drill |
| SEC-006 | Upgradeable upstream and Robyn components MUST have implementation/admin monitoring | MUST | Upgrade simulation |
| SEC-007 | Epoch finalization MUST include a challenge delay and objective invalid-root rejection path | MUST for adapter | Invalid-root drill |
| SEC-008 | Protocol invariants MUST run as stateful fuzz tests and continuous reconciliation checks | MUST | CI and production monitor |
| SEC-009 | All critical/high findings MUST be remediated or release explicitly stopped | MUST | Independent audit closure |
| SEC-010 | A public vulnerability-disclosure channel and incident contact MUST exist before beta | MUST | Operational review |
| SEC-011 | Frontend MUST verify chain ID, known contracts and transaction intent before wallet signature | MUST | Compromised-config tests |
| SEC-012 | Content rendering MUST prevent script injection, malicious links and deceptive address substitution | MUST | Web security test |
| SEC-013 | Admin/keeper credentials MUST be hardware-backed or managed and independently rotatable | MUST | Access review/rotation drill |
| SEC-014 | Production Safe MUST use multiple independent signers and a documented quorum | MUST | Safe configuration audit |

## Required test matrix

- Transfer, mint, burn, excluded-address and zero-supply accounting.
- Arbitrary claim ordering, repeated claims and tiny/dust distributions.
- Cross-launch and cross-asset isolation.
- Reentrant reward/receiver tokens, no-return ERC-20s and fee-on-transfer behavior.
- Stale/negative oracle, sequencer disruption and manipulated AMM.
- Quote expiry, receiver/spender/target/output mutation and approval leakage.
- Upstream proxy upgrade and fee-entitlement change.
- Chain reorganization during index/epoch creation.
- Incorrect, omitted, duplicated and reordered Merkle leaves.
- Issuer pause, block, burn, seize and migration mocks.
- Public RPC and quote-provider outage.
- Compromised frontend configuration and replaced transaction.

## Permissionless-access policy

The current product direction does not actively geoblock, KYC, allowlist wallets or enforce an onchain eligibility gate. Requirements:

| ID | Requirement | Priority | Acceptance |
|---|---|---:|---|
| LEGAL-001 | The interface MUST NOT ask users to falsely represent that they are non-US | MUST | Copy/legal review |
| LEGAL-002 | Users MUST receive clear lawful-use, experimental technology, irreversible transaction and third-party asset disclosures | MUST | Terms/UI review |
| LEGAL-003 | Creator MUST represent authority to use submitted content and lawful token purpose | MUST | Terms acceptance test |
| LEGAL-004 | Product copy MUST NOT describe nonredeemable rewards as backing, guaranteed yield, APY, dividends or direct shares | MUST | Copy audit |
| LEGAL-005 | Stock Token surfaces MUST identify the token issuer/product and link controlling information where feasible | MUST for R2 | Legal/UI review |
| LEGAL-006 | Terms MUST distinguish the interface, Robyn contracts, upstream launchpad, chain services, quote providers and token issuers | MUST | Counsel review |
| LEGAL-007 | Privacy documentation MUST describe wallet/activity analytics and minimize offchain personal data | MUST | Privacy review |
| LEGAL-008 | The release MUST stop if counsel identifies a required permission or control that the selected operating model lacks | MUST | Signed gate record |

Permissionlessness is not a legal conclusion. Robinhood's permissionless chain statement does not override RHJ Stock Token terms, sanctions, issuer powers or operator obligations.

## Pre-R2 written answers

Before Stock Token beta, record written answers or counsel conclusions for:

- who is considered investor/beneficial owner when a contract holds rewards for changing holders;
- whether permissionless contract receipt and onward claims are recognized by the issuer;
- machine-readable block/eligibility/migration behavior;
- required operator, distribution, market, promotion, sanctions and reporting controls;
- permitted use of Robinhood/RHJ metadata and branding;
- 0x/1inch commercial, geographic, volume and end-user terms;
- upstream launchpad contract-recipient, upgrade, ABI and commercial support.

## Operational roles

| Role | May | May not |
|---|---|---|
| Keeper | Trigger constrained claims/conversions | Withdraw, edit basket, finalize arbitrary root |
| Root proposer | Publish deterministic candidate root | Claim funds or bypass challenge |
| Root guardian | Reject objectively invalid candidate during delay | Replace allocation or redirect funds |
| Route administrator | Enable/disable reviewed targets/assets through governance | Change deployed basket weights |
| Emergency guardian | Pause affected execution/registration | Seize holder claims |
| Safe governance | Rotate roles, approve reviewed versions, unpause | Override immutable launch promise |

Prefer separate keys and quorums for proposer, guardian and governance.

## Incident requirements

| ID | Requirement | Priority | Verification |
|---|---|---:|---|
| OPS-001 | Every alert MUST identify affected chain, launch, asset, component, last good block and runbook | MUST | Alert drill |
| OPS-002 | Quote/conversion failure MUST retain the affected leg and pause only that route when necessary | MUST | Incident simulation |
| OPS-003 | Issuer pause/block/migration MUST stop new purchases while preserving accounting and unaffected claims | MUST for R2 | Mock issuer drill |
| OPS-004 | RPC/indexer disagreement MUST stop root publication and keeper execution until canonical replay agrees | MUST | Provider divergence drill |
| OPS-005 | Upstream proxy upgrade MUST automatically halt adapter actions pending forked compatibility tests | MUST | Upgrade drill |
| OPS-006 | Key compromise response MUST support role removal, approval revocation, credential rotation and reconciliation | MUST | Tabletop/technical drill |
| OPS-007 | Public incidents MUST have timestamped status updates and transaction references without unsupported certainty | MUST | Communications exercise |
| OPS-008 | Post-incident review MUST record cause, scope, financial reconciliation, corrective work and tests | MUST | Process audit |

## Release security gates

### R0 validation

- Complete threat model and invariants.
- Static analysis plus unit/fuzz/invariant tests.
- No persistent public value.

### R1 adapter pilot

- Funded upstream contract-recipient path proven.
- Mainnet-fork compatibility suite pinned to implementation.
- Independent review of custom fee/vault/distributor contracts.
- Safe roles, monitoring and incident drills active.
- Value caps and explicit experimental cohort.

### R2 Stock Token beta

- 30-day authenticated quote evidence passes defined thresholds.
- Canonical registry and oracle monitoring live.
- Issuer-control chaos tests pass.
- Written legal/upstream/provider gates resolved.
- Independent audit has no unresolved critical/high findings.

### R3 native

- Full token/factory/market/locker/hook audit and economic review.
- Transfer gas and accounting invariants pass for configured asset bounds.
- Launch/manipulation and liquidity migration testing complete.


# Master product requirements

Status: Draft  
Target: Validation build through adapter MVP  
Date: 2026-07-20

## Objective

Deliver a Robyn-branded launchpad experience in which a creator can launch a community token, define an immutable one-to-three-asset reward basket, direct the entire received creator-fee share into that basket, and let holders verify and claim the correct amounts.

## Outcomes

### Creator outcome

A creator completes launch without code, understands the permanent basket and fee rules, and receives a public token page with verifiable reward activity.

### Holder outcome

A holder can tell the difference between pending fees, purchased rewards, accrued rewards and claimable rewards, and can verify and claim without trusting Robyn's database.

### Protocol outcome

Every unit received, converted, deposited, allocated and claimed reconciles against onchain state, with no holder iteration and no unrestricted keeper or quote authority.

## Release model

| Release | Product capability | Assets | Accounting |
|---|---|---|---|
| R0 validation | Mock launch and fee flow | Mock ERC-20s | Native harness plus simulated epochs |
| R1 adapter pilot | Real upstream launch and liquidity | WETH, USDG and approved deep-liquidity crypto | Time-weighted Merkle epochs |
| R2 Stock Token beta | R1 plus selected canonical Stock Tokens | Assets passing registry, quote, oracle and legal gates | Merkle epochs |
| R3 native launchpad | Robyn token, market and fee flow | Approved crypto and Stock Tokens | Transfer-integrated multi-asset accrual |

## Core requirements

| ID | Requirement | Priority | Verification |
|---|---|---:|---|
| CORE-001 | The product MUST support wallet connection on Robinhood Chain and clearly prompt network switching | MUST | Wallet integration test |
| CORE-002 | All transaction prompts MUST show action, contract, network, expected asset movement and estimated gas before signature | MUST | UI acceptance test |
| CORE-003 | The system MUST represent amounts using token decimals and avoid floating-point accounting | MUST | Unit/property tests |
| CORE-004 | Every launch MUST have a stable canonical page keyed by token contract address | MUST | E2E test |
| CORE-005 | Every displayed material amount MUST include its source state and last indexed block or “live RPC” label | MUST | Data/UI audit |
| CORE-006 | The UI MUST distinguish projected, pending, purchased, accrued and claimable values | MUST | Comprehension test |
| CORE-007 | The UI MUST say the launch token is not redeemable for the reward basket | MUST | Copy audit and user study |
| CORE-008 | The product MUST continue to expose read-only public state when wallet connection is absent | MUST | Anonymous-session E2E |
| CORE-009 | Contracts MUST remain directly usable without the Robyn frontend | MUST | ABI/script walkthrough |
| CORE-010 | Failures in one launch or reward asset MUST NOT block unrelated launches or basket legs | MUST | Isolation tests |
| CORE-011 | The application SHOULD support mobile viewport widths and wallet deep links | SHOULD | Responsive/device test |
| CORE-012 | The application MUST provide transaction and explorer links for launches, harvests and claims | MUST | E2E test |

## Primary journeys

1. Creator connects wallet, configures token and immutable basket, previews economics, acknowledges permanent rules, launches and lands on the token page.
2. Trader discovers a token, reviews liquidity, fees and basket rules, executes a trade through the selected upstream market and sees confirmed balance changes.
3. Holder sees pending and claimable rewards, inspects epoch/accumulator evidence, claims selected assets and sees the state reconcile.
4. Anyone inspects a token page without connecting and verifies contracts, basket weights, vault balances, conversion history and claims.
5. Operator observes an affected route, pauses only constrained execution for that route, resolves it and publishes state without gaining authority over holder claims.

## MVP scope

### Included in R1

- Wallet connection and Robinhood Chain switching.
- Token creation through one proven upstream adapter.
- One-to-three-asset immutable basket selection.
- Approved crypto reward assets only.
- Launch preview and permanent-rule acknowledgement.
- Discovery, search and token detail pages.
- Upstream trading integration.
- Fee collection, threshold batching and constrained conversion.
- Deterministic time-weighted epochs, manifest, challenge state and Merkle claims.
- Holder portfolio and reward history.
- Public contracts/configuration page.
- Operator dashboards, route pause, replay and reconciliation tools.

### Added in R2

- Selected canonical Robinhood Stock Tokens.
- Registry-status and Chainlink feed monitoring.
- Market-hours and delayed-conversion UX.
- Authenticated 0x/1inch execution comparison.
- Stock Token-specific disclosures and issuer incident handling.

### Excluded until R3 or later

- Native token/pool/locker deployment.
- Transfer-hook accumulator in production.
- Referral system, gas sponsorship and partner API monetization.
- Creator fee retention or arbitrary split editing.
- Basket rebalancing or replacement.

## Quality attributes

| Attribute | Requirement |
|---|---|
| Correctness | Financial state is reproducible from canonical logs and contract balances |
| Safety | No quote, keeper or operator role can execute an arbitrary call or redirect rewards |
| Transparency | Basket, fee policy, exclusions, implementations, epochs and transactions are public |
| Availability | Read-only pages degrade gracefully when one RPC/indexer is unavailable |
| Cost | Routine wallet reads use browser-direct public RPC; protected infrastructure handles only critical work |
| Performance | Cached public pages reach usable content within 2.5 seconds at p75 on a normal broadband connection |
| Accessibility | Core journeys target WCAG 2.2 AA, keyboard use and non-color-only states |
| Recoverability | Indexing and epoch output can be rebuilt deterministically from saved checkpoints and chain logs |

## Product-level acceptance

R1 is acceptable only when:

1. A creator launches a real low-value token through the Robyn interface with a three-asset basket.
2. The creator-fee receiver is a Robyn contract and requires no privileged EOA intervention.
3. Test trades generate fees that Robyn claims and converts under configured thresholds.
4. Two holders with different ownership intervals receive correct, independently reproducible epoch allocations.
5. Both holders claim successfully, and contract balances plus claims reconcile within defined rounding dust.
6. The public page shows immutable weights, fee sources, pending balances, conversions, epoch data and explorer links.
7. A failed basket leg remains pending without reallocating its weight or blocking other legs.
8. All critical/high audit findings are resolved and incident drills pass.
9. User testing meets the comprehension thresholds in [Analytics and experimentation](08-analytics-and-experimentation.md).

R2 additionally requires the firm-quote, legal and issuer-control gates in [Security, compliance and operations](06-security-compliance-and-operations.md).

## Dependencies

- Proven Bags or pons contract-recipient path.
- Robinhood Chain mainnet and testnet RPC access.
- Archive-capable provider for event history.
- Canonical RHJ registry and supported price feeds for R2.
- Authenticated 0x/1inch production access for R2.
- Safe deployment and controlled operational accounts.
- Independent contract audit before public-value beta.

## Related specifications

- Creator/UI: [02](02-creator-launch-and-discovery.md)
- Holder/UI: [03](03-trading-rewards-and-holder-experience.md)
- Contracts/execution: [04](04-protocol-accounting-and-execution.md)
- Data/infrastructure: [05](05-platform-data-and-infrastructure.md)
- Security/operations: [06](06-security-compliance-and-operations.md)
- Delivery/acceptance: [07](07-delivery-plan-and-acceptance.md)


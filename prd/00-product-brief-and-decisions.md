# Product brief and decision register

Status: Draft  
Product: Robyn  
Date: 2026-07-20

## Product statement

Robyn lets a creator launch a community token and permanently choose how its holder-reward fee allocation is divided among one to three supported assets. Trading activity funds purchases of those assets. Holders accrue or receive auditable pro-rata claims based on their qualifying ownership.

Example:

- 40% NVDA Stock Token
- 40% SPY Stock Token
- 20% approved crypto asset

The community token is not redeemable for this basket in the initial product. The basket is a stream of fee-funded rewards, not collateral backing the token.

## Problem

Launchpads generally send creator fees to the creator, burn tokens, or apply one fixed reward behavior. Existing Robinhood Chain products offer single-stock rewards or redeemable stock baskets, but no verified product combines:

- permissionless community-token creation;
- an immutable creator-selected weighted basket;
- automatic conversion of trading fees into multiple real or crypto assets; and
- transparent, pull-based holder claims.

## Product promise

“Launch a token whose trading fees build the reward basket you choose.”

Every product surface must preserve these truths:

1. Rewards come only from realized fee revenue.
2. Rewards may be zero.
3. Basket weights are immutable after launch.
4. Purchases may be delayed when a route is unavailable or uneconomic.
5. Pending cash stays assigned to its original basket leg.
6. The launch token is not backed by or redeemable for basket assets.
7. Every material amount must reconcile to onchain events and balances.

## Primary users

| User | Need |
|---|---|
| Creator | Launch a credible token with differentiated, understandable fee economics |
| Trader | Discover and trade tokens with clear fees, liquidity and risk |
| Holder | Understand, verify and claim earned basket assets |
| Researcher/integrator | Read launch, basket, fee, harvest and claim state without trusting the UI |
| Operator | Keep indexing and constrained execution reliable without discretionary custody |

## Positioning

Robyn is a launchpad and reward protocol. It is not presented as a brokerage, fund, portfolio manager, savings product, guaranteed-yield product or direct ownership of the referenced company shares. Product copy should use “Stock Token” where appropriate and avoid “stock-backed,” “dividend,” “index fund,” “APY,” and “guaranteed.”

## Decision register

| ID | Decision | Status | Reason |
|---|---|---|---|
| D-001 | Initial product is a fee-funded reward token, not a redeemable basket token | Settled | Matches the original mechanism and avoids falsely describing collateral backing |
| D-002 | Basket contains one to three unique assets in MVP | Settled | Bounds gas, accounting and thin-liquidity risk |
| D-003 | Asset addresses and weights are immutable and total exactly 10,000 basis points | Settled | Makes the launch promise verifiable and prevents creator bait-and-switching |
| D-004 | Failed basket legs retain their WETH/USDG allocation rather than reallocating | Settled | Preserves the creator-selected weights |
| D-005 | Current product policy has no project-operated KYC, geoblock, wallet allowlist or onchain eligibility gate | Settled product direction | Does not remove legal or upstream token restrictions |
| D-006 | Browser-direct public RPC handles ordinary wallet reads and submission | Settled | Distributes routine load and minimizes project cost |
| D-007 | Project-controlled archive infrastructure handles complete indexing, proofs, keeper execution and monitoring | Settled | Public RPC is not a correctness dependency |
| D-008 | Bags is the first adapter candidate; pons is fallback | Conditional | Depends on funded contract-recipient tests and acceptable upstream terms |
| D-009 | Adapter rewards use deterministic time-weighted Merkle epochs | Conditional | Required because upstream tokens lack Robyn transfer hooks |
| D-010 | Native launches use transfer-integrated cumulative reward-per-share accounting | Settled for native phase | Prevents snapshot gaming and avoids holder loops |
| D-011 | Crypto-only adapter pilot precedes Stock Token beta | Settled | Separates accounting/product validation from thin RWA execution and legal issues |
| D-012 | Stock execution requires authenticated firm quotes and onchain constraints | Settled | Discovery liquidity is not sufficient execution evidence |
| D-013 | One hundred percent of the upstream creator-fee share received by Robyn funds holder rewards in MVP | Settled | Cleanest creator promise; launchpad/protocol fees remain separately disclosed |
| D-014 | No full launchpad implementation begins before accounting and adapter compatibility gates pass | Settled | Avoids building around an unproven integration |
| D-015 | R1 uses a dark-first, restrained onchain-capital visual system with teal primary and violet secondary accents | Settled | Differentiates Robyn from Robinhood green and supports a calm financial-product tone |
| D-016 | The external asset basket is the dominant visual concept across discovery, creation and token detail | Settled | The basket allocation is Robyn's primary product distinction |
| D-017 | UI states use semantic design tokens, text and icons; color never carries financial or operational meaning alone | Settled | Enables accessibility, consistent degraded states and later theming |
| D-018 | Application code uses a pnpm/Turborepo TypeScript monorepo with Next.js 15, React 19 and Tailwind CSS v4 | Settled | Provides typed shared packages, modern server/client rendering and direct design-token integration |
| D-019 | Frontend chain and state stack is viem, wagmi, WalletConnect/injected wallets, TanStack Query/Table, Zod and React Hook Form | Settled | Keeps EVM calls typed and separates wallet, remote state, tables and validation concerns |
| D-020 | Backend uses Fastify services/workers, PostgreSQL with Drizzle, Redis/BullMQ and S3-compatible artifact storage | Settled | Separates request serving from durable indexing, retryable jobs and immutable proof artifacts |
| D-021 | Testing uses Foundry, Vitest/Testing Library and Playwright with deterministic container/fork integration environments | Settled | Matches contract, domain, component and end-to-end risk boundaries |
| D-022 | Observability uses OpenTelemetry, Sentry, Prometheus-compatible metrics and Grafana | Settled | Provides correlated diagnostics, error reporting and operational health without making a vendor the source of truth |
| D-023 | CI/CD uses GitHub Actions, frozen installs and immutable container/artifact promotion; hosting vendor remains deferred | Settled baseline | Makes builds reproducible while preserving provider portability |

## Assumptions to validate

| ID | Assumption | Validation | Failure response |
|---|---|---|---|
| A-001 | Bags permits a smart contract as fee claimer through the full claim path | Funded minimal launch, trade and claim | Test pons; if both fail, proceed native |
| A-002 | Early tokens generate enough creator fees for meaningful weekly conversions | Pilot cohort data | Increase batching, adjust product expectation or stop |
| A-003 | Users understand rewards are not redemption backing | Prototype comprehension study | Rewrite flow and confirmation; stop if confusion persists |
| A-004 | At least a small Stock Token default list has reliable $100 firm quotes | 30-day authenticated quote sample | Keep Stock Tokens out of beta or narrow list |
| A-005 | Merkle epochs are acceptable to holders and independently reproducible | Public builder, challenge simulation and interviews | Prioritize native accounting |
| A-006 | A 1% neighborhood trading fee balances trading friction and reward visibility | Fee-choice prototype and pilot behavior | Test 0.5% and 2%; avoid assuming 5% demand |

## Unresolved product decisions

These do not block the validation build but must be resolved before adapter MVP development:

- Brand name and public domain.
- Final logo and brand mark.
- Exact token supply and launch-curve parameters inherited from the selected launchpad.
- Epoch cadence and challenge delay.
- Minimum claim amount and whether claims may combine assets.
- Initial crypto asset allowlist.
- Whether Robyn charges an additional platform fee in a later release.
- Treatment of launch-token-side LP fees, if the upstream protocol produces them.
- Moderation policy for illegal names/images while keeping contracts permissionless.
- Operator entity, governing terms, privacy controller and support channel.

## Explicit non-goals for MVP

- Redeemable basket shares.
- Creator-managed or rebalanced baskets.
- Arbitrary ERC-20 reward addresses.
- More than three basket assets.
- Cross-chain launches.
- Limit orders, perps, leverage or lending.
- Guaranteed conversion timing or reward value.
- Pushing tokens to every holder in a loop.
- Project custody or discretionary trading of user assets.
- Native launch bonding curve unless adapter validation fails and the decision is consciously revisited.

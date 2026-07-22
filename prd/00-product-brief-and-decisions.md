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

Holder-facing promise: **“Every token has its own reward basket. Hold the token. Earn the basket.”**

Creator-facing explanation: **“Launch a token and choose the immutable reward basket its holders can earn.”** Trading fees are the funding mechanism and should support these promises rather than lead holder-facing acquisition copy.

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
| D-020 | Backend uses Fastify services/workers, native PostgreSQL with Drizzle, native Redis/BullMQ and native MinIO-compatible artifact storage on the project VM | Settled | Separates request serving from durable indexing, retryable jobs and immutable proof artifacts without containers |
| D-021 | Testing uses Foundry, Vitest/Testing Library and Playwright with deterministic VM-native database, fork and integration environments | Settled | Matches contract, domain, component and end-to-end risk boundaries |
| D-022 | Observability uses OpenTelemetry, structured local error events, Prometheus-compatible metrics and VM-native Grafana; an external Sentry sink is optional | Settled | Keeps required diagnostics on the VM without making an external vendor the source of truth |
| D-028 | Initial development and acceptance use a native VM-hosted Anvil chain ID 31337 with easy faucet funding before Robinhood Testnet migration | Settled | Removes external faucet dependence while preserving EVM behavior and the selected Foundry toolchain |
| D-029 | Every user-facing story requires Codex in-app-browser acceptance evidence in addition to the appropriate VM-native lower-level tests | Settled | Verifies complete real user journeys without weakening contract, service or data correctness tests |
| D-030 | Every major validated change is committed and pushed from the authoritative VM; incomplete or risky work remains on feature branches and main stays deployable | Settled | Keeps GitHub current and preserves recoverable, reviewable checkpoints |
| D-031 | Holder-facing acquisition copy leads with each token's reward basket; creator-fee routing is supporting mechanism copy and remains prominent in creation/economics surfaces | Settled | Communicates the holder benefit first without implying that the launch token is collateral-backed or redeemable |
| D-032 | A completed native Robyn curve graduates atomically into a canonical Uniswap v3 pool whose position NFT is permanently locked; Robyn continues to quote and submit pool trades through the same token interface | Settled | Matches the proven Robinhood Chain launch pattern while preserving a seamless Robyn trading experience and post-graduation basket-fee funding |
| D-023 | CI/CD uses a self-hosted GitHub Actions runner on the project VM, frozen installs and immutable build-artifact promotion without containers | Settled baseline | Keeps all project execution on the VM while preserving reproducible releases |
| D-024 | The `robyn` VM at `192.168.50.250` and `/home/hendo420/Robyn` are the only authoritative development and runtime environment | Settled | The user requires all project work and services to run on the VM, never the workstation |
| D-025 | Docker, Compose, Kubernetes and container images are prohibited for project development and deployment | Settled | The user requires native VM operation |
| D-026 | Node services use persistent PM2 startup through systemd; stateful and infrastructure services use native systemd units | Settled | Processes must survive reboot and remain independently operable |
| D-027 | Any project-operated RPC node, database, queue, object store, monitoring or CI runner runs natively on the project VM | Settled | No Robyn-owned runtime workload is moved to the workstation or another compute host |

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
- Production virtual reserves, starting/terminal FDV, quote asset, Uniswap v3 fee tier, tick range and exact chain deployment parameters. Controlled devnet uses the fixed policy in `research/17-bonding-curve-and-graduation-design.md`.
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
- Multiple creator-selectable curve formulas or graduation venues. R1 uses one protocol-defined curve and one canonical venue.

## Native bonding and graduation decision (2026-07-21)

- New Robyn-native launches use a constant-product bonding curve followed by an automatic, irreversible graduation into locked AMM liquidity.
- Production graduation creates or initializes the factory-bound canonical Uniswap v3 pair in the threshold-reaching buy, mints its liquidity position directly to an immutable no-withdrawal locker and records the pool, position and locked amounts. There is no creator, keeper or trader migration transaction.
- The token remains tradable on Robyn after graduation. The same buy/sell interface switches from curve quoting/execution to the bound Uniswap v3 quote/router path using canonical onchain phase state; users do not need to leave Robyn or manually select a venue.
- The curve and graduated venue both route their configured trading-fee share to the launch's existing immutable reward basket.
- Controlled devnet uses 1B fixed supply, an 800M curve allocation, a 200M graduation allocation, 1% fee and 6,500 mUSD target. Production virtual reserves remain gated on economic simulation and review.
- The controlled-devnet pool remains a local rehearsal and must not be described as Uniswap. Public testnet/mainnet activation remains fail-closed until the exact factory, position manager, router/quoter, wrapped quote asset, fee tier, code hashes and locker behavior are independently verified for that chain.
- Existing fixed-price devnet launches remain readable as `legacy_fixed`; they are not silently relabeled or rewritten.

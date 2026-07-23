# PRD 11: DAO, Governance, and Protocol Fees

## Outcome

Robyn has a member-owned governance and revenue layer without weakening any launch's immutable holder or creator promise. Every collectible bonding and locked-LP fee is conserved through a permanent 50/25/20/5 policy: holder basket, creator native claim, RDAO native rewards, and timelock treasury.

## Actors

- RDAO holder: transfers RDAO, earns future native deposits, claims accrued ETH, and may delegate voting power.
- Delegate: proposes after reaching 1% of supply, votes for/against/abstain, and may permissionlessly queue or execute a successful proposal.
- Launch creator: claims the creator share to self or another recipient without affecting trading.
- Keeper: permissionlessly harvests and converts bounded batches subject to TWAP, spot-impact, quote, deadline, and pause checks.
- Guardian Safe: pauses conversions and cancels malicious queued operations only.
- Timelock/Governor: controls treasury actions, operational settings, contributor vesting, supported future assets/routes, and future factory enrollment.

## Fixed economics

| Destination | Original fee | Settlement |
| --- | ---: | --- |
| Launch holder basket | 50% | Base asset enters the existing basket vault immediately |
| Launch creator | 25% | Base queues; realized native ETH is pull-claimable |
| Eligible RDAO holders | 20% | Base queues; realized ETH is deposited using transfer-aware accounting |
| DAO timelock treasury | 5% | Base queues; realized ETH is sent to the timelock |

Basket rounding dust remains in the basket half. Native conversion rounding dust goes to treasury. Existing launches cannot have their split, creator, basket, LP lock, accrued rewards, or historical votes changed.

## Token requirements

- Exactly 1,000,000,000 RDAO with 18 decimals and no mint path.
- ERC-20 Permit and ERC20Votes with timestamp checkpoints.
- Liquid manifest-defined initial allocations totaling exactly 100%; future grants use treasury-funded vesting contracts.
- Balance controls reward weight. Delegation checkpoints control governance weight.
- Rewards accrue instantly when deposited. Pre-deposit buyers participate, a disclosed reward-sniping tradeoff.
- Transfers preserve already accrued rewards for the sender and direct only future deposits to the recipient.
- Timelock, treasury reserve, fee router, Governor, coordinator, market factory, and unusable protocol balances are permanently reward-excluded.

## Governance requirements

- Voting delay: 1 day. Voting period: 3 days. Execution timelock: 2 days.
- Quorum: 10% of past delegated supply. Proposal threshold: 1%.
- Governor is the sole timelock proposer. Execution is permissionless after the delay. Setup administrator renounces administration.
- Guardian has pause and timelock-canceller roles only; it cannot unpause alone or move assets.
- UI supports delegation, proposals, for/against/abstain, queue, execute, receipts, quorum, and lifecycle state.
- Templates cover treasury transfer, contributor grant, conversion settings, supported assets, and future factory activation. Arbitrary calldata is visibly high risk.

## Fee and conversion requirements

- Market and locked position locker are the only canonical fee sources registered during atomic launch.
- Trades and fee harvests never synchronously swap to native.
- Launch-token LP fees are accumulated and sold to base in permissionless bounded batches.
- Base-to-native conversion accepts a maximum input, allowing large queues to drain through bounded batches.
- The converter rejects missing pools, stale/insufficient observations, spot/TWAP disagreement, more than configured post-fee spot price impact, unsafe caller minimums, and expired deadlines.
- Failed conversions leave accounting and custody queued for retry. Allowances clear after success and transaction reversion clears them after failure.
- Creator and RDAO claims use pull accounting and support alternate recipients.

## Product interface

- `/dao`: Overview, Rewards, Governance, Treasury, Members, Activity.
- `/dao/proposals/[id]`: canonical proposal actions, vote totals, receipts, quorum, timing, and execution data.
- Overview exposes the immutable split, member balance/votes/claimable ETH, conversion health, treasury, liabilities, and guardrails.
- Treasury exposes per-launch queued base and cumulative base/native fee flow.
- Members are wallet/profile records and never imply offchain identity verification.
- Contract/log state is authoritative. PostgreSQL and API responses are rebuildable views.

## Acceptance

- Conservation and partial-batch invariants hold before and after graduation.
- Fixed supply, exclusions, transfer corrections, delegation snapshots, quorum, timelock, double-vote rejection, guardian limits, and failed receiver behavior are tested.
- Schema-v4 local and isolated chain-46630 deployments verify all bindings, roles, fee constants, exact supply, DEX provenance, launch registration, and per-token creator reward accounting.
- Protected testnet build contains injected-wallet controls and no devnet session key/faucet/private-key code.
- Desktop, tablet, and 390x844 browser acceptance covers every DAO view and transaction path.
- Public chain-46630 broadcast remains a separate explicit authorization gate.

## Token-specific creator rewards

- Every launch fee account stores pending creator base, claimable creator native ETH, lifetime creator ETH accrued, and lifetime creator ETH claimed.
- Conversion credits creator ETH to the originating launch token. A claim against one token cannot reduce another token's entitlement, including when both tokens have the same creator.
- Creator claims accept a token address. Batch claims validate immutable creator ownership for every token, skip owned zero balances, revert atomically on unknown or foreign tokens, clear liabilities before interaction, send one aggregate payment, and emit one token-attributed event per paid launch.
- The global creator liability is retained only as a solvency invariant. Wallet-aggregated personal claims are removed.
- The token earnings panel renders only when the connected wallet equals the factory-recorded creator. `/portfolio` is the unified wallet profile and includes created launches, aggregate totals, per-token claims, Claim All, and advanced claim-to controls.
- DAO Rewards contains only RDAO member rewards. DAO Treasury may display aggregate creator liabilities and public token-level accounting for monitoring, but it does not expose personal creator claim controls.
- UI gating is convenience and information hierarchy, not privacy. Contract storage and events remain public.

## Legal disclosure

RDAO is transferable and receives protocol ETH. This design may be treated as a revenue-bearing cryptoasset and may create securities, commodities, money-transmission, tax, sanctions, consumer-protection, and reporting obligations. No public or mainnet distribution occurs without dedicated counsel and tax review. No jurisdiction is actively blocked in the current prototype; that is a product choice, not a legal conclusion.

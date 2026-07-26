# Creator, launch and discovery experience

Status: Draft  
Owner: Product/frontend TBD  
Date: 2026-07-20

## Goal

Let a nontechnical creator configure and launch a token with an understandable, immutable reward basket while making the fee economics and risks difficult to misread.

## Information architecture

- Home/discovery
- Create
- Launch preview
- Launch transaction progress
- Token detail
- Creator profile
- Portfolio/rewards
- Learn/how it works
- Contracts/status/terms

## Create flow

### Step 1: Token

Fields:

- Name
- Symbol
- Image
- Description
- Optional website and social links
- Upstream launch parameters exposed by the selected adapter

Validation:

- Name/symbol length and supported characters.
- Image type/size and safe rendering.
- Duplicate names and symbols are allowed but clearly warned; address is identity.
- Description/link sanitization.
- Final token supply and market configuration are shown before launch.

### Step 2: Reward basket

The creator selects one to three unique assets. Each result shows:

- symbol, full name and verified contract address;
- asset class: crypto, Stock Token or tokenized ETF;
- canonical/approved status and last checked time;
- execution availability state: available, thin, delayed or unavailable;
- current percentage and estimated split of a sample fee amount.

Weights accept whole basis-point precision, must be positive and must total exactly 100%. Provide equal-weight and common 40/40/20 shortcuts without making a financial recommendation.

### Step 3: Economics

Show separately:

- total trading fee charged by the upstream venue;
- upstream protocol portion;
- creator-fee share assigned to Robyn holder rewards;
- any Robyn fee, which is zero in initial MVP unless the decision register changes;
- threshold and batching behavior;
- an illustrative `$1,000 / $10,000 / $100,000` volume table labeled as fee flow, not yield.

### Step 4: Permanent rules

Show a plain-language summary:

- basket assets and weights cannot be edited;
- rewards depend on trading and may be zero;
- the token is not redeemable for basket assets;
- conversions may be delayed or fail;
- failed-leg funds remain pending for that asset;
- upstream contracts and issuer controls can affect behavior;
- creator-provided content is the creator's responsibility.

Require individual acknowledgement of the immutable basket and nonredeemable reward model. Do not require a false statement that the user is non-US. Terms acceptance and any legally required representations will be specified after counsel review.

### Step 5: Preview and launch

Preview contains:

- exact token metadata;
- exact asset contract addresses and weights;
- fee path diagram;
- upstream factory and Robyn receiver/controller addresses;
- initial market/supply configuration;
- estimated launch gas and upstream creation fee;
- permanent rules and external risks;
- a downloadable/shareable configuration JSON hash.

After signature, show state transitions: submitted, included, upstream token created, fee rights assigned, Robyn launch registered, indexed and ready. Each state links to its transaction.

## Requirements

| ID | Requirement | Priority | Acceptance |
|---|---|---:|---|
| CREATE-001 | Creator MUST complete launch through one guided flow without entering contract addresses manually | MUST | Moderated usability task passes |
| CREATE-002 | Basket MUST contain 1-3 unique supported asset addresses with positive weights totaling 10,000 bps | MUST | Unit/UI/E2E validation |
| CREATE-003 | Asset identity MUST come from the versioned Robyn asset registry, not symbol text | MUST | Lookalike-token negative test |
| CREATE-004 | Preview MUST show immutable configuration and exact deployed/called contracts | MUST | Snapshot and E2E test |
| CREATE-005 | The interface MUST prevent launch if fee-recipient assignment or Robyn registration would be incomplete | MUST | Simulated partial-failure test |
| CREATE-006 | The interface MUST not promise reward amount, timing, asset value or redemption | MUST | Copy audit |
| CREATE-007 | The creator MUST acknowledge immutable weights and nonredeemability before signing | MUST | E2E test |
| CREATE-008 | Launch progress MUST recover correctly after reload or wallet disconnect | MUST | Recovery E2E |
| CREATE-009 | A confirmed launch MUST resolve to one canonical token page | MUST | E2E test |
| CREATE-010 | Creator metadata MUST be sanitized and render safely | MUST | Security test |
| CREATE-011 | Preview SHOULD provide a machine-readable configuration record before signing | SHOULD | Download/hash test |
| CREATE-012 | Failed launch attempts MUST preserve form state locally without preserving wallet secrets | MUST | Failure/retry test |

## Discovery

Home should prioritize understandable state rather than a casino-style feed. Cards display:

- token name/symbol/address suffix;
- market capitalization and liquidity, labeled by data source;
- 24-hour volume and age;
- reward basket icons/weights;
- pending and purchased reward value;
- next conversion state;
- clear “crypto only” or “includes Stock Tokens” label.

Filters:

- New, active volume, reward purchases, claimable epoch and graduated/upstream status.
- Asset contained in basket.
- Crypto-only versus Stock Token.
- One, two or three assets.

Do not rank by unadjusted raw volume alone. Wash activity can manufacture headline numbers while paying real fees.

| ID | Requirement | Priority | Acceptance |
|---|---|---:|---|
| DISC-001 | Anyone MUST browse launches without a wallet | MUST | Anonymous E2E |
| DISC-002 | Search MUST support token address, name and symbol, with address treated as canonical | MUST | Search tests |
| DISC-003 | Cards MUST identify data freshness and not mix projected and realized reward value | MUST | UI/data test |
| DISC-004 | Filters MUST be shareable through URL state | SHOULD | Navigation test |
| DISC-005 | Rankings MUST document their formula and resist simple self-trade inflation | MUST | Formula review and abuse test |
| DISC-006 | Hidden/moderated content MUST remain discoverable by address unless displaying it is unlawful | SHOULD | Policy test |
| DISC-007 | A launch MUST earn King of the Forest at most once when a post-activation trade leaves it at or above 50% bonding progress with at least 10 distinct lifetime traders | MUST | Projector replay, threshold, reorg and browser tests |

## Creator profile

Show launches by wallet, verified links where available, aggregate realized fees and rewards, and warnings for transferred/compromised creator identities. Do not imply identity verification from wallet ownership alone.

## Empty and degraded states

- No wallet: browse enabled; creation/trading/claim prompts connect.
- Wrong network: read from indexed data, prompt switch before transaction.
- Public RPC unavailable: cached data remains visible with stale badge.
- Indexer behind: show last block and disable values that cannot be safely determined.
- Asset route unavailable: preserve form where possible, explain that launch cannot use that asset now.
- Transaction replaced/reverted: explain state using receipt evidence and allow safe retry.
# Atomic creator launch requirement

Every new creator launch uses one wallet confirmation and one reverting coordinator transaction. Supply is fixed by protocol policy; creators cannot select an arbitrary supply. The browser generates a fresh random salt immediately before simulation, decodes canonical identities from the transaction receipt, then waits for indexing and optionally binds sanitized artwork. An artwork/profile failure is reported as metadata failure after a successful launch, never as an onchain failure.


## King of the Forest user stories

- As a trader, I can see how close an eligible token is to the crown without confusing the achievement with a financial return.
- As a market participant, I can identify the reigning King, former winners, the qualifying transaction, and the immutable award time.
- As an anonymous visitor, I can browse the complete winner history without connecting a wallet.
- As an operator, I can rebuild trader counts, progress, awards, and the reigning winner from canonical chain logs.
- As a token creator, I cannot buy, transfer, or repeatedly earn the crown for the same token.

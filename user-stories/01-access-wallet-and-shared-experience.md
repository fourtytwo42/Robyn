# Access, wallet and shared-experience stories

## Epic A: Public access and wallet state

### US-ACCESS-001: Browse without connecting

- Release: R1
- Priority: Must
- Persona: Visitor
- PRD: CORE-008, DISC-001
- Depends on: DATA API availability

As a visitor, I want to browse launches and reward activity without connecting a wallet so that I can evaluate Robyn without exposing an address.

Acceptance criteria:

1. Given no connected wallet, when I open discovery or a token page, then public content renders with no connection modal blocking it.
2. Given a wallet-only action, when I select it, then connection is requested at that moment and my page context remains intact.
3. Given cached data, then its last indexed block and freshness state are visible.

### US-ACCESS-002: Connect a supported wallet

- Release: R1
- Priority: Must
- Persona: Creator, Trader, Holder
- PRD: CORE-001
- Depends on: Wallet integration

As a wallet user, I want to connect through a standard provider so that I can launch, trade and claim from my own wallet.

Acceptance criteria:

1. Given a supported provider, when I approve connection, then the active address and chain are shown without requesting a signature.
2. Given rejection or unavailable provider, then a recoverable explanation is shown and public browsing remains usable.
3. Given account change or disconnect, then private wallet state is cleared while public page state remains.

### US-ACCESS-003: Switch to Robinhood Chain safely

- Release: R1
- Priority: Must
- Persona: Wallet user
- PRD: CORE-001, SEC-011
- Depends on: US-ACCESS-002

As a wallet user, I want an explicit network check and switch prompt so that I do not sign a transaction on the wrong chain.

Acceptance criteria:

1. Given the wrong chain, when I start a transaction, then signing is disabled and the expected/current chain IDs are shown.
2. When I approve a switch or add-network request, then state is re-read before signing becomes available.
3. If switching fails, no transaction request is produced.

### US-ACCESS-004: Use a mobile wallet

- Release: R1
- Priority: Should
- Persona: Mobile user
- PRD: CORE-011
- Depends on: US-ACCESS-002

As a mobile user, I want responsive screens and wallet deep links so that I can complete core journeys without a desktop.

Acceptance criteria:

1. Create, trade, reward and claim flows work at supported mobile widths without hidden required content.
2. Deep-link return restores the originating action and revalidates quote/configuration state.
3. Keyboard, focus and screen-reader behavior meets the declared accessibility target.

## Epic B: Transaction understanding and state

### US-ACCESS-005: Inspect a transaction before signing

- Release: R1
- Priority: Must
- Persona: Wallet user
- PRD: CORE-002, SEC-011
- Depends on: US-ACCESS-003

As a wallet user, I want a plain-language transaction preview so that I understand what the contract call can do.

Acceptance criteria:

1. Preview shows action, network, contract, spender/receiver where relevant, expected asset movements and estimated gas.
2. Contract addresses are copyable and link to the correct explorer.
3. Any configuration/quote change invalidates the preview and requires regeneration before signing.

### US-ACCESS-006: Follow confirmed transaction evidence

- Release: R1
- Priority: Must
- Persona: Wallet user
- PRD: CORE-012
- Depends on: US-ACCESS-005

As a user, I want submitted, confirmed, replaced and failed transaction states with explorer links so that I can verify the actual outcome.

Acceptance criteria:

1. Submitted state displays the transaction hash immediately when available.
2. Confirmed state is based on a receipt and reconciled event/balance evidence, not elapsed time.
3. Replaced, dropped and reverted transactions are never labeled successful and expose a safe retry path.

### US-ACCESS-007: See precise financial units

- Release: R0
- Priority: Must
- Persona: User, Verifier
- PRD: CORE-003
- Depends on: Token metadata

As a user, I want precise token amounts so that rounding or display math cannot misstate my assets.

Acceptance criteria:

1. All canonical calculations use integer base units and token decimals, never binary floating point.
2. Display rounding never exceeds the underlying amount and offers full precision on inspection.
3. Zero, very small, unusually large and differing-decimal assets pass property and UI tests.

### US-ACCESS-008: Understand reward value states

- Release: R1
- Priority: Must
- Persona: Holder
- PRD: CORE-006, CORE-007
- Depends on: Reward data model

As a holder, I want projected, pending, purchased, accrued and claimable values separated so that I do not mistake an estimate for an owned reward.

Acceptance criteria:

1. Each state has a distinct label and plain-language definition.
2. The page states that the launch token is not redeemable for the basket and rewards may be zero.
3. Projected values are never included in realized totals.

### US-ACCESS-009: Verify data freshness

- Release: R1
- Priority: Must
- Persona: Verifier
- PRD: CORE-005
- Depends on: DATA-003 implementation

As a verifier, I want every material amount labeled with its source and block freshness so that I know whether I am seeing live or indexed state.

Acceptance criteria:

1. Chain-derived views expose `asOfBlock` or an explicit live-RPC label.
2. Stale or lagging data receives a visible degraded-state treatment.
3. A transaction preview rechecks correctness-critical values rather than trusting cached data.

### US-ACCESS-010: Use a stable address-based launch page

- Release: R1
- Priority: Must
- Persona: Visitor
- PRD: CORE-004
- Depends on: Launch registry

As a visitor, I want every launch keyed by contract address so that duplicate names and symbols cannot determine identity.

Acceptance criteria:

1. Canonical URL resolves by chain and token address.
2. Name/symbol changes in offchain metadata do not change the canonical identity.
3. Invalid or wrong-chain addresses produce an explicit not-found state.

### US-ACCESS-011: Continue during an isolated failure

- Release: R1
- Priority: Must
- Persona: User
- PRD: CORE-010
- Depends on: Isolation architecture

As a user of an unaffected launch or basket leg, I want service to continue when another route fails so that unrelated activity is not blocked.

Acceptance criteria:

1. A failed route affects only its configured asset/launch scope.
2. Unaffected trading, public reads and finalized claims remain available.
3. UI identifies the exact affected component and does not show a global outage unless one exists.

### US-ACCESS-012: Interact without the Robyn frontend

- Release: R1
- Priority: Must
- Persona: Verifier
- PRD: CORE-009
- Depends on: Published ABI and manifests

As a verifier, I want documented direct contract calls so that Robyn's frontend is not required to inspect or claim assets.

Acceptance criteria:

1. Published addresses, ABI/version and example read/claim inputs are sufficient for an independent script.
2. Direct valid claims have the same result as frontend-generated claims.
3. No API session or Robyn signature is required when the caller already has public proof data.


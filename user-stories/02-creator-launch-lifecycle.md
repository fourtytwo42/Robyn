# Creator launch-lifecycle stories

## Epic C: Token and basket configuration

### US-CREATE-001: Start a guided launch

- Release: R1
- Priority: Must
- Persona: Creator
- PRD: CREATE-001
- Depends on: US-ACCESS-002, proven upstream adapter

As a creator, I want a guided flow with no manual contract entry so that I can launch without protocol expertise.

Acceptance criteria:

1. Flow clearly separates token, basket, economics, permanent rules and preview steps.
2. Progress and completed valid inputs survive normal navigation.
3. The UI never asks the creator to paste factory, fee receiver or reward-token addresses.

### US-CREATE-002: Define safe token metadata

- Release: R1
- Priority: Must
- Persona: Creator
- PRD: CREATE-010, SEC-012, LEGAL-003
- Depends on: Content policy

As a creator, I want to provide token metadata and links so that my launch has an identifiable public presence.

Acceptance criteria:

1. Name, symbol, image, description and optional links are validated and safely rendered.
2. Duplicate names/symbols trigger an address-identity warning but are not represented as unique.
3. Creator acknowledges authority and lawful use of submitted content before launch.

### US-CREATE-003: Select one to three approved assets

- Release: R1
- Priority: Must
- Persona: Creator
- PRD: CREATE-002, CREATE-003
- Depends on: Versioned asset registry

As a creator, I want to choose one to three verified assets so that my basket cannot accidentally reference a lookalike token.

Acceptance criteria:

1. Only registry-backed asset addresses can be selected in the MVP interface.
2. Duplicate addresses, more than three assets and zero/negative weights are blocked.
3. Asset class, canonical address, route state and registry freshness are visible.

### US-CREATE-004: Allocate exact immutable weights

- Release: R1
- Priority: Must
- Persona: Creator
- PRD: CREATE-002, PROTO-001
- Depends on: US-CREATE-003

As a creator, I want exact weights totaling 100% so that future fees follow a permanent verifiable rule.

Acceptance criteria:

1. Weights use basis points and must total exactly 10,000 before preview.
2. Equal-weight and 40/40/20 helpers never silently overwrite intentional values.
3. Preview and deployed configuration match byte-for-byte ordering and weights.

### US-CREATE-005: Recover an interrupted draft

- Release: R1
- Priority: Must
- Persona: Creator
- PRD: CREATE-012
- Depends on: Local draft storage

As a creator, I want safe local draft recovery so that a failed request or refresh does not erase my work.

Acceptance criteria:

1. Valid nonsensitive form state is restored after refresh or recoverable launch failure.
2. Wallet secrets, signatures and stale executable quotes are never persisted.
3. Restored asset/route state is revalidated before preview.

## Epic D: Economics and informed confirmation

### US-CREATE-006: Understand the fee path

- Release: R1
- Priority: Must
- Persona: Creator
- PRD: CREATE-006, CORE-006
- Depends on: Upstream fee configuration

As a creator, I want the total trading fee and every destination separated so that I understand what funds holder rewards.

Acceptance criteria:

1. Upstream protocol fee, creator share assigned to Robyn and any Robyn fee are shown separately.
2. Dollar-volume examples are labeled illustrative fee flow, not yield.
3. Copy says rewards depend on realized trading fees and can be zero.

### US-CREATE-007: Understand batching and route risk

- Release: R1
- Priority: Must
- Persona: Creator
- PRD: CREATE-006, EXEC-007
- Depends on: Execution policy

As a creator, I want conversion thresholds and delay behavior explained so that I do not promise instant basket purchases.

Acceptance criteria:

1. Preview explains minimum economic thresholds and maximum-delay policy.
2. An unavailable leg is described as pending for that same asset, not reallocated.
3. No estimated conversion time is presented as guaranteed.

### US-CREATE-008: Acknowledge permanent product rules

- Release: R1
- Priority: Must
- Persona: Creator
- PRD: CREATE-007, CORE-007, LEGAL-002, LEGAL-004
- Depends on: Approved product copy

As a creator, I want a concise permanent-rules review so that I knowingly commit to an immutable nonredeemable reward model.

Acceptance criteria:

1. Creator separately acknowledges immutable basket and nonredeemability.
2. Risks include zero rewards, delayed conversion, irreversible transactions and third-party dependencies.
3. Copy does not use backed, APY, guaranteed yield, dividend or direct-share claims.

### US-CREATE-009: Review exact launch configuration

- Release: R1
- Priority: Must
- Persona: Creator
- PRD: CREATE-004, CREATE-011
- Depends on: US-CREATE-008

As a creator, I want an exact final preview and machine-readable record so that I can verify what I am about to sign.

Acceptance criteria:

1. Preview includes metadata, supply/market settings, addresses, weights, fees, factories, receiver/controller and estimated gas.
2. Configuration JSON and hash are available before signature.
3. Any edited field invalidates prior confirmation and regenerates the hash.

## Epic E: Atomic launch and post-launch identity

### US-CREATE-010: Prevent an incomplete launch

- Release: R1
- Priority: Must
- Persona: Creator
- PRD: CREATE-005
- Depends on: Proven adapter transaction sequence

As a creator, I want the app to stop an unsafe partial setup so that fees cannot launch without their Robyn destination and registry record.

Acceptance criteria:

1. Preflight proves required fee-recipient and registration steps can complete.
2. If atomic completion is impossible, the UI documents staged failure/recovery and does not label the token Robyn-enabled early.
3. Incomplete state cannot appear in normal discovery as an active reward launch.

### US-CREATE-011: Track launch progress across reloads

- Release: R1
- Priority: Must
- Persona: Creator
- PRD: CREATE-008
- Depends on: US-CREATE-010

As a creator, I want transaction-based progress recovery so that reload or wallet disconnect does not create duplicate launches.

Acceptance criteria:

1. Progress states derive from transaction receipts and indexed events.
2. Reload resumes from known transaction hashes and never resubmits automatically.
3. Revert/replacement state explains the safe next action.

### US-CREATE-012: Land on the canonical token page

- Release: R1
- Priority: Must
- Persona: Creator
- PRD: CREATE-009, CORE-004
- Depends on: Confirmed registration

As a creator, I want a canonical public page immediately after indexing so that I can share verifiable launch information.

Acceptance criteria:

1. Confirmed registration redirects to the chain/address URL.
2. Page shows exact immutable basket and launch transactions.
3. Pending indexing is shown explicitly and resolves without creating another identity.

### US-CREATE-013: View my creator profile

- Release: R1
- Priority: Should
- Persona: Creator
- PRD: DISC-003, DATA-010
- Depends on: Indexed creator address

As a creator, I want a wallet-based profile of my launches and realized activity so that I can monitor performance without implying identity verification.

Acceptance criteria:

1. Profile shows launches, realized fees/rewards and freshness by wallet address.
2. Wallet control is not labeled as real-world identity verification.
3. Public address data is not unnecessarily enriched with personal information.

### US-CREATE-014: Launch with Stock Tokens only after R2 gates

- Release: R2
- Priority: Must
- Persona: Creator
- PRD: CREATE-003, EXEC-003, LEGAL-005, LEGAL-008
- Depends on: Approved R2 asset, legal and quote gates

As a creator, I want only currently qualified Stock Tokens selectable so that my launch does not depend on an unapproved or unexecutable asset.

Acceptance criteria:

1. Selection requires canonical registry, oracle, quote and release-policy approval.
2. Issuer/product identity and current route status are shown.
3. A failed legal or execution gate removes the asset from new launch selection without altering existing baskets.


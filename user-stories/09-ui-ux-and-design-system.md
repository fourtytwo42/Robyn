# UI/UX and design-system stories

## Epic W: Visual foundations

### US-DESIGN-001: Implement semantic color tokens

- Release: R0
- Priority: Must
- Persona: Product designer, Frontend engineer
- PRD: DESIGN-001, DESIGN-016
- Depends on: Design token pipeline

As a frontend engineer, I want all components to consume semantic dark-theme tokens so that visual meaning remains consistent and a later light theme does not require product-logic changes.

Acceptance criteria:

1. Foundation, brand and semantic tokens match the design PRD and are available as versioned design-tool and CSS variables.
2. Component code contains no arbitrary financial/status colors outside the token system.
3. Theme architecture maps semantic roles rather than renaming product states.

### US-DESIGN-002: Verify accessible contrast

- Release: R0-R1
- Priority: Must
- Persona: Accessibility reviewer
- PRD: DESIGN-002
- Depends on: US-DESIGN-001

As an accessibility reviewer, I want every supported component state contrast-tested so that essential content remains perceivable.

Acceptance criteria:

1. Normal text reaches 4.5:1 and large text/essential non-text controls reach 3:1 where WCAG applies.
2. Default, hover, focus, active, disabled, error and stale states are included.
3. Automated failures and manual exceptions block visual sign-off until resolved.

### US-DESIGN-003: Communicate without color alone

- Release: R0-R1
- Priority: Must
- Persona: Color-vision-deficient user
- PRD: DESIGN-003, DESIGN-009
- Depends on: Icon and content vocabulary

As a user who cannot reliably distinguish colors, I want every status labeled and shaped/iconized so that buy/sell, success/failure and reward states remain understandable.

Acceptance criteria:

1. Grayscale review preserves all financial and operational distinctions.
2. Screen readers receive the same status meaning.
3. Red/green never acts as the only gain/loss or buy/sell signal.

### US-DESIGN-004: Use consistent readable typography

- Release: R0
- Priority: Must
- Persona: User, Frontend engineer
- PRD: DESIGN-004, DESIGN-005
- Depends on: Self-hosted font assets

As a user, I want readable interface text and aligned financial numbers so that dense token and reward information is easy to scan accurately.

Acceptance criteria:

1. Self-hosted Inter Variable and IBM Plex Mono load with documented privacy-safe fallbacks.
2. Type roles and minimum body/action sizes match the design PRD.
3. Balances/tables use tabular figures; addresses/hashes have copy and full-value inspection.

## Epic X: Responsive hierarchy and components

### US-DESIGN-005: Complete core journeys responsively

- Release: R1
- Priority: Must
- Persona: Mobile and desktop user
- PRD: DESIGN-006, CORE-011
- Depends on: Responsive application shell

As a user, I want complete create, trade, reward and claim workflows at mobile, tablet and desktop widths so that device size does not remove functionality.

Acceptance criteria:

1. Four-, eight- and twelve-column layouts preserve required content and action order.
2. Interactive targets are at least 44 by 44 CSS pixels.
3. Sticky controls never cover disclosures, errors, wallet controls or claim details.

### US-DESIGN-006: Make the basket visually primary

- Release: R0-R1
- Priority: Must
- Persona: Creator, Trader, Holder
- PRD: DESIGN-007
- Depends on: Discovery/token-page wireframes

As a user, I want assets, weights and realized reward state visually prioritized so that I understand Robyn's distinguishing mechanism before speculative projections.

Acceptance criteria:

1. Discovery cards and token pages expose the basket without expanding a secondary panel.
2. Realized/pending state has stronger hierarchy than projected fee examples.
3. Comprehension testing confirms users can identify basket and nonredeemability.

### US-DESIGN-007: Follow the five-step create hierarchy

- Release: R0-R1
- Priority: Must
- Persona: Creator
- PRD: DESIGN-008
- Depends on: Create-flow prototype

As a creator, I want one primary decision per step and a persistent summary so that I can configure a permanent basket without losing context.

Acceptance criteria:

1. Flow is Token, Basket, Economics, Permanent rules, Preview and launch.
2. Summary continuously shows token identity, weights/total and acknowledgement state.
3. Mobile and desktop preserve the same decision sequence.

### US-DESIGN-008: Reuse canonical financial components

- Release: R0-R1
- Priority: Must
- Persona: Product designer, Frontend engineer
- PRD: DESIGN-009, DESIGN-017
- Depends on: Versioned component inventory

As a product team, we want one canonical component/state vocabulary so that pages cannot invent conflicting meanings for pending, purchased, accrued, claimable or failed.

Acceptance criteria:

1. Component inventory covers wallet, address, asset, basket, metrics, transaction, trade, reward, claim, table and disclosure patterns.
2. Each financial state maps to canonical text, icon and semantic token.
3. Component and token version changes are documented and visually regression-tested.

### US-DESIGN-009: Render safe asset identity fallbacks

- Release: R1
- Priority: Must
- Persona: Visitor, Security reviewer
- PRD: DESIGN-013
- Depends on: Verified asset metadata policy

As a visitor, I want asset icons and fallbacks that cannot impersonate canonical status so that missing or malicious metadata does not mislead me.

Acceptance criteria:

1. Verified logo is used only with known provenance.
2. Fallback uses escaped initials and deterministic treatment while showing the contract address/status.
3. Every icon/avatar has accessible name or adjacent label.

## Epic Y: Data, transaction and motion behavior

### US-DESIGN-010: Use calm factual transaction states

- Release: R1
- Priority: Must
- Persona: Wallet user
- PRD: DESIGN-010
- Depends on: Transaction state machine

As a wallet user, I want factual previews and receipt-driven progress so that animation cannot imply success before the chain confirms it.

Acceptance criteria:

1. Preview, signature, submitted, confirmed, replaced, reverted and safe-retry states are distinct.
2. Progress follows actual wallet/receipt events, not a decorative timer.
3. No artificial urgency or celebratory financial-action treatment appears.

### US-DESIGN-011: Access chart and table evidence

- Release: R1
- Priority: Must
- Persona: Trader, Screen-reader user
- PRD: DESIGN-011
- Depends on: Market/reward data source

As a user, I want charts and tables with source, freshness and nonvisual alternatives so that visualization does not hide exact evidence.

Acceptance criteria:

1. Chart exposes interval, source and `asOfBlock`/time.
2. Keyboard-accessible tooltip and text/table alternative expose meaningful values.
3. Basket visualization always includes exact textual weights.

### US-DESIGN-012: Respect reduced motion

- Release: R1
- Priority: Must
- Persona: Motion-sensitive user
- PRD: DESIGN-012
- Depends on: Motion tokens

As a motion-sensitive user, I want reduced-motion support and non-gamified transitions so that the financial application remains comfortable and calm.

Acceptance criteria:

1. `prefers-reduced-motion` removes nonessential movement without losing state information.
2. Standard transitions remain within documented duration when enabled.
3. No confetti, flashing prices, gain celebrations or false countdown urgency exists.

### US-DESIGN-013: Handle every non-happy state

- Release: R0-R1
- Priority: Must
- Persona: User, Operator
- PRD: DESIGN-014
- Depends on: Component state inventory

As a user, I want explicit loading, empty, stale, partial, unavailable and error states so that absence of data is never confused with zero or success.

Acceptance criteria:

1. Every financial component has reviewed designs for all six states.
2. State names identify retained funds, freshness and next safe action where relevant.
3. Partial component failure does not replace the entire page with a generic error.

### US-DESIGN-014: Apply precise product language

- Release: R0-R2
- Priority: Must
- Persona: User, Content designer, Counsel
- PRD: DESIGN-015, LEGAL-004
- Depends on: Content inventory and legal review

As a user, I want specific calm language so that I can distinguish pending state, failure and risk without hype or ambiguity.

Acceptance criteria:

1. Content uses exact asset/state/amount when known and says unavailable when unknown.
2. Prohibited claims such as backed, APY, guaranteed, dividend and direct shares are absent.
3. Failure copy identifies cause, retained funds and next safe action without unsupported certainty.

### US-DESIGN-015: Complete release visual QA

- Release: R1
- Priority: Must
- Persona: Design and Accessibility reviewers
- PRD: DESIGN-018
- Depends on: Release candidate and component inventory

As a reviewer, I want a signed cross-device accessibility and visual matrix so that polished happy-path screenshots do not substitute for complete design QA.

Acceptance criteria:

1. Matrix covers desktop/mobile, keyboard, screen reader, 200% zoom, contrast and reduced motion.
2. It includes loading, stale, partial, error, long address, large number and translated/expanded text stress states.
3. Unresolved critical accessibility or financial-state ambiguity blocks release.


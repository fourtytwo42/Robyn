# Discovery and trading stories

### US-DISCOVERY-000: Earn King of the Forest once

- Release: R1
- Priority: Must
- Persona: Holder, Trader, Creator
- PRD: DISC-007
- Depends on: Canonical launch and trade projection

As a market participant, I want King of the Forest awarded by a deterministic
one-time rule so that the featured token reflects verifiable activity.

Acceptance criteria:

1. A post-activation qualifying trade must leave the launch at or above 50%
   bonding progress with at least 10 distinct lifetime trader wallets.
2. A launch can receive the award at most once per chain.
3. Canonical replay, duplicate logs, reorg removal, history ordering, and the
   current reigning token are deterministic.

## Epic F: Find and evaluate launches

### US-DISC-001: Search by canonical identity

- Release: R1
- Priority: Must
- Persona: Visitor, Trader
- PRD: DISC-002
- Depends on: Indexed launch registry

As a visitor, I want to search by address, name or symbol so that I can find a launch while treating its address as canonical.

Acceptance criteria:

1. Exact address match is prioritized and displays the full address.
2. Duplicate name/symbol results remain separate and visibly address-qualified.
3. Unsupported chain/address returns an explicit result rather than a misleading match.

### US-DISC-002: Filter and share discovery state

- Release: R1
- Priority: Should
- Persona: Visitor
- PRD: DISC-004
- Depends on: Discovery API

As a visitor, I want filters encoded in the URL so that I can share a repeatable discovery view.

Acceptance criteria:

1. Asset, asset class, basket size, activity and launch-status filters serialize to URL state.
2. Reload and shared link restore the same query.
3. Unsupported/stale filters degrade without hiding all results.

### US-DISC-003: Compare realized reward activity

- Release: R1
- Priority: Must
- Persona: Trader
- PRD: DISC-003, CORE-005, CORE-006
- Depends on: Reward index

As a trader, I want discovery cards to separate realized and pending activity so that I can compare launches without projected rewards masquerading as results.

Acceptance criteria:

1. Cards show basket/weights, pending cash, purchased reward value and freshness separately.
2. Projected fee-flow values are labeled and excluded from realized rankings.
3. Missing data shows unavailable, not zero, unless zero is chain-derived.

### US-DISC-004: Understand rankings

- Release: R1
- Priority: Must
- Persona: Visitor, Product owner
- PRD: DISC-005, DATA-009, ANALYTICS-004
- Depends on: Versioned ranking formula

As a user, I want ranking methodology and manipulation caveats so that raw self-trading does not look like organic success.

Acceptance criteria:

1. Each ranking exposes formula version and source fields.
2. Activity views include wallet concentration/quality signals where available.
3. A simple self-trade simulation cannot dominate every default ranking solely through raw volume.

### US-DISC-005: Resolve moderated content by address

- Release: R1
- Priority: Should
- Persona: Verifier
- PRD: DISC-006, SEC-012
- Depends on: Content policy

As a verifier, I want a moderated token's protocol record reachable by address so that interface moderation does not rewrite chain history.

Acceptance criteria:

1. Unsafe content can be hidden or replaced without hiding contract/configuration facts unless legally required.
2. Direct address view explains moderation state.
3. Sanitized rendering prevents the hidden content from executing or spoofing interface controls.

## Epic G: Inspect and execute a trade

### US-TRADE-001: Inspect token and market state

- Release: R1
- Priority: Must
- Persona: Trader
- PRD: CORE-004, TRADE-007
- Depends on: Canonical token page

As a trader, I want token, creator, market, liquidity, fees and basket shown together so that I can evaluate the complete launch.

Acceptance criteria:

1. Full token address, market/liquidity source and experimental-risk state are visible.
2. Trading remains operationally separate from reward claiming.
3. A reward-system delay does not falsely show the market as unavailable.

### US-TRADE-002: Preview complete trade economics

- Release: R1
- Priority: Must
- Persona: Trader
- PRD: TRADE-001
- Depends on: Upstream quote/trade integration

As a trader, I want expected output, minimum received, price impact, fees and gas before signing so that I understand total trade cost.

Acceptance criteria:

1. Preview separates venue fee and reward-directed creator share.
2. Expected output, minimum received, price impact and estimated gas use the current amount and route.
3. Route/target details are inspectable without obscuring the primary summary.

### US-TRADE-003: Receive a fresh quote

- Release: R1
- Priority: Must
- Persona: Trader
- PRD: TRADE-002
- Depends on: US-TRADE-002

As a trader, I want expired or state-invalid quotes automatically invalidated so that I cannot unknowingly submit stale terms.

Acceptance criteria:

1. Amount, account, chain or material state changes require a new quote.
2. Expired quote disables submission and communicates why.
3. Re-quote never submits or signs automatically.

### US-TRADE-004: Approve the exact spender

- Release: R1
- Priority: Must
- Persona: Trader
- PRD: TRADE-004, EXEC-005
- Depends on: Known upstream spender

As a trader, I want exact or safely scoped approval with visible spender so that I limit allowance risk.

Acceptance criteria:

1. Approval identifies token, spender and amount/scope.
2. Spender matches the reviewed integration manifest.
3. Unexpected spender or target stops the flow before signature.

### US-TRADE-005: Submit on the intended chain and target

- Release: R1
- Priority: Must
- Persona: Trader
- PRD: TRADE-003, SEC-011
- Depends on: US-ACCESS-003, US-TRADE-003

As a trader, I want chain and target revalidated at submission so that compromised or stale frontend state cannot redirect my transaction.

Acceptance criteria:

1. Connected chain, transaction target and selector match reviewed configuration.
2. Mismatch blocks signature and identifies the discrepancy.
3. Revalidation occurs after wallet/network changes.

### US-TRADE-006: Confirm actual trade balances

- Release: R1
- Priority: Must
- Persona: Trader
- PRD: TRADE-005
- Depends on: Submitted trade

As a trader, I want the confirmed trade reconciled against receipt and balances so that I know what actually happened.

Acceptance criteria:

1. Success requires a successful receipt and observed balance/event outcome.
2. Actual received amount is shown separately from preview.
3. Explorer link and refreshed balances are available.

### US-TRADE-007: Recover from failed or replaced trade

- Release: R1
- Priority: Must
- Persona: Trader
- PRD: TRADE-006
- Depends on: Transaction monitoring

As a trader, I want clear failed, dropped or replaced states so that I do not duplicate a transaction.

Acceptance criteria:

1. Replacement transaction is followed and linked.
2. Revert reason is translated where safe without hiding raw evidence.
3. Retry begins from a fresh quote and state check.

### US-TRADE-008: Trade through upstream interface when embedded flow is unavailable

- Release: R1
- Priority: Could
- Persona: Trader
- PRD: TRADE-008
- Depends on: Supported upstream deep link

As a trader, I want a verified upstream fallback so that I can trade even before Robyn embeds the complete swap interface.

Acceptance criteria:

1. Destination domain/market address is verified and clearly external.
2. Robyn shows fee/basket disclosure before handoff.
3. Return/reload reconciles resulting onchain balance without claiming Robyn executed the trade.

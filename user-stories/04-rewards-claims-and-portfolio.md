# Rewards, claims and portfolio stories

## Epic H: Understand reward state

### US-REWARD-001: Inspect every basket leg

- Release: R1
- Priority: Must
- Persona: Holder
- PRD: REWARD-001, CORE-006
- Depends on: Reward API and onchain configuration

As a holder, I want each reward asset shown separately so that I can distinguish pending fees, pending cash, purchases, accrual and claims.

Acceptance criteria:

1. Each immutable leg shows address, weight, pending cash, total purchased/deposited and wallet state.
2. Values in different lifecycle states are never summed into a misleading “earned” total.
3. Every material value exposes freshness and source evidence.

### US-REWARD-002: Understand a delayed conversion

- Release: R1
- Priority: Must
- Persona: Holder
- PRD: REWARD-010, PROTO-004
- Depends on: Route-status data

As a holder, I want to see why a basket leg remains cash so that I know its weight was preserved rather than lost or reassigned.

Acceptance criteria:

1. State identifies threshold wait, unavailable quote, rejected safety check or paused route.
2. Original asset and pending amount remain visible.
3. Other legs continue to show their independent state.

### US-REWARD-003: Follow the reward timeline

- Release: R1
- Priority: Must
- Persona: Holder, Verifier
- PRD: PROTO-009, CORE-012
- Depends on: Indexed protocol events

As a holder, I want a chronological fee-to-claim timeline so that I can trace how rewards became claimable.

Acceptance criteria:

1. Timeline includes fee receipt, allocation, conversion attempt/result, deposit, root lifecycle and claim.
2. Each onchain event links to its transaction and shows protocol time versus indexed time.
3. Failed events remain visible and are not rewritten as successful retries.

## Epic I: Epoch calculation and verification

### US-REWARD-004: Earn according to holding duration

- Release: R1
- Priority: Must
- Persona: Holder
- PRD: REWARD-003, REWARD-008, REWARD-009
- Depends on: Deterministic Transfer index

As a holder, I want my adapter rewards based on qualifying balance over time so that buying late cannot capture earlier rewards and selling cannot erase prior earnings.

Acceptance criteria:

1. Published formula uses complete canonical Transfer history and documented exclusions.
2. A buyer halfway through an epoch receives only the calculated later-period share.
3. A seller retains allocation earned before selling.
4. Transfer/log ordering at the same block is deterministic and documented.

### US-REWARD-005: Inspect an epoch manifest

- Release: R1
- Priority: Must
- Persona: Verifier
- PRD: REWARD-004, DATA-004
- Depends on: Proposed epoch

As a verifier, I want a content-addressed epoch manifest so that I can reproduce exactly what the proposed root represents.

Acceptance criteria:

1. Manifest includes chain, contracts, start/end blocks and hashes, reward totals, exclusions, formula version, ordered-leaf specification and root.
2. Content hash changes on any input/output change.
3. Historical finalized manifests remain retrievable and immutable.

### US-REWARD-006: Reproduce a root and proof

- Release: R1
- Priority: Must
- Persona: Verifier
- PRD: REWARD-005, DATA-005, DATA-007
- Depends on: US-REWARD-005

As a verifier, I want public inputs and tooling to rebuild the root and my proof so that Robyn's API is not the trust anchor.

Acceptance criteria:

1. Independent builders produce byte-identical ordered leaves, totals and root.
2. A proof can be generated offline from public manifest data.
3. A valid direct claim succeeds without an authenticated Robyn API session.

### US-REWARD-007: Challenge an invalid root

- Release: R1
- Priority: Must
- Persona: Verifier, Root guardian
- PRD: SEC-007
- Depends on: Root challenge mechanism

As a verifier, I want an objective challenge window so that an incorrect allocation cannot finalize silently.

Acceptance criteria:

1. Proposed allocations are visible but not claimable during the published delay.
2. A demonstrably invalid root can be rejected only through the scoped mechanism.
3. Guardian cannot substitute discretionary allocations or move reward assets.
4. Correct replacement uses the same deterministic inputs/version or explicitly superseding manifest.

## Epic J: Claim rewards

### US-REWARD-008: Preview a claim

- Release: R1
- Priority: Must
- Persona: Holder
- PRD: REWARD-007
- Depends on: Finalized proof

As a holder, I want to see exact assets, amounts, epoch, contract and gas before signing so that I understand the withdrawal.

Acceptance criteria:

1. Preview lists each selected token amount in base/display units and the proof epoch.
2. Distributor, receiver wallet and estimated gas are shown.
3. Stale account/chain/proof state invalidates the preview.

### US-REWARD-009: Claim exactly once

- Release: R1
- Priority: Must
- Persona: Holder
- PRD: REWARD-002, REWARD-006, PROTO-006
- Depends on: US-REWARD-008

As a holder, I want a pull-based claim that cannot be duplicated so that my entitlement is transferred safely without holder loops.

Acceptance criteria:

1. Valid proof transfers exact selected assets to the intended wallet.
2. Reusing the same epoch/asset entitlement reverts without moving funds.
3. Claim complexity is bounded by selected assets/proofs, not total holders.
4. Malicious receiver/token callbacks cannot reenter and overclaim.

### US-REWARD-010: Accumulate small claims

- Release: R1
- Priority: Should
- Persona: Holder
- PRD: REWARD-011
- Depends on: Multi-epoch claim design

As a holder, I want uneconomic small rewards to remain available for later batching so that gas does not force forfeiture.

Acceptance criteria:

1. Unclaimed finalized entitlement does not expire solely because a new epoch opens.
2. UI compares selected claim value and estimated gas without giving financial advice.
3. Batch failure does not mark any untransferred entitlement claimed.

### US-REWARD-011: Verify claimed state

- Release: R1
- Priority: Must
- Persona: Holder, Verifier
- PRD: REWARD-001, CORE-012
- Depends on: Confirmed claim

As a holder, I want claim history reconciled to onchain transfers so that I can distinguish requested and received rewards.

Acceptance criteria:

1. Claim is marked complete only after successful receipt and transfer evidence.
2. Claimed amount, epoch, asset and transaction are retained in history.
3. Reverted/replaced claim remains retryable with current state.

## Epic K: Portfolio and Stock Token behavior

### US-REWARD-012: View a cross-launch portfolio

- Release: R1
- Priority: Should
- Persona: Holder
- PRD: REWARD-001, DATA-003
- Depends on: Wallet-indexed reward API

As a holder, I want held launches and rewards grouped across my wallet so that I can prioritize claims.

Acceptance criteria:

1. Portfolio separates held tokens, pending allocations, claimable assets and claimed history.
2. Token amounts are primary; fiat estimates show source/time.
3. Each allocation links to its launch, manifest and proof evidence.

### US-REWARD-013: Understand Stock Token issuer controls

- Release: R2
- Priority: Must
- Persona: Holder
- PRD: REWARD-012, LEGAL-005
- Depends on: Approved issuer disclosures

As a holder, I want clear Stock Token issuer/product restrictions so that an ERC-20 transfer is not represented as unrestricted direct stock ownership.

Acceptance criteria:

1. Asset page identifies issuer/product and links controlling information where feasible.
2. Disclosure covers pause, block, migration and recognition risk without claiming exhaustive legal advice.
3. The UI uses “Stock Token,” not direct share ownership or dividend language.

### US-REWARD-014: Preserve claims during unrelated incidents

- Release: R1
- Priority: Must
- Persona: Holder
- PRD: CORE-010, SEC-005
- Depends on: Scoped pause design

As a holder, I want finalized unaffected claims to remain available during a route or registration incident so that emergency controls do not confiscate my rewards.

Acceptance criteria:

1. Route pause blocks only new affected conversions.
2. Existing unaffected finalized claims remain callable.
3. No emergency role can redirect claim receiver or sweep accrued funds.


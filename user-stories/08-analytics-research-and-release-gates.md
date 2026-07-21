# Analytics, research and release-gate stories

## Epic T: Trustworthy measurement

### US-ANALYTICS-001: Trace financial metrics to chain

- Release: R1
- Priority: Must
- Persona: Product/data owner, Verifier
- PRD: ANALYTICS-001
- Depends on: Canonical event model

As a product owner, I want every onchain-derived metric linked to contracts, transactions and block freshness so that dashboards remain auditable.

Acceptance criteria:

1. Metric record retains chain, source contracts/transactions and `asOfBlock`.
2. Dashboard links or exports lineage for material values.
3. Missing/lagging evidence marks the metric unavailable or stale, not current.

### US-ANALYTICS-002: Version safe product telemetry

- Release: R1
- Priority: Must
- Persona: Data/privacy owner
- PRD: ANALYTICS-002, ANALYTICS-007
- Depends on: Approved event taxonomy

As a data owner, I want a minimal versioned first-party event schema so that funnels are measurable without leaking secrets or overtracking users.

Acceptance criteria:

1. Events include schema version and declared fields/purpose.
2. No secret, signature, signed payload or unnecessary wallet-correlated metadata is captured.
3. Third-party trackers require explicit justification and privacy review.

### US-ANALYTICS-003: Keep wallets pseudonymous

- Release: R1
- Priority: Must
- Persona: Privacy owner
- PRD: ANALYTICS-003, DATA-010
- Depends on: Analytics design

As a privacy owner, I want wallet addresses treated as pseudonymous public identifiers so that analytics does not imply verified real-world identity.

Acceptance criteria:

1. Dashboards and exports do not label a wallet as a person without separate verified basis.
2. Unnecessary identity enrichment is absent.
3. Retention/access controls are documented.

### US-ANALYTICS-004: Separate projected and realized rewards

- Release: R1
- Priority: Must
- Persona: Product owner
- PRD: ANALYTICS-005
- Depends on: Reward state model

As a product owner, I want projected fee flow excluded from realized purchase/claim metrics so that growth reporting cannot overstate performance.

Acceptance criteria:

1. Projected, pending, purchased and claimed datasets are distinct.
2. Aggregate realized metric uses only chain-confirmed measured values.
3. Reports label estimate assumptions and timestamp.

### US-ANALYTICS-005: Measure execution quality

- Release: R1-R2
- Priority: Must
- Persona: Product/data owner, Operator
- PRD: ANALYTICS-006
- Depends on: Quote and conversion records

As an operator, I want quote, minimum, actual output, oracle reference and costs compared so that execution quality and route safety are measurable.

Acceptance criteria:

1. Dataset joins quote request/response, policy decision, transaction and measured balance delta.
2. It calculates explicit loss/deviation without hiding failed/rejected attempts.
3. Provider/route/version and market-time context are retained.

### US-ANALYTICS-006: Display safety beside growth

- Release: R1
- Priority: Must
- Persona: Product owner, Governance signer
- PRD: ANALYTICS-010
- Depends on: Operational metrics

As a decision maker, I want reconciliation, route failures, incidents and comprehension beside launches/volume so that growth cannot override safety gates.

Acceptance criteria:

1. Go/no-go dashboard includes growth, quality, safety and comprehension sections.
2. Failed mandatory guardrail visibly prevents a green overall release state.
3. Raw factory events are not labeled unique users or active launches.

## Epic U: Product comprehension and experimentation

### US-ANALYTICS-007: Test creator comprehension

- Release: R0
- Priority: Must
- Persona: Product researcher
- PRD: ANALYTICS-009, CREATE-007
- Depends on: Clickable prototype

As a product researcher, I want creators to complete a basket and explain its rules so that we validate understanding before coding the full app.

Acceptance criteria:

1. At least 10 target creators attempt metadata, 40/40/20 basket, fee and unavailable-asset tasks.
2. Results measure unassisted completion, weight correction, immutable-rule and nonredeemability comprehension.
3. Experiment changes presentation only and cannot alter any signed/deployed economics.

### US-ANALYTICS-008: Test holder comprehension

- Release: R0
- Priority: Must
- Persona: Product researcher
- PRD: ANALYTICS-009, REWARD-001
- Depends on: Reward/claim prototype

As a product researcher, I want holders to distinguish pending, accrued and claimable states so that reward UX does not create false ownership expectations.

Acceptance criteria:

1. At least 15 target holders complete timing, delayed-route, claim-gas and issuer-pause tasks.
2. At least 70% identify nonredeemability before final confirmation and 90% afterward.
3. At least 80% explain pending cash/failed-leg retention and accrued versus claimable.

### US-ANALYTICS-009: Run ethical product experiments

- Release: R1
- Priority: Must
- Persona: Product owner
- PRD: ANALYTICS-009
- Depends on: Experiment governance

As a product owner, I want experiment guardrails so that optimization cannot hide risk, alter immutable economics or pressure trading.

Acceptance criteria:

1. Assignment and variant are documented before exposure.
2. No variant changes a deployed basket/fee promise, hides disclosures, creates fake scarcity or urges trading for rewards.
3. Success includes comprehension/safety, not conversion alone.

## Epic V: Evidence-based release decisions

### US-GATE-001: Prove upstream contract-recipient compatibility

- Release: R0
- Priority: Must
- Persona: Integration engineer
- PRD: CREATE-005, PROTO-003, SEC-006
- Depends on: Funded dedicated mainnet wallet

As an integration engineer, I want a minimal Bags launch/trade/claim spike so that R1 is not designed around assumed contract-recipient behavior.

Acceptance criteria:

1. Dedicated low-value launch assigns the intended Robyn contract entitlement.
2. Real trades generate fees and contract claim completes without EOA-only/support intervention.
3. Exact amounts, implementation/admin state, transactions and terms findings are recorded.
4. Failure triggers the equivalent pons spike; both failing triggers a native-path decision.

### US-GATE-002: Qualify crypto execution for R1

- Release: R0
- Priority: Must
- Persona: Integration engineer, Security reviewer
- PRD: EXEC-001, EXEC-002, EXEC-008, EXEC-010
- Depends on: Authenticated quote access

As an integration engineer, I want authenticated crypto quotes simulated through the contract-wallet path so that R1 has executable routes.

Acceptance criteria:

1. Approved targets/spenders/selectors and commercial access are documented.
2. Exact calldata passes constraints and mainnet-fork simulation.
3. Actual low-value execution reconciles before public pilot.

### US-GATE-003: Qualify each Stock Token

- Release: R2
- Priority: Must
- Persona: Product/data owner, Security owner
- PRD: EXEC-003, EXEC-004, ANALYTICS-006
- Depends on: 30-day authenticated quote study

As a release owner, I want each Stock Token independently qualified so that the registry is not enabled wholesale without execution evidence.

Acceptance criteria:

1. $100/$1,000/$10,000 firm quotes are sampled across open/closed market periods.
2. Candidate meets configured availability, oracle-relative loss and consecutive-session thresholds.
3. Exact contract-wallet route and issuer-control tests pass.
4. Expansion decision is asset-specific and recorded.

### US-GATE-004: Decide whether rewards are economically active

- Release: R1
- Priority: Must
- Persona: Product owner
- PRD: ANALYTICS-004, ANALYTICS-010
- Depends on: Pilot observation period

As a product owner, I want active-launch and threshold-cadence evidence so that we do not scale a reward experience that remains inert.

Acceptance criteria:

1. Weekly active reward launch requires real third-party fees and a successful conversion.
2. Median time to threshold, pending-age distribution, claim gas ratio and wallet concentration are reviewed.
3. No-go, narrower asset set or cadence/copy change is recorded if activity is not meaningful.

### US-GATE-005: Approve R1 expansion

- Release: R1
- Priority: Must
- Persona: Product, Security and Operations owners
- PRD: SEC-009, OPS-001, ANALYTICS-010
- Depends on: Ten real contract-recipient fee claims and completed incident drills

As a release group, we want a shared R1 expansion gate so that no single growth metric authorizes broader exposure.

Acceptance criteria:

1. Financial reconciliation, audit closure, comprehension, operational load and route health all pass.
2. Mandatory failure records a no-go with owner and corrective action.
3. Decision evidence references exact deployed versions and observation period.

### US-GATE-006: Approve Stock Token beta

- Release: R2
- Priority: Must
- Persona: Product, Security, Legal and Operations owners
- PRD: LEGAL-005, LEGAL-008, SEC-009, OPS-003
- Depends on: US-GATE-003 and written legal/provider/upstream conclusions

As a release group, we want a unanimous evidence gate so that Stock Tokens are not enabled on technical composability alone.

Acceptance criteria:

1. Qualified asset, quote, oracle, issuer-control, legal and commercial evidence is complete.
2. No unresolved critical/high finding or required permission/control remains.
3. Approved list, policy versions, caps and incident runbook are recorded.

### US-GATE-007: Decide on native R3

- Release: R3
- Priority: Should
- Persona: Product and Protocol owners
- PRD: PROTO-002, REWARD-003, ANALYTICS-010
- Depends on: Sustained R1/R2 evidence

As a product owner, I want a measured native-versus-adapter decision so that a larger launch-contract surface is built only for a demonstrated problem.

Acceptance criteria:

1. Evidence evaluates Merkle delay/trust, upstream dependence, unit economics and user demand.
2. Native accounting gas/invariants and expanded audit/liquidity scope are estimated.
3. Decision and superseded assumptions are recorded before R3 implementation.


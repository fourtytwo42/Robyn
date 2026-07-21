# Security, governance, legal and incident stories

## Epic Q: Defensive engineering and governance

### US-SEC-001: Defend external-call boundaries

- Release: R0
- Priority: Must
- Persona: Security reviewer
- PRD: SEC-001, SEC-002, SEC-003
- Depends on: Contract harness

As a security reviewer, I want quote mutation, reentrancy and nonstandard-token tests so that external calls cannot steal or falsify balances.

Acceptance criteria:

1. Target/spender/selector/token/receiver mutations revert.
2. Callback receivers/tokens cannot overclaim or reenter protected state.
3. Safe wrappers and measured deltas handle false/no-return token fixtures.

### US-SEC-002: Prove immutable user economics

- Release: R0
- Priority: Must
- Persona: Security reviewer
- PRD: SEC-004, PROTO-001
- Depends on: Launch registry

As a security reviewer, I want authorization tests proving no role can change deployed assets/weights so that governance cannot rewrite the launch promise.

Acceptance criteria:

1. Creator, keeper, guardian and Safe attempts all fail.
2. Pausing/delisting changes execution state only.
3. Immutable state matches configuration hash.

### US-SEC-003: Monitor implementations and admins

- Release: R1
- Priority: Must
- Persona: Operator
- PRD: SEC-006, OPS-005
- Depends on: Deployment manifests

As an operator, I want upstream and Robyn proxy/admin changes detected so that adapter actions halt before incompatible execution.

Acceptance criteria:

1. Unexpected implementation/admin event or storage read triggers scoped halt/alert.
2. Existing unaffected claims remain available.
3. Resume requires reviewed bytecode/source and passing fork compatibility suite.

### US-SEC-004: Continuously check invariants

- Release: R0-R2
- Priority: Must
- Persona: Security reviewer, Operator
- PRD: SEC-008
- Depends on: Accounting invariants and reconciliation pipeline

As a security owner, I want stateful fuzz tests in CI and solvency checks in production so that accounting drift is detected before expansion.

Acceptance criteria:

1. CI covers arbitrary transfer/deposit/conversion/claim order and dust.
2. Production compares deposited, pending, accrued, claimed and current balances.
3. Exception stops affected root/execution publication and alerts.

### US-SEC-005: Close audit findings before release

- Release: R1-R3
- Priority: Must
- Persona: Security owner
- PRD: SEC-009
- Depends on: Independent audit

As a security owner, I want critical/high findings resolved or release stopped so that schedule cannot silently accept material risk.

Acceptance criteria:

1. Finding maps to code version, severity, remediation and retest evidence.
2. Unresolved critical/high produces a recorded no-go.
3. Deployed bytecode matches the remediated audited version.

### US-SEC-006: Receive vulnerability reports

- Release: R1
- Priority: Must
- Persona: Security researcher
- PRD: SEC-010
- Depends on: Public security channel/policy

As a security researcher, I want a disclosure channel and scope so that I can report vulnerabilities without guessing how to reach the team.

Acceptance criteria:

1. Public policy names contact, scope, expected acknowledgement and safe-harbor terms where approved.
2. Reports enter a restricted tracked workflow.
3. Critical report exercises the escalation path before beta.

### US-SEC-007: Secure operator credentials

- Release: R1
- Priority: Must
- Persona: Governance signer, Operator
- PRD: SEC-013, SEC-014
- Depends on: Safe/role design

As a governance signer, I want independent hardware-backed signers and rotatable scoped credentials so that one compromised key cannot control production.

Acceptance criteria:

1. Safe uses documented multi-party quorum and independent recovery.
2. Keeper/proposer/guardian keys are separate and individually revocable.
3. Rotation drill completes without moving holder assets.

## Epic R: Product terms and permissionless policy

### US-LEGAL-001: Use the interface without a false location attestation

- Release: R1
- Priority: Must
- Persona: User
- PRD: LEGAL-001
- Depends on: Counsel-approved flow

As a user, I want truthful access language so that the interface does not force me to falsely claim I am non-US.

Acceptance criteria:

1. No blanket “I am non-US” assertion appears under current policy.
2. Any legally required representation is precise and counsel-approved.
3. Permissionless contract access is not described as legal eligibility.

### US-LEGAL-002: Review complete risk and party disclosures

- Release: R1
- Priority: Must
- Persona: User, Counsel
- PRD: LEGAL-002, LEGAL-006
- Depends on: Operating entity and upstream selection

As a user, I want interface, protocol, upstream, chain, quote provider and issuer roles distinguished so that I understand who provides each part.

Acceptance criteria:

1. Terms cover lawful use, experimental contracts, irreversibility and third-party risks.
2. Interface and autonomous contract responsibilities are not conflated.
3. Version/effective date and acceptance evidence are retained where required.

### US-LEGAL-003: Use accurate product language

- Release: R1-R2
- Priority: Must
- Persona: Counsel, Product owner
- PRD: LEGAL-004, CORE-007
- Depends on: Copy inventory

As a product owner, I want prohibited misleading claims caught across all surfaces so that fee-funded rewards are not presented as redemption backing or guaranteed returns.

Acceptance criteria:

1. Automated/manual copy audit covers UI, metadata templates, notifications and marketing.
2. Product consistently says rewards may be zero and launch token is nonredeemable.
3. Stock Token language avoids direct share/dividend claims.

### US-LEGAL-004: Publish privacy treatment

- Release: R1
- Priority: Must
- Persona: User, Privacy owner
- PRD: LEGAL-007, ANALYTICS-002, ANALYTICS-008
- Depends on: Final analytics stack

As a user, I want to know how wallet and interaction data are used so that I can make an informed privacy choice.

Acceptance criteria:

1. Notice describes onchain public data, first-party telemetry, retention and controls.
2. Telemetry excludes secrets and signed payloads.
3. Required consent/opt-out behavior is implemented and tested.

### US-LEGAL-005: Enforce a legal no-go gate

- Release: R2
- Priority: Must
- Persona: Counsel/compliance owner
- PRD: LEGAL-008
- Depends on: Written legal/provider/upstream answers

As counsel, I want an explicit release gate so that unresolved required permissions or controls stop Stock Token beta.

Acceptance criteria:

1. Gate record lists jurisdiction/entity/product assumptions and written conclusions.
2. Missing required authorization/control results in no-go.
3. Product or architecture change requires renewed review.

## Epic S: Incidents and scoped controls

### US-OPS-001: Receive actionable scoped alerts

- Release: R1
- Priority: Must
- Persona: Operator
- PRD: OPS-001
- Depends on: Component health monitoring

As an operator, I want alerts with exact affected scope and runbook so that I do not over-pause the system.

Acceptance criteria:

1. Alert identifies chain, launch, asset, component, last good block and evidence.
2. Severity and runbook are included.
3. Duplicate symptoms correlate into the same incident where appropriate.

### US-OPS-002: Handle quote or conversion failure

- Release: R1
- Priority: Must
- Persona: Operator
- PRD: OPS-002, SEC-005
- Depends on: Per-route pause

As an operator, I want an affected route paused with pending value retained so that recovery does not alter basket economics.

Acceptance criteria:

1. Affected leg remains pending and visible.
2. Unaffected routes/claims continue.
3. Resume follows successful simulation and documented review.

### US-OPS-003: Handle issuer intervention

- Release: R2
- Priority: Must
- Persona: Operator, Holder
- PRD: OPS-003, LEGAL-005
- Depends on: Issuer-control monitoring/runbook

As an operator, I want new purchases stopped when an issuer pauses, blocks or migrates a Stock Token so that additional exposure is not created blindly.

Acceptance criteria:

1. New affected purchases stop and pending cash is retained.
2. Existing accounting/unaffected claims remain visible.
3. Incident record explains issuer evidence and canonical migration decision.

### US-OPS-004: Stop on provider disagreement

- Release: R1
- Priority: Must
- Persona: Operator
- PRD: OPS-004
- Depends on: Dual-provider block checks

As an operator, I want root publication and keeper execution halted when canonical state disagrees so that inconsistent data cannot become financial state.

Acceptance criteria:

1. Divergent block hash/finality stops affected jobs.
2. Replay starts from last common checkpoint.
3. Resume requires deterministic agreement and recorded evidence.

### US-OPS-005: Rotate after key compromise

- Release: R1
- Priority: Must
- Persona: Governance signer
- PRD: OPS-006
- Depends on: US-SEC-007

As a governance signer, I want to remove roles, revoke approvals and reconcile balances so that a compromised operational key is contained quickly.

Acceptance criteria:

1. Compromised credential is disabled and replacements are scoped.
2. Outstanding approvals are reviewed/revoked.
3. Balances/transactions reconcile and holder claims are not redirected.

### US-OPS-006: Communicate and learn from incidents

- Release: R1
- Priority: Must
- Persona: User, Operator
- PRD: OPS-007, OPS-008
- Depends on: Incident communications process

As a user, I want timestamped factual status and a post-incident report so that I can understand impact and corrective action.

Acceptance criteria:

1. Updates include affected scope, known evidence and transaction references without unsupported certainty.
2. Closure includes cause, financial reconciliation, remediation and regression tests.
3. Runbooks/monitoring are updated from lessons learned.


# Protocol and execution stories

## Epic L: Register launches and conserve fee value

### US-PROTO-001: Register an immutable launch

- Release: R0
- Priority: Must
- Persona: Protocol engineer, Verifier
- PRD: PROTO-001, PROTO-010, PROTO-012
- Depends on: Deployment manifest

As a verifier, I want each launch configuration bounded, immutable and publicly versioned so that its promise cannot change after deployment.

Acceptance criteria:

1. Registration rejects invalid array length, duplicate assets, invalid weights, zero addresses and unsupported versions with custom errors.
2. Stored assets/weights cannot be edited by any role.
3. Component versions, implementation/admin addresses and configuration hash are public.

### US-PROTO-002: Allocate actual received fees

- Release: R0
- Priority: Must
- Persona: Verifier
- PRD: PROTO-002, PROTO-005
- Depends on: Fee receiver harness

As a verifier, I want basket allocation based on actual balance delta so that fee-on-transfer or dishonest return data cannot create insolvency.

Acceptance criteria:

1. Allocation begins from measured post-minus-pre balance.
2. Weighted legs plus carried remainder exactly conserve received units.
3. Property tests cover differing decimals, dust and adversarial tokens.

### US-PROTO-003: Isolate every launch and leg

- Release: R0
- Priority: Must
- Persona: Security reviewer
- PRD: PROTO-003, CORE-010
- Depends on: Router/vault model

As a security reviewer, I want pending and purchased assets isolated by launch and leg so that one failure or claim cannot consume another launch's value.

Acceptance criteria:

1. Cross-launch/asset mutation and withdrawal attempts revert.
2. Accounting remains solvent under interleaved deposits, conversions and claims.
3. A failed leg leaves unrelated state unchanged.

### US-PROTO-004: Prohibit reward sweeping

- Release: R0
- Priority: Must
- Persona: Holder, Security reviewer
- PRD: PROTO-011, SEC-005
- Depends on: Final role model

As a holder, I want no treasury, creator or administrator sweep of reward assets so that operational authority cannot confiscate my entitlement.

Acceptance criteria:

1. ABI/authorization review finds no path to redirect accrued holder rewards.
2. Emergency pause cannot change receiver or transfer rewards to governance.
3. Exceptional reconciliation is recorded but does not invent a discretionary sweep.

### US-PROTO-005: Trigger valid work permissionlessly

- Release: R1
- Priority: Should
- Persona: Keeper, Community caller
- PRD: PROTO-008
- Depends on: Authorized quote model

As a community caller, I want to trigger valid fee collection/conversion so that liveness does not depend on one operator.

Acceptance criteria:

1. Any caller can submit the same constrained operation if all policy checks pass.
2. Caller cannot choose arbitrary recipient, asset, target or amount beyond pending bounds.
3. Invalid/stale requests revert without losing pending funds.

### US-PROTO-006: Audit the complete event trail

- Release: R1
- Priority: Must
- Persona: Verifier, Indexer
- PRD: PROTO-009
- Depends on: Stable event schema

As a verifier, I want complete events for launch, receipt, allocation, conversion, deposit, root and claim so that state can be independently reconstructed.

Acceptance criteria:

1. Events include canonical launch/asset identifiers and measured amounts.
2. Event ordering supports deterministic replay without relying on UI telemetry.
3. ABI/event schema changes are versioned and documented.

## Epic M: Constrained execution

### US-EXEC-001: Validate exact quote intent

- Release: R1
- Priority: Must
- Persona: Security reviewer
- PRD: EXEC-001, PROTO-007, SEC-001
- Depends on: Execution registry

As a security reviewer, I want every quote field constrained so that provider or keeper compromise cannot redirect funds.

Acceptance criteria:

1. Contract checks input/output token, receiver, spender, target, selector and bounded input amount.
2. Mutation of any checked field reverts before approval/call.
3. Keeper cannot register new targets or policies through the execution call.

### US-EXEC-002: Reject stale or unbounded quotes

- Release: R1
- Priority: Must
- Persona: Keeper
- PRD: EXEC-002
- Depends on: US-EXEC-001

As a keeper, I want deadline and minimum-output enforcement so that delayed transactions do not execute at arbitrary prices.

Acceptance criteria:

1. Zero min-output and expired deadline revert.
2. Actual balance delta below minimum reverts atomically.
3. Pending leg balance remains intact after rejection.

### US-EXEC-003: Use safely scoped approvals

- Release: R1
- Priority: Must
- Persona: Security reviewer
- PRD: EXEC-005, SEC-003
- Depends on: Approved spender list

As a security reviewer, I want exact/safely scoped allowances and safe token operations so that residual approval cannot be abused.

Acceptance criteria:

1. Allowance never exceeds approved pending input policy.
2. Required reset/clear behavior is tested for nonstandard tokens.
3. No-return, false-return and callback token fixtures cannot create false success.

### US-EXEC-004: Execute legs independently

- Release: R1
- Priority: Must
- Persona: Holder
- PRD: EXEC-006, PROTO-004
- Depends on: Per-leg pending balances

As a holder, I want one valid leg to convert even when another fails so that basket execution degrades locally.

Acceptance criteria:

1. Calls operate on one launch/leg or preserve per-leg atomicity in a batch.
2. Failed leg retains exact pending funds.
3. Successful leg output/deposit is unaffected and auditable.

### US-EXEC-005: Batch economically

- Release: R1
- Priority: Must
- Persona: Keeper, Holder
- PRD: EXEC-007
- Depends on: Threshold policy

As a holder, I want tiny fee amounts accumulated until conversion is economical so that gas and slippage do not consume rewards.

Acceptance criteria:

1. Below-threshold leg remains pending unless maximum-delay policy authorizes evaluation.
2. Threshold policy/version and expected cost inputs are observable.
3. Execution does not silently waive safety limits to meet delay targets.

### US-EXEC-006: Reconcile quote and actual output

- Release: R1
- Priority: Must
- Persona: Operator, Verifier
- PRD: EXEC-008
- Depends on: Conversion events and monitoring

As an operator, I want quoted, minimum and actual output compared so that route degradation or manipulation is detected.

Acceptance criteria:

1. Attempt record includes provider/route version, quote, minimum, actual and transaction.
2. Alert thresholds distinguish allowed slippage from reconciliation failure.
3. Actual output is measured by balance delta.

### US-EXEC-007: Simulate direct AMM routes

- Release: R1
- Priority: Must
- Persona: Keeper, Security reviewer
- PRD: EXEC-009
- Depends on: Mainnet fork and oracle policy

As a keeper, I want the exact AMM call simulated at intended state so that manipulable discovery prices are not treated as execution evidence.

Acceptance criteria:

1. Exact calldata simulates successfully against the intended block/state.
2. Route still passes target, min-out and applicable price guards.
3. Simulation failure stops submission and preserves pending value.

### US-EXEC-008: Require authenticated executable quotes

- Release: R1
- Priority: Must
- Persona: Integration engineer
- PRD: EXEC-010
- Depends on: Commercial provider access

As an integration engineer, I want authenticated firm quotes separated from discovery prices so that production claims are based on executable terms.

Acceptance criteria:

1. Anonymous/Dexscreener/oracle values cannot populate executable calldata.
2. Provider authentication and commercial configuration remain server-side.
3. Unsupported/401/unavailable response produces a delayed leg, not fallback to unsafe output.

### US-EXEC-009: Validate a canonical Stock Token route

- Release: R2
- Priority: Must
- Persona: Keeper, Security reviewer
- PRD: EXEC-003, EXEC-004
- Depends on: R2 registry, feed and legal gates

As a keeper, I want canonical token and oracle status checked immediately before Stock Token purchase so that stale, paused or lookalike assets cannot be bought.

Acceptance criteria:

1. Output address/code/status matches the approved canonical registry snapshot/policy.
2. Feed decimals, positive answer, freshness and sequencer/market policy pass.
3. Failed check preserves pending cash and identifies the blocked condition.

## Epic N: Native accounting option

### US-PROTO-007: Preserve rewards through transfers

- Release: R3
- Priority: Must
- Persona: Holder
- PRD: REWARD-008, REWARD-009, PROTO-002
- Depends on: Native accumulator implementation

As a holder of a native Robyn token, I want transfer-integrated accrual so that rewards follow earning history without Merkle epochs.

Acceptance criteria:

1. Buyer cannot receive a pre-purchase distribution.
2. Seller retains pre-sale accrued rewards.
3. Transfer/mint/burn sequences preserve system entitlement within bounded dust.
4. Gas is profiled for one, three and five slots before the R3 decision.


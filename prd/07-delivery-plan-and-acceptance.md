# Delivery plan and acceptance

Status: Draft  
Owner: Product/engineering TBD  
Date: 2026-07-20

## Delivery principle

Resolve the highest-risk assumptions before building the broadest surface. The order is accounting correctness, upstream compatibility, execution evidence, user comprehension, then production hardening.

## Workstreams

| Workstream | Deliverables |
|---|---|
| Product/design | Wireframes, content system, prototype, usability findings, final flows |
| Protocol | Accounting harness, adapter contracts, execution guards, distributor, deployment manifests |
| Integration | Bags then pons spike, quote providers, asset registry, oracle/feed adapters |
| Platform | Web app, indexer, API, epoch builder, keeper, database, proof service |
| Security | Threat model, fuzz/invariants, fork tests, access model, audit/remediation |
| Legal/operations | Terms questions, counsel gates, policies, runbooks, monitoring, incident drills |
| Analytics | Event schema, product dashboards, quote dataset, cohort and comprehension reporting |

## Milestone 0: Product contract

Deliver:

- approved PRD decisions and requirement changes;
- prototype covering create, token detail, rewards and claim;
- exact adapter and native product-language distinction;
- initial crypto asset policy;
- acceptance-test skeleton mapped to requirement IDs.

Exit:

- product, engineering and security agree on the R1 boundary;
- unresolved decisions have owners and deadlines;
- no screen uses “backed,” “APY,” or other prohibited positioning.

## Milestone 1: Risk spikes

### Accounting spike

Build a Foundry harness with three mock reward assets, mock fee deposits, transfer-integrated reference accounting and adapter epoch fixtures.

Pass:

- all invariants in `PROTO-` and `REWARD-` pass under stateful fuzzing;
- arbitrary transfer/claim order reconciles;
- gas measured for 1, 3 and 5 native assets;
- deterministic epoch implementations produce identical roots.

### Bags integration spike

Deploy a minimal contract receiver and prove launch, buy/sell fee generation, contract claim and exact balance reconciliation using a dedicated low-value mainnet wallet.

Pass:

- no EOA-only signature or privileged support step;
- fee entitlement cannot be silently redirected under the intended launch configuration;
- implementation/admin behavior is understood and monitored;
- terms/license/ABI usage is acceptable for continued integration.

If Bags fails, run the pons fee-wallet spike. If both fail, record D-008 as superseded and plan native R1.

### Quote spike

Obtain authenticated 0x/1inch access and record firm quotes for selected crypto plus representative Stock Tokens. Stock evidence continues for 30 days before R2.

Pass for R1 crypto:

- exact allowed targets/spenders/selectors documented;
- contract-wallet calldata simulates and executes on a fork;
- expected versus actual output reconciles;
- provider commercial use is understood.

## Milestone 2: R0 end-to-end validation

Build on Robinhood Chain testnet with project mocks:

- create/register one token-like test launch;
- immutable three-asset configuration;
- synthetic fees and threshold allocation;
- successful and failed conversions;
- epoch proposal/challenge/finalization;
- two wallets with different holding intervals;
- public proof generation and claims;
- full web/indexer/API/keeper observability.

No mainnet Stock Token addresses are reused as testnet fixtures.

Exit:

- complete accounting reconciliation;
- deterministic rebuild from genesis/checkpoint;
- core mobile/desktop journeys pass;
- incident drills for RPC failure, invalid root and route failure pass.

## Milestone 3: R1 crypto adapter pilot

Deploy capped mainnet beta using the proven adapter and approved crypto assets.

Progressive exposure:

1. Internal dedicated wallets.
2. Invited creators with explicit caps.
3. Small public experimental cohort.
4. Broader beta only after observed reconciliation and support metrics pass.

Exit observation period should cover at least:

- ten completed contract-recipient fee claims;
- multiple finalized epochs and holder claims;
- a failed/delayed conversion path;
- an upstream implementation-monitor event simulation;
- sufficient launch activity to test whether weekly rewards feel meaningful.

## Milestone 4: R2 Stock Token beta

Add only assets passing:

- canonical registry/code/status check;
- reliable authenticated firm-quote threshold;
- feed availability/freshness policy;
- observed $100 execution-loss threshold;
- issuer-control test fixtures;
- legal/provider/upstream approval gate.

Do not enable the entire Robinhood registry by default. Expand one asset at a time through recorded policy decisions.

## Milestone 5: Native launchpad decision

Use R1/R2 evidence to decide whether native accrual is worth the extra token, pool, launch, liquidity and audit surface.

Proceed only if at least one is true:

- Merkle delay/trust meaningfully harms retention or comprehension;
- upstream fee economics/configuration prevents the intended promise;
- upstream upgrades create unacceptable operational dependency;
- a native launch materially improves unit economics and creator demand.

## Epic map

| Epic | Requirements |
|---|---|
| Wallet and transaction foundation | `CORE-001` to `CORE-012` |
| Creator launch wizard | `CREATE-001` to `CREATE-012` |
| Discovery and profiles | `DISC-001` to `DISC-006` |
| Trading integration | `TRADE-001` to `TRADE-008` |
| Reward dashboard and claims | `REWARD-001` to `REWARD-012` |
| Fee/vault/distributor contracts | `PROTO-001` to `PROTO-012` |
| Constrained conversions | `EXEC-001` to `EXEC-010` |
| Indexer/API/epoch builder | `DATA-001` to `DATA-010` |
| Runtime infrastructure | `INFRA-001` to `INFRA-014` |
| Security and governance | `SEC-001` to `SEC-014` |
| Legal/product policy | `LEGAL-001` to `LEGAL-008` |
| Operations | `OPS-001` to `OPS-008` |
| Measurement | `ANALYTICS-001` to `ANALYTICS-010` |
| Visual design system | `DESIGN-001` to `DESIGN-018` |
| Technology stack | `STACK-001` to `STACK-024` |

## End-to-end acceptance scenarios

### E2E-01: Successful three-asset launch

Given a connected creator on Robinhood Chain, when they define valid metadata and a 40/40/20 basket, acknowledge permanent rules and sign, then the upstream token, fee entitlement and Robyn registry entry are created; the canonical page shows the exact configuration and transactions.

### E2E-02: Invalid basket

Duplicate assets, zero weights, more than three assets, unsupported addresses or a total other than 10,000 bps cannot reach signature. Existing valid form state remains intact.

### E2E-03: Fee allocation and batching

Given received fee balance, each leg receives its exact weighted amount plus deterministic remainder handling. Legs below threshold remain pending. An executable leg converts without changing other legs.

### E2E-04: Failed conversion

A stale/invalid quote or reverting asset route moves no funds, preserves the affected pending balance, emits an actionable result and does not block another valid leg.

### E2E-05: Time-weighted ownership

Wallet A holds throughout an epoch; Wallet B buys halfway through and sells before close. Independently rebuilt allocations match the published root, prior ownership is not transferred, and each valid claim succeeds once.

### E2E-06: Root challenge

An intentionally incorrect root is detected through independent reproduction, rejected during the delay, never becomes claimable and is replaced only by a deterministic valid candidate.

### E2E-07: Degraded infrastructure

With public RPC throttled, the page retains cached read state and allows alternate RPC selection. With archive providers disagreeing, epoch publication and keeper execution stop safely.

### E2E-08: Upstream upgrade

When the selected launchpad proxy implementation changes, adapter claims/execution halt automatically. Unaffected holder claim rights remain available. Resume requires reviewed source/bytecode and passing fork tests.

### E2E-09: Issuer incident

For R2, a mocked Stock Token pause stops new purchases for that leg, preserves pending funds and existing accounting, communicates the incident and leaves unrelated assets operational.

### E2E-10: Direct verification

Without Robyn's web/API, an independent user retrieves public configuration/logs/manifests, reconstructs a proof and submits a valid claim directly.

## Definition of done

A requirement is done only when:

- implementation and user-facing behavior exist;
- automated tests cover normal, boundary and failure paths;
- observability and runbook coverage exist where operational;
- security/privacy/accessibility review is complete;
- documentation and deployment/configuration manifests are current;
- product owner accepts behavior against its requirement ID;
- no known contradiction exists with the decision register.

## Indicative sequencing, not commitment

| Stage | Relative effort |
|---|---|
| Product contract and prototype | 1-2 weeks |
| Accounting, adapter and quote spikes | 2-4 weeks, depending on access/funding |
| R0 end-to-end testnet | 4-8 weeks |
| Audit preparation and review | 3-6 weeks plus remediation |
| R1 capped crypto pilot | 2-4 weeks of observation after deployment |
| R2 Stock Token beta | Dependent on 30-day execution study and legal gates |
| Native R3 | Roughly 3-5 additional months plus audit if approved |

Estimates assume an experienced small team and can change materially after the spikes.

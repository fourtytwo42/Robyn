# Robyn comprehensive user-story set

Status: Draft backlog  
Version: 0.5
Date: 2026-07-20

## Purpose

This backlog translates the [PRD set](../prd/README.md) into independently testable outcomes. Stories cover user-facing behavior, protocol actors, verification, operations, security, legal, analytics and staged delivery. They are product stories, not implementation tickets; engineering may split them without weakening acceptance criteria or losing PRD traceability. Acceptance criteria use Given/When/Then where behavior benefits from scenarios and precise declarative conditions for invariants, controls and evidence gates.

## Story collections

| File | Epics |
|---|---|
| [01 - Access, wallet and shared experience](01-access-wallet-and-shared-experience.md) | Anonymous access, connection, network, transaction safety, accessibility and degraded state |
| [02 - Creator launch lifecycle](02-creator-launch-lifecycle.md) | Metadata, basket, economics, preview, acknowledgement, launch, recovery and creator profile |
| [03 - Discovery and trading](03-discovery-and-trading.md) | Search, rankings, token detail, quote preview, allowance, trade status and moderation |
| [04 - Rewards, claims and portfolio](04-rewards-claims-and-portfolio.md) | Reward-state comprehension, epochs, proofs, claims, history and Stock Token disclosures |
| [05 - Protocol and execution](05-protocol-and-execution.md) | Registration, fee allocation, isolation, conversions, native accounting and public triggers |
| [06 - Data, infrastructure and reliability](06-data-infrastructure-and-reliability.md) | Event ingestion, deterministic rebuilds, API, RPC, keeper, deployments, backups and health |
| [07 - Security, governance, legal and incidents](07-security-governance-legal-and-incidents.md) | Threat controls, roles, permissionless policy, terms, monitoring and incident response |
| [08 - Analytics, research and release gates](08-analytics-research-and-release-gates.md) | Measurement, privacy, usability, liquidity experiments and go/no-go decisions |
| [09 - UI/UX and design system](09-ui-ux-and-design-system.md) | Color, typography, responsive hierarchy, components, charts, motion, content and visual QA |
| [10 - Technology stack and developer platform](10-technology-stack-and-developer-platform.md) | Monorepo, frontend, API, persistence, jobs, contracts, tests, observability and releases |
| [11 - DAO, governance and protocol fees](11-dao-governance-and-protocol-fees.md) | RDAO rewards, voting, treasury and immutable fee routing |
| [12 - Multi-wallet connection](12-multi-wallet-connection.md) | EIP-6963, WalletConnect, chain switching, SIWE invalidation and protected builds |
| [13 - Immutable IPFS token metadata](13-immutable-ipfs-token-metadata.md) | ERC-1046 identity, deterministic artwork, verified provenance, pinning and recovery |
| [Traceability matrix](TRACEABILITY.md) | Generated mapping from every PRD requirement to covering stories |

## Personas

| Persona | Description |
|---|---|
| Creator | Launches and promotes a community token and chooses its immutable reward basket |
| Visitor | Browses launches without connecting a wallet |
| Trader | Evaluates and buys or sells a launch token |
| Holder | Owns a launch token and monitors or claims rewards |
| Verifier | Independently checks configuration, accounting, proofs and contract state |
| Keeper | Triggers strictly constrained fee collection and conversion for liveness |
| Operator | Maintains indexing, deployments, monitoring and incident response without custody discretion |
| Governance signer | Uses Safe-scoped authority for reviewed changes and emergencies |
| Security reviewer | Tests contracts, frontend, infrastructure and role boundaries |
| Counsel/compliance owner | Resolves product language, terms and release gates without inventing product facts |
| Product/data owner | Measures comprehension, activity, economics and release readiness |

## Metadata

- **Release:** `R0` validation, `R1` crypto adapter MVP, `R2` Stock Token beta, `R3` optional native launchpad.
- **Priority:** `Must`, `Should`, or `Could` for the named release.
- **PRD:** requirement IDs implemented or materially validated by the story.
- **Depends on:** story IDs or external gates that must precede acceptance.

## Story format

```md
### US-AREA-001: Outcome title

- Release: R1
- Priority: Must
- Persona: Creator
- PRD: CREATE-001, CORE-001
- Depends on: US-ACCESS-002

As a creator, I want ... so that ...

Acceptance criteria:

1. Given ..., when ..., then ...
2. Given ..., when ..., then ...
```

## Backlog rules

- Acceptance criteria are cumulative; passing the happy path alone is insufficient.
- Financial values must reconcile to chain state and use integer token units.
- A story cannot override the [decision register](../prd/00-product-brief-and-decisions.md).
- “Done” includes automated tests, failure behavior, observability, accessibility/security review where applicable, and current documentation.
- R2 stories remain gated even if their UI can be prototyped earlier.
- Technical/enabler stories are written from the human actor responsible for verifying the outcome.
- External funding, commercial access, legal conclusions or upstream behavior are dependencies, not silently assumed implementation details.

## Definition of ready

A story is ready when its release, priority, PRD mapping, dependencies, UX/contract assumptions, data source and acceptance evidence are known. Unknown external behavior is represented by a spike story first.

## Definition of done

A story is done when all acceptance criteria pass in the intended environment, relevant telemetry and runbooks exist, security/privacy/accessibility checks are complete, deployment/configuration evidence is recorded and the mapped PRD requirements remain satisfied.
# DAO stories

- [11 - DAO, governance, and protocol fees](11-dao-governance-and-protocol-fees.md)

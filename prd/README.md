# Robyn launchpad PRD set

Status: Draft for implementation planning  
Version: 0.5
Date: 2026-07-20

## Purpose

This folder converts the completed Robinhood Chain research into an implementation-ready product contract for Robyn: a launchpad where creators deploy community tokens, choose an immutable reward basket, and direct trading-fee revenue into assets that eligible token holders can claim.

The documents distinguish the first shippable product from the eventual native launchpad:

- **Validation build:** three-asset accounting harness, mock assets and funded launchpad compatibility tests.
- **Adapter MVP:** Robyn-branded launch experience using Bags if the contract-recipient spike passes; crypto reward assets first; time-weighted Merkle reward epochs.
- **Stock Token beta:** canonical Robinhood Stock Tokens added only after firm-quote, oracle, legal and security gates pass.
- **Native launchpad:** optional later release with a reward-aware token and transfer-integrated onchain accounting.

## Documents

| Document | Owns |
|---|---|
| [00 - Product brief and decision register](00-product-brief-and-decisions.md) | Vision, terminology, settled decisions, assumptions and unresolved decisions |
| [01 - Master product requirements](01-master-product-requirements.md) | Users, outcomes, scope, system behavior, quality bar and release criteria |
| [02 - Creator, launch and discovery experience](02-creator-launch-and-discovery.md) | Token creation, basket construction, preview, transaction flow, discovery and creator pages |
| [03 - Trading, rewards and holder experience](03-trading-rewards-and-holder-experience.md) | Token detail, trading, reward states, claims, portfolio and disclosures |
| [04 - Protocol, accounting and execution](04-protocol-accounting-and-execution.md) | Contract topology, fee collection, basket execution, epochs/native accounting and invariants |
| [05 - Platform, data and infrastructure](05-platform-data-and-infrastructure.md) | Frontend, API, indexer, keeper, storage, RPC strategy, observability and performance |
| [06 - Security, compliance and operations](06-security-compliance-and-operations.md) | Threat controls, roles, incident handling, permissionless-access policy and release gates |
| [07 - Delivery plan and acceptance](07-delivery-plan-and-acceptance.md) | Workstreams, milestones, dependencies, end-to-end acceptance and definition of done |
| [08 - Analytics and experimentation](08-analytics-and-experimentation.md) | Product events, dashboards, success metrics, user research and launch experiments |
| [09 - UI/UX and visual design system](09-ui-ux-visual-design-system.md) | Palette, typography, layout, information hierarchy, components, motion, content and design QA |
| [10 - Technology stack and repository architecture](10-technology-stack-and-repository-architecture.md) | Monorepo, frontend, backend, contracts, data, testing, observability and deployment baseline |

## Requirement namespace

| Prefix | Area |
|---|---|
| `CORE-` | Cross-product behavior |
| `CREATE-` | Creator and launch flow |

The implementation sequence and evidence gates are defined in [Devnet-to-testnet readiness plan](../docs/devnet-to-testnet-readiness-plan.md).
| `DISC-` | Discovery and public profiles |
| `TRADE-` | Trading experience |
| `REWARD-` | Reward and claim experience |
| `PROTO-` | Smart contracts and accounting |
| `EXEC-` | Conversion and quote execution |
| `DATA-` | Indexer, API and storage |
| `INFRA-` | RPC, keeper and deployment infrastructure |
| `SEC-` | Security controls |
| `LEGAL-` | Terms, disclosures and policy |
| `OPS-` | Monitoring and incident response |
| `ANALYTICS-` | Measurement and experimentation |
| `DESIGN-` | Visual system, interaction patterns and design QA |
| `STACK-` | Application technologies, repository boundaries and toolchain |

`MUST`, `SHOULD`, and `MAY` have their usual product-requirement meaning. Any change to a `MUST` requirement requires an entry in the decision register.

## Source hierarchy

If documents conflict, use this order:

1. Current deployed code and verified test results.
2. [Product brief and decision register](00-product-brief-and-decisions.md).
3. [Master product requirements](01-master-product-requirements.md).
4. The relevant subsystem PRD.
5. Earlier files in `research/`.

Research evidence remains authoritative for point-in-time external facts. PRDs are authoritative for the intended product.

All implementation and operations use the authoritative VM-only, no-container model in [Technology stack and repository architecture](10-technology-stack-and-repository-architecture.md) and [VM runtime and operations](../docs/vm-runtime-and-operations.md).


## Current blockers

- Bags and pons contract-recipient behavior has not been proven with funded transactions.
- Authenticated 0x and 1inch firm Stock Token quotes have not been sampled.
- No canonical Robinhood testnet Stock Token registry or public faucet was located.
- Legal treatment of permissionless fee-funded Stock Token distribution requires counsel and written upstream clarification.
- The Git repository and VM environment exist, but no application contracts, native data services or persistent PM2 application processes have been implemented yet.

## Delivery backlog

Implementation and validation stories derived from this PRD set are indexed in [user-stories/README.md](../user-stories/README.md). The generated [traceability matrix](../user-stories/TRACEABILITY.md) must continue to show complete PRD coverage as stories or requirements change.
# DAO release

- [11 - DAO, governance, and protocol fees](11-dao-governance-and-protocol-fees.md)

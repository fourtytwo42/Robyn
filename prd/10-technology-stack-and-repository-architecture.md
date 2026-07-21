# Technology stack and repository architecture

Status: Settled baseline for implementation  
Owner: Engineering TBD  
Date: 2026-07-20

## Purpose

Lock the application stack and repository boundaries so implementation begins from one reproducible baseline. Major technologies are settled here. Exact patch versions must be pinned in the lockfile and deployment manifests when the repository is initialized.

## Monorepo

Use a `pnpm` workspace with Turborepo task orchestration.

```text
apps/
  web/              Next.js application
  api/              Fastify public/read and protected operations API
  indexer/          Canonical event ingestion and derivation
  keeper/           Quote, simulation and constrained execution worker
  epoch-builder/    Deterministic balance and Merkle calculation worker

packages/
  contracts/        Foundry Solidity project
  chain-config/     Addresses, ABIs, bytecode hashes and deployment manifests
  protocol-sdk/     Typed reads and transaction builders
  schemas/          Shared Zod request/event/artifact schemas
  design-system/    Tokens and reusable React components
  epoch-core/       Pure deterministic epoch calculation and serialization
  observability/    Shared logging, metrics and tracing setup

infrastructure/
  containers/       Container definitions and local composition
  deployments/      Environment manifests and release records
  monitoring/       Dashboards and alert rules
  runbooks/         Operational procedures
```

Applications may deploy separately. Shared packages cannot import an application. `epoch-core` cannot depend on network, database, clock or framework state.

## Runtime and package policy

- Node.js active LTS at repository initialization, pinned through toolchain files and CI.
- Strict TypeScript in every Node/browser package.
- `pnpm` with one committed lockfile; frozen installs in CI.
- Turborepo for dependency-aware build, lint, typecheck and test tasks.
- ESLint and Prettier with repository-owned configuration.
- Changesets for versioning publishable/internal shared packages when versioning becomes useful.
- Renovate or Dependabot may propose dependency updates, but no unattended merge for wallet, contract, quote, cryptographic, database or build-tool dependencies.

## Frontend

| Concern | Selection |
|---|---|
| Framework | Next.js 15 App Router |
| UI runtime | React 19 |
| Language | Strict TypeScript |
| Styling | Tailwind CSS v4 backed by the semantic tokens in PRD 09 |
| Component primitives | Radix UI; shadcn/ui components copied into and owned by `packages/design-system` |
| EVM client | `viem` |
| React wallet/query integration | `wagmi` |
| Wallet transports | Injected EIP-1193 wallets plus WalletConnect |
| Server/RPC state | TanStack Query |
| Tables | TanStack Table |
| Runtime schemas | Zod |
| Forms | React Hook Form plus Zod resolver |
| Market time-series | TradingView Lightweight Charts |
| Basket/reward charts | Recharts, with accessible text/table alternatives |
| Unit/component tests | Vitest plus Testing Library |
| End-to-end tests | Playwright |

Prefer React Server Components for public, cacheable content. Wallet, quote, transaction and live-RPC behavior remains in explicit client components. No provider key or protected quote response is exposed through server-rendered page payloads.

Use `viem`, not ethers.js, for first-party chain code. An upstream SDK may carry ethers internally only when isolation and bundle/security review justify it.

## API and workers

| Concern | Selection |
|---|---|
| Runtime | Node.js with strict TypeScript |
| API framework | Fastify |
| Schemas | Zod shared through `packages/schemas` |
| Database | PostgreSQL |
| Database toolkit | Drizzle ORM and committed SQL migrations |
| Durable job queue | Redis plus BullMQ |
| Object/artifact storage | S3-compatible storage; MinIO for local development |
| Chain access | `viem` public/wallet clients |
| Structured logs | OpenTelemetry-compatible JSON logging |
| Tracing/metrics | OpenTelemetry |
| Application error reporting | Sentry |
| Operational metrics | Prometheus-compatible metrics and Grafana dashboards |

Fastify owns HTTP/API concerns only. Indexing, keeper and epoch calculation run as separate processes. BullMQ schedules/retries jobs but is not the financial source of truth. PostgreSQL checkpoints and onchain state establish idempotency.

## Smart contracts

| Concern | Selection |
|---|---|
| Language | Solidity |
| Toolchain | Foundry |
| Libraries | Pinned OpenZeppelin Contracts release |
| Tests | Forge unit, fuzz, stateful invariant and mainnet-fork suites |
| Formatting/static checks | `forge fmt`, compiler warnings as failures and selected static analyzers |
| Deployment | Reviewed Foundry scripts with dry run/simulation and saved manifests |
| Administration | Canonical Safe plus scoped timelock/roles |

Contract packages export ABIs and deployment artifacts into `chain-config` through a deterministic build step. Generated files are never hand-edited.

## Data boundaries

- PostgreSQL stores raw canonical logs, derived read models, job/checkpoint state and artifact metadata.
- Redis contains disposable queue and short-lived coordination state, never sole ownership/reward truth.
- S3-compatible storage contains immutable content-addressed epoch manifests, ordered leaves and proof bundles.
- Browser local storage contains only nonsensitive preferences/drafts; no credentials, signatures or executable quotes.
- Secrets use a managed deployment secret store and are injected only into the service that needs them.

## Testing pyramid

1. Pure domain tests for epoch/accounting serialization and schema behavior.
2. Contract unit/fuzz/invariant tests in Foundry.
3. TypeScript unit/component tests with Vitest and Testing Library.
4. PostgreSQL/Redis/S3 integration tests using isolated containers.
5. Mainnet/testnet fork tests for upstream factories, quotes, tokens and feeds.
6. Playwright end-to-end tests for anonymous, wallet, create, trade and claim states.
7. Security, accessibility, visual-regression, load, backup/restore and incident drills at release gates.

Tests use deterministic fixtures and pinned block numbers. Financial acceptance does not mock away the boundary being tested.

## Local development and CI/CD

- Containerized PostgreSQL, Redis and MinIO for local integration.
- Application processes run directly for fast development or in containers for parity.
- GitHub Actions is the baseline CI/CD system once the folder is initialized as a repository.
- CI runs formatting, lint, typecheck, unit, contract and deterministic epoch tests on pull requests.
- Protected workflows run fork/E2E/security checks and build immutable container images.
- Deployments promote the same image/artifact digest across environments.
- Infrastructure remains provider-agnostic at the application layer. Hosting/cloud vendor selection is deliberately deferred until traffic, region, compliance and operations requirements are known.

## Observability

- One trace/correlation ID follows API request, queued job, quote attempt, transaction and reconciliation where technically safe.
- Logs are structured and redact secrets, signed payloads and unnecessary wallet-correlated metadata.
- Prometheus metrics cover indexer lag, queue depth, quote results, conversion/claim reconciliation and dependency health.
- Grafana provides operational dashboards and alert links.
- Sentry captures application exceptions with privacy filtering and release identifiers.
- Onchain transaction hashes, blocks and deployed versions remain primary incident evidence.

## Stack requirements

| ID | Requirement | Priority | Verification |
|---|---|---:|---|
| STACK-001 | The repository MUST use a pnpm workspace and Turborepo with the documented app/package boundaries | MUST | Clean bootstrap and dependency-boundary test |
| STACK-002 | All browser and Node application code MUST use strict TypeScript with shared lint/format configuration | MUST | CI type/lint checks |
| STACK-003 | The web application MUST use Next.js 15 App Router and React 19 with explicit server/client boundaries | MUST | Architecture and bundle review |
| STACK-004 | UI MUST use Tailwind CSS v4, Radix primitives and repository-owned shadcn-derived components consuming semantic tokens | MUST | CSS/component audit |
| STACK-005 | First-party EVM integration MUST use viem and wagmi with injected wallets and WalletConnect | MUST | Dependency and wallet E2E review |
| STACK-006 | Remote/RPC state MUST use TanStack Query; tables MUST use TanStack Table | MUST | Frontend architecture review |
| STACK-007 | Forms and runtime validation MUST use React Hook Form and shared Zod schemas | MUST | Invalid-input and schema-contract tests |
| STACK-008 | Price time-series MUST use Lightweight Charts and basket/reward charts MAY use Recharts only with accessible alternatives | MUST | Visual/accessibility review |
| STACK-009 | The API MUST use Fastify and MUST NOT host long-running indexer, keeper or epoch loops in request handlers | MUST | Process-boundary review |
| STACK-010 | PostgreSQL with Drizzle and committed SQL migrations MUST store canonical and derived persistent application data | MUST | Migration/rebuild test |
| STACK-011 | Redis and BullMQ MUST be limited to retryable job/coordination state and MUST NOT be the financial source of truth | MUST | Failure/rebuild test |
| STACK-012 | Immutable epoch artifacts MUST use content-addressed S3-compatible storage with MinIO local parity | MUST | Hash/restore test |
| STACK-013 | Smart contracts MUST use Solidity, Foundry and a pinned OpenZeppelin release | MUST | Clean contract build and provenance audit |
| STACK-014 | Contract verification MUST include Forge unit, fuzz, invariant and fork suites | MUST | CI test inventory |
| STACK-015 | TypeScript tests MUST use Vitest/Testing Library and browser E2E MUST use Playwright | MUST | CI test inventory |
| STACK-016 | Observability MUST use OpenTelemetry, Sentry privacy filtering, Prometheus-compatible metrics and Grafana dashboards | MUST | Telemetry/alert test |
| STACK-017 | Provider, signing and quote secrets MUST be injected through managed secret storage and scoped per service | MUST | Deployment/bundle/log scan |
| STACK-018 | One lockfile, pinned toolchain and frozen CI installs MUST make builds reproducible | MUST | Clean/frozen install test |
| STACK-019 | Deployments MUST build immutable containers/artifacts and promote the same digest across environments | MUST | Release provenance test |
| STACK-020 | Cloud/hosting-specific services MUST remain behind standard PostgreSQL, Redis, S3, OpenTelemetry and container interfaces until a provider ADR is approved | SHOULD | Portability review |

## Explicitly deferred choices

- Cloud/hosting vendor and regions.
- Managed versus self-hosted PostgreSQL, Redis, object storage, Grafana and OpenTelemetry collector.
- Container scheduler/serverless platform.
- CDN and edge provider.
- Transactional email/notification provider.
- Final wallet-modal presentation package, provided it uses the settled wagmi/WalletConnect/injected connector layer.

These choices require an architecture decision record before production procurement but do not block repository scaffolding or R0 development.


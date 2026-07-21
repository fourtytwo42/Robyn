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
  pm2/              Persistent Node process declarations
  systemd/           Native service unit templates and overrides
  deployments/      Environment manifests and release records
  monitoring/       Dashboards and alert rules
  runbooks/         Operational procedures
```

Applications may deploy separately. Shared packages cannot import an application. `epoch-core` cannot depend on network, database, clock or framework state.

## Runtime and package policy

- The Ubuntu VM `robyn` at `192.168.50.250` is the only development, build, test, service and deployment host.
- The authoritative checkout is `/home/hendo420/Robyn`; the workstation is an SSH/control client only.
- Docker, Compose, Kubernetes, container images and container registries are prohibited.
- Node applications run as separate PM2 processes with a committed ecosystem file, `systemd` startup integration and saved PM2 state.
- PostgreSQL, Redis, MinIO, monitoring, reverse proxy and any self-hosted RPC node run as native VM services managed by `systemd`.
- GitHub Actions, when enabled, uses a dedicated self-hosted runner on this VM.
- Versioned build artifacts and atomic release directories replace container-image promotion.
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
| Object/artifact storage | Native MinIO on the project VM through its S3-compatible API |
| Chain access | `viem` public/wallet clients |
| Structured logs | OpenTelemetry-compatible JSON logging |
| Tracing/metrics | OpenTelemetry |
| Application error reporting | Structured local error events; optional external Sentry sink |
| Operational metrics | Prometheus-compatible metrics and Grafana dashboards |

Fastify owns HTTP/API concerns only. Indexing, keeper and epoch calculation run as separate processes. BullMQ schedules/retries jobs but is not the financial source of truth. PostgreSQL checkpoints and onchain state establish idempotency.

## Smart contracts
For R0 development, Foundry's native Anvil node provides the controlled EVM network on chain ID `31337`. The persistent shared devnet is separate from ephemeral Anvil instances used by automated tests. Hardhat Network is not part of the selected stack.

All user-facing acceptance runs through the Codex in-app browser against the VM-served application. Playwright automation, stable semantic locators, DOM assertions, screenshots, console/network checks and responsive viewports provide release evidence; browser UAT does not replace Forge, Vitest or native service integration testing.


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
- VM secrets use root-controlled per-service files or systemd credentials with least-privilege ownership and are injected only into the process that needs them.
- Service data and secrets live outside the Git checkout; PM2 ecosystem files contain no secret values.

## Testing pyramid

1. Pure domain tests for epoch/accounting serialization and schema behavior.
2. Contract unit/fuzz/invariant tests in Foundry.
3. TypeScript unit/component tests with Vitest and Testing Library.
4. PostgreSQL/Redis/MinIO integration tests using isolated databases, schemas, buckets and namespaces on the VM-native services.
5. Mainnet/testnet fork tests for upstream factories, quotes, tokens and feeds.
6. Playwright end-to-end tests for anonymous, wallet, create, trade and claim states.
7. Security, accessibility, visual-regression, load, backup/restore and incident drills at release gates.

Tests use deterministic fixtures and pinned block numbers. Financial acceptance does not mock away the boundary being tested.

## VM-native development and CI/CD

- All installs, builds, tests, migrations and service commands run in `/home/hendo420/Robyn` on the project VM.
- Native PostgreSQL, Redis and MinIO provide integration dependencies; tests isolate their database/schema/bucket/key namespaces and clean only their assigned fixtures.
- PM2 runs the web, API, indexer, keeper and epoch builder as separately named processes. `pm2 startup systemd` plus `pm2 save` must be configured and reboot-tested when these processes exist.
- Native infrastructure services use reviewed `systemd` units with enablement and restart-policy verification.
- GitHub Actions uses only a labeled self-hosted runner installed on this VM; untrusted fork workflows are prohibited.
- CI runs formatting, lint, typecheck, unit, contract and deterministic epoch tests on pull requests from the self-hosted runner.
- Protected workflows run fork/E2E/security checks and produce versioned build artifacts plus a release manifest.
- Deployments store releases under `/opt/robyn/releases/<release-id>`, atomically update `/opt/robyn/current`, run gated migrations and reload PM2.
- Rollback selects the previous compatible release directory; contract deployments and incompatible migrations require forward remediation.
- Capacity checks prevent builds, forks or CI jobs from starving the database and live processes on the shared VM.

## Observability

- One trace/correlation ID follows API request, queued job, quote attempt, transaction and reconciliation where technically safe.
- Logs are structured and redact secrets, signed payloads and unnecessary wallet-correlated metadata.
- Prometheus metrics cover indexer lag, queue depth, quote results, conversion/claim reconciliation and dependency health.
- Grafana provides operational dashboards and alert links.
- Structured local error events carry privacy-filtered release identifiers; an external Sentry sink is optional and never required for correctness.
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
| STACK-010 | Native PostgreSQL on the project VM with Drizzle and committed SQL migrations MUST store canonical and derived persistent application data | MUST | Migration/rebuild/service test |
| STACK-011 | Native Redis on the project VM and BullMQ MUST be limited to retryable job/coordination state and MUST NOT be the financial source of truth | MUST | Failure/rebuild/service test |
| STACK-012 | Immutable epoch artifacts MUST use content-addressed storage through native MinIO on the project VM | MUST | Hash/restore/service test |
| STACK-013 | Smart contracts MUST use Solidity, Foundry and a pinned OpenZeppelin release | MUST | Clean contract build and provenance audit |
| STACK-014 | Contract verification MUST include Forge unit, fuzz, invariant and fork suites | MUST | CI test inventory |
| STACK-015 | TypeScript tests MUST use Vitest/Testing Library and browser E2E MUST use Playwright | MUST | CI test inventory |
| STACK-016 | Observability MUST use OpenTelemetry, structured local error reporting, Prometheus-compatible metrics and VM-native Grafana dashboards; an external Sentry sink is optional | MUST | Telemetry/alert test |
| STACK-017 | Provider, signing and quote secrets MUST use root-controlled VM secret storage or systemd credentials and remain scoped per service | MUST | Deployment/bundle/log scan |
| STACK-018 | One lockfile, pinned toolchain and frozen CI installs MUST make builds reproducible | MUST | Clean/frozen install test |
| STACK-019 | Deployments MUST build versioned immutable artifacts on the VM, record hashes/source/test evidence and atomically promote release directories without containers | MUST | Release provenance and rollback test |
| STACK-020 | All project builds, tests, services, data stores, deployments and Git operations MUST run on the `robyn` VM; the workstation MUST remain control-only | MUST | Environment and process audit |
| STACK-025 | R0 development MUST use native Anvil chain ID 31337 on the VM with a loopback privileged endpoint, restricted user gateway, controlled faucet and separate ephemeral chains for automated tests; Hardhat Network MUST NOT be introduced without an ADR | MUST | Service/RPC/isolation test and dependency scan |
| STACK-026 | Every user-facing story MUST pass Codex in-app-browser acceptance against the VM-served application at required viewports with durable DOM, screenshot and console/network evidence, in addition to its lower-level tests | MUST | Browser release-evidence audit |
| STACK-027 | Every major validated change MUST be committed and pushed from the authoritative VM; incomplete or risky changes MUST use feature branches and main MUST remain deployable | MUST | Git/release checkpoint audit |
| STACK-021 | Docker, Compose, Kubernetes, container images and container registries MUST NOT be used by the project | MUST | Dependency/config/process scan |
| STACK-022 | Node application processes MUST use a committed PM2 ecosystem, systemd startup integration, saved process state and reboot verification | MUST | Reboot/persistence test |
| STACK-023 | PostgreSQL, Redis, MinIO, monitoring, reverse proxy and any project-operated RPC node MUST run natively on the VM under systemd | MUST | Service/unit/network audit |
| STACK-024 | GitHub Actions MUST use a dedicated self-hosted runner on the VM and MUST NOT execute untrusted fork code on the shared host | MUST | Workflow/runner security audit |

## Explicitly deferred choices

- CDN and edge provider.
- Transactional email/notification provider.
- Native reverse proxy choice between Caddy and Nginx.
- Off-VM encrypted backup destination.
- Supported Robinhood Chain node distribution and capacity plan, if a self-hosted RPC node becomes necessary.
- Final wallet-modal presentation package, provided it uses the settled wagmi/WalletConnect/injected connector layer.

The runtime host and native service model are not deferred: the project VM is authoritative and containers are prohibited. The remaining choices require an architecture decision record before production procurement but do not block repository scaffolding or R0 development.


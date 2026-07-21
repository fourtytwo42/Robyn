# Technology stack and developer-platform stories

## Epic Z: Repository and frontend foundation

### US-STACK-001: Bootstrap the monorepo reproducibly

- Release: R0
- Priority: Must
- Persona: Developer
- PRD: STACK-001, STACK-002, STACK-018
- Depends on: Repository initialization

As a developer, I want one pnpm/Turborepo workspace with strict TypeScript and frozen installs so that every service and package builds from the same reproducible dependency graph.

Acceptance criteria:

1. Documented apps/packages exist with enforced dependency direction.
2. One committed lockfile and pinned toolchain support a clean frozen install.
3. Root format, lint, typecheck, test and build tasks run dependency-aware in CI.

### US-STACK-002: Build the web application on settled boundaries

- Release: R0-R1
- Priority: Must
- Persona: Frontend engineer
- PRD: STACK-003
- Depends on: US-STACK-001

As a frontend engineer, I want Next.js 15 App Router and React 19 with explicit server/client boundaries so that public content is cacheable without leaking protected wallet/quote state.

Acceptance criteria:

1. Public pages prefer server components and declared cache/freshness policy.
2. Wallet, live RPC, quotes and transactions reside in explicit client boundaries.
3. Server-rendered payload inspection contains no provider key or protected quote response.

### US-STACK-003: Implement the owned design system

- Release: R0-R1
- Priority: Must
- Persona: Frontend engineer, Product designer
- PRD: STACK-004, DESIGN-001, DESIGN-017
- Depends on: US-STACK-001

As a product team, we want Tailwind v4 plus repository-owned Radix/shadcn-derived components so that accessibility and semantic tokens remain under our control.

Acceptance criteria:

1. Components live in `packages/design-system` and consume PRD 09 tokens.
2. Copied component source is reviewed, versioned and testable without an external runtime theme service.
3. Arbitrary one-off status styles fail design/static review.

### US-STACK-004: Connect typed EVM wallets

- Release: R0-R1
- Priority: Must
- Persona: Wallet user, Frontend engineer
- PRD: STACK-005
- Depends on: Chain configuration package

As a wallet user, I want typed viem/wagmi support for injected wallets and WalletConnect so that I can use standard EVM wallets without unsafe duplicated chain logic.

Acceptance criteria:

1. First-party contract reads/writes are generated or typed through viem.
2. Injected and WalletConnect paths pass connect, account change, chain switch and disconnect E2E tests.
3. ethers.js is absent from first-party integration or isolated/documented when forced by an upstream SDK.

### US-STACK-005: Standardize frontend state and tables

- Release: R1
- Priority: Must
- Persona: Frontend engineer
- PRD: STACK-006
- Depends on: US-STACK-002

As a frontend engineer, I want TanStack Query and TanStack Table used consistently so that RPC/API cache behavior and discovery tables are predictable.

Acceptance criteria:

1. Remote/RPC state has explicit keys, freshness, invalidation and error behavior.
2. Financial state is not duplicated into an untracked global cache.
3. Table sorting/filtering/pagination remains accessible and URL-compatible where specified.

### US-STACK-006: Share validation between forms and APIs

- Release: R0-R1
- Priority: Must
- Persona: Frontend/API engineer
- PRD: STACK-007
- Depends on: Shared schemas package

As an engineer, I want Zod schemas shared with React Hook Form and API boundaries so that invalid launch, quote and artifact data fails consistently.

Acceptance criteria:

1. Versioned schemas live in `packages/schemas` without browser-incompatible dependencies.
2. Client and server reject the same invalid fixtures with field-safe errors.
3. Financial integer/base-unit data is not coerced through JavaScript floating point.

### US-STACK-007: Use fit-for-purpose accessible charts

- Release: R1
- Priority: Must
- Persona: Trader, Holder
- PRD: STACK-008, DESIGN-011
- Depends on: Market and reward data models

As a user, I want Lightweight Charts for price series and Recharts for simple basket/reward views so that each visualization is capable and accessible.

Acceptance criteria:

1. Time-series uses Lightweight Charts; simple categorical/allocation visualization may use Recharts.
2. Every chart has source/freshness and accessible text/table alternative.
3. Chart libraries cannot become the canonical source of calculated values.

## Epic AA: API, data and workers

### US-STACK-008: Isolate Fastify request serving

- Release: R0-R1
- Priority: Must
- Persona: Backend engineer
- PRD: STACK-009
- Depends on: Monorepo process boundaries

As a backend engineer, I want Fastify request handlers separated from long-running workers so that HTTP lifecycle cannot corrupt indexing, epochs or keeper execution.

Acceptance criteria:

1. API, indexer, keeper and epoch builder have separate entry points/processes.
2. HTTP handlers enqueue or query bounded work and do not run continuous loops.
3. One process may fail/restart without silently stopping another responsibility.

### US-STACK-009: Persist with PostgreSQL and Drizzle

- Release: R0-R1
- Priority: Must
- Persona: Data engineer
- PRD: STACK-010
- Depends on: Containerized PostgreSQL

As a data engineer, I want PostgreSQL with Drizzle and committed SQL migrations so that canonical/derived state is typed, reviewable and recoverable.

Acceptance criteria:

1. Schema/migrations cover raw events, checkpoints, derived reads, jobs and artifact metadata.
2. Migrations are reviewable SQL and pass forward/restore rehearsal.
3. Empty rebuild and migrated rebuild produce equivalent derived state.

### US-STACK-010: Queue retryable work without trusting Redis

- Release: R1
- Priority: Must
- Persona: Operator
- PRD: STACK-011, INFRA-004
- Depends on: Redis/BullMQ local and production interfaces

As an operator, I want BullMQ retries coordinated through Redis while financial idempotency remains in PostgreSQL/onchain state so that queue loss cannot alter entitlement.

Acceptance criteria:

1. Redis deletion/restart permits safe job reconstruction from durable checkpoints.
2. Idempotency key prevents duplicate financial submission.
3. Bounded retry and dead-letter evidence remains observable.

### US-STACK-011: Store immutable epoch artifacts portably

- Release: R1
- Priority: Must
- Persona: Verifier, Platform engineer
- PRD: STACK-012
- Depends on: S3-compatible storage and MinIO local environment

As a verifier, I want content-addressed epoch artifacts in a standard object interface so that proofs survive application/database replacement.

Acceptance criteria:

1. Local MinIO and production S3-compatible storage pass identical hash/read/write tests.
2. Object key/content verification rejects mutation.
3. Backup/restore preserves hashes and public retrieval policy.

## Epic AB: Contracts, tests and delivery

### US-STACK-012: Build contracts with pinned Foundry dependencies

- Release: R0
- Priority: Must
- Persona: Protocol engineer, Security reviewer
- PRD: STACK-013, STACK-014
- Depends on: `packages/contracts`

As a protocol engineer, I want Solidity/Foundry and pinned OpenZeppelin contracts so that builds and security tests correspond to known source.

Acceptance criteria:

1. Clean Foundry build uses pinned compiler/dependency provenance.
2. Unit, fuzz, stateful invariant and pinned-fork suites run in CI.
3. Deterministic build exports reviewed ABIs/artifacts to `chain-config` without hand editing.

### US-STACK-013: Test TypeScript and browser behavior

- Release: R0-R1
- Priority: Must
- Persona: Quality engineer
- PRD: STACK-015
- Depends on: Frontend and service test harnesses

As a quality engineer, I want Vitest/Testing Library and Playwright assigned to appropriate layers so that unit behavior and real user journeys both fail reliably.

Acceptance criteria:

1. Pure/service/component tests run under Vitest and Testing Library where UI behavior applies.
2. Playwright covers anonymous, wallet, create, trade, reward and claim states at required viewports.
3. Deterministic fixtures and wallet/test-chain setup make failures reproducible.

### US-STACK-014: Correlate errors, traces and protocol health

- Release: R1
- Priority: Must
- Persona: Operator
- PRD: STACK-016
- Depends on: Shared observability package

As an operator, I want OpenTelemetry, Sentry, Prometheus metrics and Grafana dashboards so that failures can be traced without logs becoming financial truth.

Acceptance criteria:

1. Safe correlation connects request, job, quote, transaction and reconciliation.
2. Sentry filters secrets/sensitive payloads and tags release version.
3. Prometheus/Grafana expose service and protocol health with runbook-linked alerts.

### US-STACK-015: Scope and inject service secrets

- Release: R1
- Priority: Must
- Persona: Security/Platform engineer
- PRD: STACK-017
- Depends on: Managed secret-store integration

As a security engineer, I want each service to receive only its required secrets so that compromise blast radius is bounded.

Acceptance criteria:

1. Web bundle and unrelated services cannot access provider, quote or signing credentials.
2. CI/deployment injects secrets at runtime and scans images/logs/artifacts.
3. Rotation can occur independently per credential/service.

### US-STACK-016: Promote immutable portable releases

- Release: R0-R1
- Priority: Must
- Persona: Release engineer
- PRD: STACK-019, STACK-020
- Depends on: GitHub Actions and container registry after repo initialization

As a release engineer, I want immutable image/artifact promotion behind standard service interfaces so that environments run reviewed bytes without premature cloud lock-in.

Acceptance criteria:

1. GitHub Actions builds once and records digest, source commit, lockfile and test evidence.
2. The same digest is promoted across environments with environment-specific secrets/configuration.
3. PostgreSQL, Redis, S3, OpenTelemetry and container interfaces do not depend on an unapproved cloud-only API.


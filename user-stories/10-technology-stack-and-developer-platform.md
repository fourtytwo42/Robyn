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
3. Root format, lint, typecheck, test and build tasks run dependency-aware on the VM and its self-hosted CI runner.

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
- Depends on: Native PostgreSQL service on the project VM

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
- Depends on: Native Redis service on the project VM

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
- Depends on: Native MinIO service on the project VM

As a verifier, I want content-addressed epoch artifacts in a standard object interface so that proofs survive application/database replacement.

Acceptance criteria:

1. VM-native MinIO passes hash/read/write, permission and restart tests through the standard S3-compatible interface.
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

As an operator, I want OpenTelemetry, structured local errors, Prometheus metrics and VM-native Grafana dashboards so that failures can be traced without logs becoming financial truth.

Acceptance criteria:

1. Safe correlation connects request, job, quote, transaction and reconciliation.
2. Local error events filter secrets/sensitive payloads and tag the release; any external Sentry sink follows the same policy.
3. Prometheus/Grafana expose service and protocol health with runbook-linked alerts.

### US-STACK-015: Scope and inject service secrets

- Release: R1
- Priority: Must
- Persona: Security/Platform engineer
- PRD: STACK-017
- Depends on: Root-controlled per-service VM secret storage

As a security engineer, I want each service to receive only its required secrets so that compromise blast radius is bounded.

Acceptance criteria:

1. Web bundle and unrelated services cannot access provider, quote or signing credentials.
2. VM-native CI/deployment injects secrets at runtime and scans bundles, logs and build artifacts.
3. Rotation can occur independently per credential/service.

### US-STACK-016: Operate and deploy the VM-native stack

- Release: R0-R1
- Priority: Must
- Persona: Release engineer, Platform engineer
- PRD: STACK-019, STACK-020, STACK-021, STACK-022, STACK-023, STACK-024, INFRA-011, INFRA-012, INFRA-013, INFRA-014
- Depends on: Authoritative VM checkout, native system services and self-hosted runner

As a platform owner, I want all project workloads to build and run natively on the authoritative VM with persistent supervision so that the workstation and containers never become hidden dependencies.

Acceptance criteria:

1. Builds, tests, Git operations and deployments execute only on `/home/hendo420/Robyn` or its versioned release paths on the VM.
2. Repository, dependency and process scans find no Docker, Compose, Kubernetes, container image or container-registry dependency.
3. PM2 uses a committed ecosystem file, systemd startup and saved state; a reboot restores every declared Node process.
4. PostgreSQL, Redis, MinIO, monitoring, reverse proxy and any self-hosted RPC node run as enabled native systemd services.
5. The dedicated self-hosted GitHub Actions runner executes trusted workflows without unrestricted sudo or untrusted fork code.
6. Release manifest records source, lockfile, artifact hashes, tests and migrations; atomic release selection and rollback are rehearsed.

### US-STACK-017: Operate a safe controlled Anvil devnet

- Release: R0
- Priority: Must
- Persona: Protocol engineer, Platform engineer
- PRD: STACK-025, INFRA-015
- Depends on: Authoritative VM and Foundry toolchain

As a protocol engineer, I want a persistent controlled Anvil network with easy user funding and isolated automated-test chains so that development is deterministic without relying on an external faucet.

Acceptance criteria:

1. Native Anvil runs on chain ID 31337 under systemd, persists reviewed state outside Git and restores after reboot.
2. Raw privileged RPC is loopback-only; the LAN gateway rejects privileged, impersonation, unsafe debug and destructive methods while permitting required standard EVM calls.
3. A rate-limited faucet funds arbitrary development addresses without exposing a reusable private key.
4. Automated suites create isolated ephemeral Anvil processes and cannot reset or contaminate the shared devnet.
5. Devnet-only wallet code, faucet routes, fixture keys and chain configuration are absent from testnet/production bundles.

### US-STACK-018: Accept every user flow in the in-app browser

- Release: R0-R2
- Priority: Must
- Persona: Quality engineer, Product owner
- PRD: STACK-026
- Depends on: VM-served release and deterministic fixtures

As a product owner, I want every user-facing story verified through the Codex in-app browser so that release acceptance reflects the complete experience users receive.

Acceptance criteria:

1. Required anonymous, wallet, create, trade, reward, claim and recovery journeys run against the VM-served application through the in-app browser.
2. Desktop, tablet and mobile runs use stable semantic locators and assert visible state plus resulting chain/API state.
3. Evidence retains screenshots, DOM assertions, console failures and relevant network/transaction identifiers by release and commit.
4. Browser acceptance supplements Foundry, Vitest, integration, migration, security and operational tests and cannot waive a failure below the UI.

### US-STACK-019: Preserve validated GitHub checkpoints

- Release: R0-R2
- Priority: Must
- Persona: Release engineer
- PRD: STACK-027
- Depends on: Validated milestone evidence

As a release engineer, I want each major validated change pushed from the authoritative VM so that GitHub always contains the latest recoverable checkpoint.

Acceptance criteria:

1. A major change is committed and pushed only after its declared validation passes.
2. Incomplete or risky work remains on a named feature branch; main remains deployable.
3. Commit/release evidence records tests, browser acceptance when user-facing, migrations and deployment state.
4. The remote branch SHA is verified after push before the milestone is considered complete.


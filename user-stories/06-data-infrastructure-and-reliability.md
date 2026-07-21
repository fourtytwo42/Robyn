# Data, infrastructure and reliability stories

## Epic O: Canonical event data

### US-DATA-001: Store replayable raw events

- Release: R0
- Priority: Must
- Persona: Data engineer, Verifier
- PRD: DATA-001, PROTO-009
- Depends on: Archive RPC

As a verifier, I want raw events stored with canonical ordering fields so that every derived balance can be replayed.

Acceptance criteria:

1. Records include chain, block number/hash, transaction hash/index, log index, address, topics and data.
2. Duplicate ingestion is idempotent.
3. Reorganization replaces orphaned data only after canonical comparison and replay.

### US-DATA-002: Rebuild all derived state

- Release: R0
- Priority: Must
- Persona: Data engineer
- PRD: DATA-002, DATA-006
- Depends on: US-DATA-001

As a data engineer, I want deterministic restart and full rebuild so that database state is never an unrecoverable source of truth.

Acceptance criteria:

1. Empty-database and checkpoint rebuilds produce identical balances/activity.
2. Kill/restart resumes without gaps or duplicate effects.
3. Derivation code/configuration versions are recorded.

### US-DATA-003: Publish fresh API state

- Release: R1
- Priority: Must
- Persona: Frontend user, Verifier
- PRD: DATA-003, CORE-005
- Depends on: Indexed state

As an API consumer, I want chain-derived responses labeled with block freshness so that I can decide whether they are safe to display or act upon.

Acceptance criteria:

1. Responses include chain and `asOfBlock`/hash where material.
2. API exposes indexer lag/degraded status.
3. Current transaction preflight does not rely solely on the API cache.

### US-DATA-004: Preserve immutable epoch artifacts

- Release: R1
- Priority: Must
- Persona: Verifier
- PRD: DATA-004, REWARD-004
- Depends on: Epoch builder

As a verifier, I want inputs, leaves, proofs and manifests content-addressed so that finalized claim evidence cannot be edited.

Acceptance criteria:

1. All artifacts have deterministic serialization and hashes.
2. Retrieval by historical content hash remains possible after later epochs.
3. Storage loss can be restored from backups/public replicas without changing hashes.

### US-DATA-005: Claim without API availability

- Release: R1
- Priority: Must
- Persona: Holder, Verifier
- PRD: DATA-005, CORE-009
- Depends on: Public artifact access

As a holder with a proof, I want to claim directly when Robyn's API is down so that the service cannot censor a valid claim.

Acceptance criteria:

1. Direct contract input contains all required proof/claim data.
2. No authenticated API token or backend signature is needed.
3. An offline example reproduces the same claim calldata.

### US-DATA-006: Compare independent epoch builds

- Release: R1
- Priority: Must
- Persona: Root guardian
- PRD: DATA-007
- Depends on: US-DATA-002, US-DATA-004

As a root guardian, I want two independent builds compared so that nondeterminism blocks publication.

Acceptance criteria:

1. Identical inputs yield byte-identical ordered leaves, totals and root.
2. Difference stops proposal and produces diagnosable artifacts.
3. Comparison does not accept matching roots built from mismatched block hashes.

### US-DATA-007: Migrate without losing reproducibility

- Release: R1
- Priority: Must
- Persona: Data engineer
- PRD: DATA-008
- Depends on: Versioned schemas/formulas

As a data engineer, I want historical schema/formula versions retained so that old epochs remain reproducible after migrations.

Acceptance criteria:

1. Migration rehearsal preserves raw events and artifact hashes.
2. Historical builder/version can be run or deterministically emulated.
3. Rollback and validation evidence is recorded before production migration.

### US-DATA-008: Preserve metric lineage and privacy

- Release: R1
- Priority: Must
- Persona: Product/data owner
- PRD: DATA-009, DATA-010
- Depends on: Metrics schema

As a data owner, I want formulas/source fields retained while minimizing personal data so that rankings are auditable without turning wallets into claimed identities.

Acceptance criteria:

1. Derived metrics record formula version and source columns.
2. Wallet addresses remain pseudonymous public identifiers.
3. No unnecessary personal enrichment is stored.

## Epic P: RPC, keeper and deployments

### US-INFRA-001: Keep secrets server-side

- Release: R1
- Priority: Must
- Persona: Platform engineer
- PRD: INFRA-001, INFRA-007
- Depends on: Managed secret store

As a platform engineer, I want provider/quote/signing secrets isolated and redacted so that browser bundles and logs cannot expose them.

Acceptance criteria:

1. Build scan finds no secrets in client artifacts or repository.
2. Logs redact credentials and minimize wallet-correlated metadata.
3. Rotation does not require a frontend redeploy.

### US-INFRA-002: Use resilient RPC paths cheaply

- Release: R1
- Priority: Must
- Persona: Platform engineer, User
- PRD: INFRA-002, INFRA-003
- Depends on: Public plus protected providers

As a platform owner, I want browser-direct routine reads and two independent critical RPC paths so that costs stay low without sacrificing correctness.

Acceptance criteria:

1. Routine wallet reads use public/wallet/user-supplied RPC by default.
2. Indexing, roots and keeper checks compare independent providers.
3. Shared-NAT throttling degrades visibly and allows alternate RPC.

### US-INFRA-003: Run idempotent critical jobs

- Release: R1
- Priority: Must
- Persona: Operator
- PRD: INFRA-004
- Depends on: Durable queue/checkpoints

As an operator, I want idempotency, bounded retries and dead-letter visibility so that transient failure cannot duplicate financial actions.

Acceptance criteria:

1. Same job key cannot submit unintended duplicate work.
2. Retries are bounded with backoff and terminal alert.
3. Dead-letter record includes scope, state and safe replay procedure.

### US-INFRA-004: Reproduce deployments

- Release: R0
- Priority: Must
- Persona: Release engineer, Verifier
- PRD: INFRA-005, INFRA-006
- Depends on: Pinned toolchain

As a verifier, I want clean reproducible deployments and manifests so that live bytecode, roles and proxies match reviewed source.

Acceptance criteria:

1. Clean build uses pinned dependencies and configuration.
2. Manifest records addresses, bytecode hashes, implementation/admin, roles and transactions per environment.
3. Mismatch blocks release.

### US-INFRA-005: Restore canonical data

- Release: R1
- Priority: Must
- Persona: Operator
- PRD: INFRA-008
- Depends on: Backup policy

As an operator, I want rehearsed backups/restores so that raw logs, manifests and configuration survive infrastructure loss.

Acceptance criteria:

1. Backup includes raw events, database, content-addressed artifacts and versioned configuration.
2. Restore meets the beta recovery target and passes deterministic comparison.
3. Secrets/private keys are handled through their own recovery process, not copied into data backups.

### US-INFRA-006: Observe component health separately

- Release: R1
- Priority: Must
- Persona: Operator, User
- PRD: INFRA-009
- Depends on: Metrics/alerts

As an operator, I want separate health for web, API, indexer, epoch builder, keeper, RPC and quote routes so that failures are scoped accurately.

Acceptance criteria:

1. Dashboard reports freshness, last success/error and dependency state per component.
2. User status surfaces only affected capabilities.
3. Alerts link the appropriate runbook.

### US-INFRA-007: Stage and roll back releases

- Release: R1
- Priority: Must
- Persona: Release engineer
- PRD: INFRA-010
- Depends on: Deployment pipeline

As a release engineer, I want staged deployment with rollback evidence so that a bad application/service release has bounded impact.

Acceptance criteria:

1. Changes progress through declared environments and automated gates.
2. Rollback is rehearsed for compatible code/configuration changes.
3. Irreversible contract deployments use version migration, not a fictitious rollback.

### US-INFRA-008: Operate a constrained keeper

- Release: R1
- Priority: Must
- Persona: Keeper operator
- PRD: PROTO-007, EXEC-007, INFRA-004
- Depends on: Execution policy and server quote access

As a keeper operator, I want simulate-before-submit automation with no withdrawal authority so that liveness does not create custody risk.

Acceptance criteria:

1. Keeper acts only on eligible pending legs and reviewed calldata.
2. Exact call simulates before submission and receipt is reconciled afterward.
3. Compromised keeper key cannot redirect output or edit basket/root policy.


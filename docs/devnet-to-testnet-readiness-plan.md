# Devnet to testnet-readiness plan

Status: Native controlled-devnet implementation complete; exact candidate `d90e218` is in its mandatory final soak
Owner: Product and engineering TBD
Date: 2026-07-20

## Objective

Build Robyn into a production-shaped, security-reviewed, observable application that any network user who can reach the service can operate end to end on a Robyn-controlled local EVM network. The final deliverable in this plan is a stable devnet release candidate with a tested Robinhood Chain Testnet deployment package. Actual testnet deployment remains a separate authorized action because it requires testnet ETH and current external addresses.

This milestone does not claim Robinhood mainnet readiness. Real Bags/pons fee-recipient behavior, authenticated quote execution, Stock Token restrictions, upstream terms, mainnet economics and an independent contract audit remain later gates.

## Binding implementation decisions

1. All project work runs on `/home/hendo420/Robyn` on VM `robyn` at `192.168.50.250`.
2. Docker and containers remain prohibited.
3. Use native Anvil from the pinned Foundry toolchain instead of Hardhat Network. Do not add Hardhat unless a future dependency proves Anvil cannot satisfy a documented requirement.
4. The shared Robyn Devnet uses chain ID `31337` and is operated on the VM through systemd.
5. Raw Anvil RPC binds to loopback. LAN users reach a restricted RPC gateway that blocks `anvil_*`, impersonation, debug and other privileged methods.
6. A devnet-only faucet funds arbitrary user wallets, eliminating external faucet and test-ETH dependency.
7. Every user-facing story requires successful testing through the Codex in-app browser against the VM-hosted application. CLI/unit/invariant tests remain mandatory and run on the VM; browser UAT does not replace financial correctness tests.
8. Each major change is committed and pushed to GitHub from the VM after its checks pass. No major completed slice remains only on disk.
9. The devnet-only wallet/faucet/test controls must be impossible to include in the Robinhood testnet build.
10. The controlled-devnet candidate selects settled decision `D-010`: native launches use transfer-integrated cumulative multi-asset accounting. Adapter-only Merkle epoch requirements remain conditional and are not components of this native candidate.
11. Implementation is authorized and complete through the protected testnet rehearsal. Actual public-testnet broadcast remains a separate explicitly authorized action.

## What production-ready means for this milestone

The product is production-shaped on the controlled devnet when:

- any user who can reach the VM application can create or connect a devnet wallet, obtain dev ETH, launch a token, trade it, generate fees, observe basket conversions, accrue rewards and claim them;
- the complete web, API, indexer, keeper, native onchain accumulator, PostgreSQL, Redis, MinIO, monitoring and chain stack runs natively and persistently on the VM; an epoch builder is required only for a later adapter-mode release;
- contracts and offchain accounting reconcile under unit, fuzz, invariant, integration, restart, replay and failure tests;
- every required user journey passes in the in-app browser at desktop, tablet and mobile viewport sizes with no unexplained console errors;
- services recover after controlled process restarts and a VM reboot;
- release artifacts, deployment manifests, database migrations, contract addresses and browser evidence are reproducible from a pinned commit;
- devnet-only controls are isolated and a testnet build fails closed if any faucet, privileged RPC method, deterministic development key or dev connector is bundled; and
- the testnet deployment rehearsal completes against a clean Anvil instance configured with testnet-like chain parameters.

## Controlled network design

### Shared persistent Robyn Devnet

| Setting | Planned value |
|---|---|
| Engine | Anvil from the pinned Foundry release |
| Chain ID | `31337` |
| Raw RPC | `127.0.0.1:8545`, VM-local only |
| User RPC gateway | LAN-reachable restricted VM endpoint `192.168.50.250:8546`; raw privileged Anvil remains loopback-only |
| State | `/var/lib/robyn/anvil/state.json` with controlled dump/load |
| Service | `robyn-anvil.service` under systemd |
| Mining | Deterministic interval or automine selected and pinned in configuration |
| Accounts | No shared real-world secrets; known Anvil fixtures are devnet-only |
| Native funding | Restricted faucet backed by privileged loopback RPC |
| Reset | Explicit operator command with pre-reset backup and visible network generation ID |

The public gateway allows only the standard methods needed by wallets and the application. It rejects privileged Anvil controls, arbitrary account impersonation and destructive state manipulation. Operator scripts and the faucet access privileged methods only through loopback.

### Ephemeral test chains

Contract, integration and CI suites launch separate Anvil processes on isolated ports with deterministic genesis configuration. Each test owns its process and state directory. The persistent shared devnet is never reset by an automated test suite.

### Devnet wallet experience

The application supports normal injected and WalletConnect paths. It also provides an obvious `Devnet only` session-wallet connector so the in-app browser can exercise signed user flows without a browser extension:

- generate an ephemeral local account inside the browser session;
- request dev ETH through the restricted faucet;
- show the address and devnet-only status at all times;
- never transmit or persist the private key outside that browser session;
- support clearing and creating another session wallet for multi-user scenarios; and
- compile only when the declared environment is `robyn-devnet` and chain ID is `31337`.

Testnet/release builds include a compile-time and bundle-scan gate that fails if the dev connector, faucet client, deterministic fixture keys, Anvil method strings or chain ID `31337` appear in protected artifacts.

## Production-shaped mock integrations

The devnet needs controlled substitutes for unavailable external dependencies without weakening interface boundaries:

- mock upstream launchpad factory and fee claimer matching the minimal adapter seam Robyn requires;
- mock launch token and AMM/trading venue with deterministic fee generation;
- mock WETH, stablecoin, crypto reward assets and Stock-Token-like assets;
- mock Chainlink-style feeds with freshness, sequencer and invalid-price controls;
- mock quote provider and guarded swap router with success, slippage, expiry, partial-route and revert cases;
- mock issuer-controlled token with pause, freeze, admin burn and migration behaviors;
- mock registry with active, removed and replaced asset states; and
- controllable failure fixtures for RPC disagreement, reorg, stale quote, failed basket leg and keeper restart.

Mocks must implement explicit interfaces and live in devnet/test packages. Production adapters cannot import mock implementations.

## Phase plan

### Phase 0: Planning and issue contract

Deliverables:

- approve this plan and the new decision/requirement entries;
- map phases to existing PRD requirement IDs and user stories;
- create GitHub milestones and implementation issues with acceptance evidence fields;
- define what counts as a major change and the required push checkpoint; and
- record owners for unresolved R0 decisions.

Exit gate:

- documentation validator passes;
- no implementation files or services have been introduced; and
- the planning commit is pushed to GitHub.

### Phase 1: Reproducible monorepo foundation

Deliverables:

- pnpm/Turborepo workspace and the documented app/package boundaries;
- pinned Node, pnpm, Foundry, Solidity and dependency versions;
- shared TypeScript, lint, formatting, test and environment-schema configuration;
- native self-hosted GitHub Actions runner plan and protected workflow labels;
- `.env.example` files containing names only, never credentials; and
- root commands for format, lint, typecheck, unit, contracts, integration, browser-evidence and build.

Exit gate:

- clean frozen install and all empty/smoke tasks pass on the VM;
- no Docker/container dependency exists;
- repository secrets/build output scans pass; and
- foundation commit is pushed.

### Phase 2: Native VM substrate and controlled Anvil

Deliverables:

- dedicated `robyn` service account and least-privilege directories;
- native PostgreSQL, Redis and MinIO installations with loopback/private binding;
- native Anvil persistent service and isolated ephemeral-test launcher;
- restricted RPC gateway and rate-limited dev faucet design/implementation;
- PM2 ecosystem skeleton and systemd startup integration;
- health endpoints and basic Prometheus/Grafana visibility; and
- backup/reset/recovery runbooks for devnet and native data services.

Exit gate:

- service, permission, port and firewall audit passes;
- no privileged Anvil method is reachable through the user RPC gateway;
- an arbitrary LAN user wallet can request dev ETH and submit a normal transaction;
- controlled service restart and VM reboot restore the declared process set; and
- infrastructure commit is pushed.

### Phase 3: Contract accounting core

Deliverables:

- pinned OpenZeppelin and contract dependency provenance;
- one-to-three immutable asset basket configuration totaling 10,000 basis points;
- fee vault/controller and per-leg pending balances;
- failed-leg retention rather than silent reallocation;
- transfer-aware cumulative accounting reference implementation;
- Merkle epoch distributor and deterministic epoch fixtures;
- pull claims, replay protection, pause boundaries and scoped roles; and
- unit, fuzz, stateful invariant, gas and failure suites.

Exit gate:

- conservation, solvency, transfer/claim ordering and duplicate-claim invariants pass;
- gas is recorded for one, three and five reference assets;
- two independent epoch builds produce byte-identical roots; and
- contract-core commit is pushed.

### Phase 4: Controlled launch, trade and conversion adapters

Deliverables:

- mock launchpad and fee-claimer adapter;
- mock AMM or trading path that produces disclosed fees;
- guarded quote/swap adapter and allowlisted target/spender/selector policy;
- mock registry, feeds, issuer controls and supported asset configuration;
- threshold batching, success/failure events and exact balance reconciliation; and
- deployment scripts and manifests for a clean devnet.

Exit gate:

- launch through claim works from clean genesis;
- stale/invalid quotes move no funds;
- one failed basket leg does not block another valid leg;
- expected and actual asset deltas reconcile; and
- adapter commit is pushed.

### Phase 5: Native data plane

Deliverables:

- Drizzle schema and migrations for raw logs, checkpoints, derived state, jobs and artifact metadata;
- reorg-aware deterministic indexer;
- Fastify read API and health/freshness contracts;
- Redis/BullMQ bounded jobs with idempotency and dead-letter visibility;
- native accumulator indexing and content-addressed MinIO artifacts; add a deterministic epoch builder only if a later adapter-mode release is selected;
- keeper simulation, submission and receipt reconciliation; and
- full rebuild, migration, backup and restore commands.

Exit gate:

- process kill/restart loses no canonical state;
- empty rebuild and checkpoint rebuild match;
- Redis deletion does not alter entitlement;
- MinIO artifacts survive restore with identical hashes; and
- data-plane commit is pushed.

### Phase 6: Web foundation and public discovery

Deliverables:

- accessible design-system tokens and core components from PRD 09;
- responsive application shell, navigation, disclosures and status surfaces;
- anonymous homepage/discovery, token detail, activity and creator profile;
- API freshness and live-RPC labeling;
- controlled-devnet network configuration and devnet session-wallet connector;
- injected wallet and WalletConnect connectors retained for real users; and
- stable `data-testid` attributes only where semantic selectors are insufficient.

Exit gate:

- anonymous and wallet connection journeys pass through the in-app browser;
- desktop, tablet and mobile screenshots pass review;
- keyboard and accessible-name checks pass;
- no provider secret or protected quote leaks into browser payloads; and
- web-foundation commit is pushed.

### Phase 7: Creator, trading, rewards and portfolio journeys

Deliverables:

- creator launch wizard with metadata, one-to-three asset basket and permanent-rule confirmation;
- preflight, signature, pending, confirmation and failure transaction states;
- token trading experience with fee and slippage disclosure;
- fees-invested, pending conversion and vault balance reporting;
- epoch proposal/challenge/finalization visibility;
- reward dashboard, proof retrieval, claim, already-claimed and unavailable states; and
- multi-token holder portfolio and transaction history.

Exit gate:

- every E2E scenario in PRD 07 passes in the in-app browser;
- two session wallets with different holding intervals receive correct rewards;
- page reload, service restart and delayed indexing states recover visibly;
- no unexplained browser console errors remain; and
- each major journey is pushed as its own checkpoint rather than one large final commit.

### Phase 8: Security, reliability and operations hardening

Deliverables:

- threat model and role/call matrix matched to deployed bytecode;
- secret, dependency, license, static-analysis and build provenance checks;
- rate limits, request bounds, CSRF/origin policy and safe error handling;
- monitoring for process health, disk, memory, index lag, queue depth, RPC divergence and reconciliation;
- incident runbooks for invalid root, quote failure, key compromise, RPC disagreement and database restore;
- PM2/systemd persistence and controlled reboot evidence;
- load, soak and resource-contention tests on the single VM; and
- internal contract/security review with all critical/high findings resolved; independent review remains mandatory before real-value asset operation.

Exit gate:

- required drills meet recovery targets;
- no unresolved critical/high security finding exists;
- capacity headroom is documented for testnet deployment;
- backups restore outside the live directories; and
- hardening commit is pushed.

### Phase 9: Mandatory in-app-browser release UAT

Run all user-facing verification through the Codex in-app browser against the VM URL. CLI or standalone browser automation does not substitute for this gate.

Required viewports:

- mobile: `390 x 844`;
- tablet: `768 x 1024`; and
- desktop: `1440 x 900`.

Required browser evidence per journey:

- starting URL, build commit and devnet generation ID;
- fresh DOM snapshot used to locate controls;
- scoped interaction through stable attributes or accessible names;
- transaction hash and resulting UI state;
- targeted console-log review;
- desktop/mobile screenshot at material financial states; and
- expected onchain/API/database reconciliation reference.

Required journey matrix:

1. anonymous discovery and token detail;
2. create and fund a devnet session wallet;
3. connect injected/WalletConnect wallet when an available test wallet can approve;
4. reject invalid metadata, duplicate assets and weights not totaling 10,000 bps;
5. launch valid one-asset and three-asset tokens;
6. buy and sell from two different wallets;
7. show fee accrual, threshold and pending conversion states;
8. execute all-success, partial-failure and stale-quote conversions;
9. transfer native launch tokens before and after reward deposits and prove accrued rewards remain with the earning history;
10. reproduce native accumulator accounting and repeated-claim safety; propose/challenge/finalize/reproduce an epoch only for a future adapter-mode candidate;
11. claim multiple reward assets and reject duplicate claims;
12. recover from stale API, index lag, worker restart and public-RPC failure;
13. verify portfolio and history after reload;
14. verify legal/risk disclosures and devnet-only labeling; and
15. verify responsive, keyboard, reduced-motion and non-color-only states.

A story is not accepted until its browser evidence is stored under a dated, commit-addressed evidence path and the lower-level automated tests also pass.

### Phase 10: Devnet release candidate

Deliverables:

- production-mode Next.js/Fastify/worker builds on the VM;
- PM2/systemd startup and reboot-tested persistence;
- reverse proxy, LAN access policy and TLS if a domain/certificate is available;
- seeded but resettable public devnet with visible generation identifier;
- published user instructions for adding the network, obtaining dev ETH and using normal or session wallets;
- operator dashboard, status page and support/runbook links;
- signed/tagged release manifest and changelog; and
- final browser UAT run against the exact production-mode artifact.

Exit gate:

- a new LAN user completes launch-to-claim without operator intervention except faucet automation;
- 24-hour soak has no unreconciled financial state or unbounded resource growth;
- clean install/rebuild from the release commit is reproducible;
- release candidate tag is pushed to GitHub; and
- no development-only warning is ambiguous or absent.

### Phase 11: Robinhood testnet migration package

Implementation status (2026-07-21): package, protected build, deployment verifier, full transaction rehearsal, isolated five-service rehearsal and protected-build browser UAT are implemented and mandatory release gates. Exact release `d90e218` is in the final uninterrupted soak. Actual public-testnet broadcast remains separately authorized.

Deliverables:

- separate `robinhood-testnet` chain configuration for chain ID `46630`;
- environment and bundle gates that exclude dev wallet, faucet, fixture keys, Anvil methods and mock-only routes;
- Robinhood testnet deployment scripts with simulation/dry-run and saved manifests;
- mock asset/feed deployment path only where no canonical testnet asset exists;
- native service configuration changes and rollback plan;
- testnet ETH funding checklist;
- explorer verification checklist;
- browser UAT matrix repeated against the testnet candidate URL; and
- explicit remaining external gates for Bags/pons, quote providers and Stock Tokens.

Exit gate for `ready to push to testnet`:

- a clean Anvil rehearsal using testnet-like configuration completes from deployment through browser claims;
- protected build scan proves no devnet privileged code or keys are included;
- testnet deployment manifests are complete except runtime-funded transaction hashes/addresses;
- all automated and in-app-browser release gates pass on the exact candidate commit;
- rollback, monitoring and incident procedures are reviewed; and
- the candidate commit and readiness report are pushed to GitHub.

Actual Robinhood testnet deployment requires a separate instruction and testnet ETH.

## Git and checkpoint policy

A major change is any completed contract capability, schema/migration set, service, public page/journey, infrastructure unit, security control, deployment mechanism or release gate. For each major change:

1. start from a clean VM worktree and current remote branch;
2. implement one bounded slice;
3. run the slice's VM-native lower-level tests;
4. run required in-app-browser UAT for changed user behavior;
5. update documentation, manifests and `MEMORY.md`;
6. scan staged content for secrets and generated junk;
7. commit with a scoped message;
8. push the working branch immediately; and
9. merge to protected `main` only after its required checks and browser evidence pass.

Use feature branches for incomplete or risky work, but push them after every major validated checkpoint. Never describe unpushed work as complete. Tag devnet release candidates and keep `main` deployable.

## Evidence layout

```text
artifacts/
  browser-uat/
    <yyyy-mm-dd>-<short-commit>/
      manifest.json
      desktop/
      tablet/
      mobile/
      console/
      reconciliation/
  releases/
    <release-id>/
      manifest.json
      checksums.txt
      deployment-addresses.json
      test-summary.json
```

Browser evidence may contain public devnet addresses and transaction hashes but never private keys, wallet recovery material, provider credentials or session storage dumps.
Because browser evidence can only exist after an exact commit is built and promoted, it may be committed on a release-attestation branch rooted at that exact commit and later attached to the candidate tag. The attestation manifest must name the runtime commit and include checksums; this avoids an impossible self-referential release commit.


## Dependencies and blockers by phase

| Item | Blocks |
|---|---|
| Product decisions for initial crypto assets, epoch cadence and minimum claim | Final Phase 7 behavior |
| Native PostgreSQL/Redis/MinIO and PM2/systemd setup | Phases 5 onward |
| Browser reachability to VM web/RPC gateway | Browser gates from Phase 6 onward |
| Devnet session-wallet isolation design | Signed browser flows and testnet-safe build |
| Independent contract/security reviewer | Real-value/public operation; not mock controlled-devnet or protected testnet rehearsal |
| Robinhood testnet ETH | Actual deployment after Phase 11, not devnet readiness |
| Bags/pons funded mainnet spike | Real adapter/mainnet release, not controlled devnet completion |
| Authenticated quote provider access | Real execution evidence and Stock Token beta, not mock devnet completion |
| Legal/upstream Stock Token clarification | Stock Token/mainnet release, not controlled devnet completion |

## Stop conditions

Stop advancement and open a blocking issue if:

- accounting cannot reconcile after deterministic replay;
- browser-visible values disagree with onchain/API sources without an explicit freshness state;
- a privileged Anvil method is exposed through the user RPC gateway;
- devnet-only wallet, faucet, key or mock code appears in a protected testnet artifact;
- restart/reboot loses canonical state or PM2/systemd does not restore required processes;
- a critical/high security finding remains unresolved;
- browser UAT cannot complete a core launch-to-claim journey; or
- a major change has not been pushed and its remote commit cannot be identified.

## First authorized build slice

When the user later authorizes implementation, begin only with:

1. Phase 1 monorepo foundation;
2. a minimal ephemeral Anvil smoke harness;
3. one contract accounting skeleton and its first conservation test; and
4. a nonfunctional web health page reachable through the in-app browser.

Do not start the full launchpad, install all infrastructure at once or expose a shared devnet until those foundations pass and are pushed.

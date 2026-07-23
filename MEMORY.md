# Project Memory

Durable project context lives here. Update this file whenever information should survive chat context compression or future agent handoff.

## Active Handoff

- Current task: execute the approved local release-assurance program on branch
  `codex/local-release-assurance`: internal schema-v4 audit, adversarial
  economics, chaos/alert/recovery drills, subagent UAT, reproducible builds and
  a final one-shot eight-hour soak. No public testnet broadcast is authorized.
- Baseline checkpoint: exact release `691e8cf` was clean and healthy; encrypted
  backup `robyn-state-20260723T070046Z` restored 14 tables, eight artifacts and
  chain state in isolation with `liveStateTouched=false`.
- Current result: deprecated vulnerable Uniswap Hardhat tooling was removed,
  the pinned router artifact was vendored, converter reentrancy was hardened,
  static security has zero unresolved high findings, and the 512-wallet,
  32-launch, 25,000-action economic campaign passes.
- Monitoring checkpoint: native Alertmanager and the append-only local receiver
  are loopback-only. All 14 assurance alerts produced checksummed firing and
  resolved evidence. This proves local delivery only, not external paging.
- Keeper correction: terminal protocol conversion jobs whose observed amount
  no longer matches authoritative onchain pending work transition to
  `superseded`; their original failure remains in append-only audit events.
  Matching unresolved work remains a dead letter and continues alerting.
- Chaos runner is fail-closed and requires a clean exact pushed commit. Live
  faults are limited to recoverable one-at-a-time PM2/native-service
  interruptions; reorg and corrupt-input cases use isolated ports/paths.
  Evidence is checksummed under `/var/backups/robyn/chaos/`.
- First chaos attempt failed closed after Redis interruption: systemd correctly
  stopped dependent PM2 through `Requires=`, but dependency recovery did not
  automatically restart PM2/Nginx. The runner now explicitly restores and
  proves both dependents before reconciliation.
- Reproducibility uses two independent clean archives and fresh pnpm stores
  built sequentially at the same fixed source root. This normalizes absolute
  source paths embedded by Next/Foundry. Next BUILD_ID is the Git SHA; cache,
  trace telemetry and absolute-path-only Solidity JSON metadata are excluded.
  JSON object keys and Next client-reference objects are canonicalized while
  application arrays preserve order; semantically unordered license-inventory
  arrays are sorted. The gate emits and compares a deterministic CycloneDX 1.5
  SBOM. Next preview/Server Actions cryptographic values come from a
  protected VM-only input whose SHA-256, but never contents, is recorded in
  evidence. All normalization rules are recorded.
- Final soak policy is one manually started, non-enabled eight-hour run with
  30-second samples, 100 stable read actors and bounded five-minute onchain
  trade/eligible-claim cycles. It must not advance chain time. Preserve its
  checksummed evidence, then remove `robyn-soak.service`; no recurring schedule
  remains.
- Immutable candidate `b7127d09878c7a9d193fb9264e20882a010b6232` was built,
  promoted and served with six zero-restart PM2 processes. Root in-app-browser
  UAT created/funded wallet `0xD673...46E8`, traded graduated ROBYN, atomically
  launched RASS, traded it through the mobile sheet, exercised DAO views and
  delegation, and claimed holder rewards with zero browser warnings/errors.
- UAT found a medium discoverability defect: Portfolio showed claimable holder
  basket rewards without an action. `PortfolioView` now simulates, submits and
  confirms a per-launch `claimAll()` and refreshes authoritative state.
- Three requested independent UAT subagents were blocked because their runtimes
  did not provide the Codex in-app browser. They produced no wallet, transaction
  or screenshot evidence. Root serialized UAT does not close that independent
  gate; do not report it passed without browser-capable independent evidence or
  an explicit product-owner waiver.
- The first short soak attempt failed closed on two harness defects: API actor
  paths were sent to the Next port and an early failure omitted the samples
  file before checksum generation. Actor API reads now use port 3101 and both
  JSONL evidence files are created before validation. A two-second regression
  passed with 100 actors, zero alerts/errors/restarts and checksums.
- The first transaction-bearing soak cycle then failed closed because the
  graduated adapter rejects a zero minimum output. The workload now obtains
  canonical buy/sell quotes and submits 99% bounded minimums. A configurable
  write cadence supports fast regression only; the eight-hour default remains
  one cycle per ten 30-second samples. A 10-second regression completed three
  cycles and 14 real transactions with zero errors, alerts or restarts.
- Isolated recovery now builds the backup-recorded commit and restores native
  PostgreSQL, Redis, MinIO and Anvil on alternate paths/ports, then starts web,
  API, indexer, keeper and artifacts for smoke checks. It fingerprints the live
  release link, deployment, chain state and durable database contents before
  and after and fails on drift. Database comparison canonicalizes row and table
  ordering while excluding only heartbeat and indexer poll timestamps. Same-VM
  isolation still does not prove total host-loss recovery.
- Recovery fingerprinting exposed a keeper defect: a terminal `superseded`
  conversion job was reconsidered every scan, rewriting its row and appending
  duplicate audit events. The keeper now selects only `dead_letter` jobs for
  this one-time transition, with a regression test proving an already
  superseded observation cannot be processed again.
- A transient-systemd recovery run exposed Git's root-owned safe-directory
  rejection while cloning the operator repository. Recovery source clone,
  checkout and cleanliness verification now always run as unprivileged
  `hendo420`, independent of the invoking root environment.
- The immutable release gate exposed creator-metadata drift after the last
  controlled chain reset: PostgreSQL still held bindings for retired token
  addresses. `scripts/seed-devnet-creator-metadata.sh` authenticated as the
  canonical demo creator and bound curated sanitized artwork to all five
  current launches. The creator data-plane verifier now targets the immutable
  API port 3101 by default and passes for the current genesis token.

- Completed goal: schema-v4 contracts and every mapped product action on the
  controlled local network are validated; deterministic hundreds-user
  simulation, built-browser acceptance, defect remediation, operational
  recovery and pushed checkpoints are complete on
  `codex/system-exhaustive-testing`.
- Current checkpoint: 70 Foundry tests, four stateful invariants, 64 authenticated
  and anonymous API cases, 108 ABI functions, 25 API endpoints and all 12
  required browser/operational journeys pass. Built-browser acceptance covered
  launch, bonding, graduation, post-graduation trading, claims, identity,
  responsive layouts and the full DAO lifecycle.
- High-scale result: the corrected 120-second profile passed 18,000 of 18,000
  requests across 512 virtual clients at 150 rps and 256 concurrency with zero
  monitored PM2 restarts. Contract simulation models 256 users, eight launches
  and 100 voters.
- Defects fixed during the goal include internal SSR routing and discovery
  single-flight caching, truthful measured buy copy, duplicate-launch
  prevention, zero-value DAO claim gating, DEX-first testnet-stack rehearsal,
  live-lifecycle verification, large-state restore request sizing, and the
  high-load web memory/process-stability gate.
- Evidence: committed checkpoint
  `evidence/system-simulation/20260723T051734Z/` plus checksummed final evidence
  under `/var/backups/robyn/system-simulation/final-af0c27a/`.
- Final closure: exact candidate `f54e3046f8df364a2809370ab377910fa6a1cf1c`
  passed 18,000 of 18,000 requests with stable services, the complete contract
  simulation, full repository gates, 64 API cases, the zero-pending action
  manifest, encrypted off-VM backup and isolated restore. Final LAN and public
  HTTPS browser smoke had no console entries or overflow.
- Next step: review/merge the branch. Real WalletConnect/Robinhood Wallet phone
  acceptance still needs a production project ID and stable registered HTTPS
  origin. Public testnet broadcast remains unauthorized.

- Current task: the approved multi-wallet connection release is implemented on branch `codex/multi-wallet`; no Robinhood Testnet transaction was broadcast.
- Current checkpoint: protected testnet components use one RainbowKit/wagmi connection layer for Create, trading, Portfolio, creator rewards, DAO and governance. Devnet retains the generated/restored session wallet through compile-time aliases.
- External gate: final WalletConnect/Robinhood Wallet acceptance still requires a real WalletConnect project ID, a stable registered HTTPS origin, and phone approval. The build-only fake project ID proves compilation and responsive modal behavior only.
- Next step: review/merge the branch, provide the production WalletConnect configuration, then run the documented real-device no-transaction acceptance matrix.

- Current task: implement token-specific creator-native rewards and the unified Portfolio creator dashboard on branch `codex/token-creator-rewards`; public Robinhood Testnet broadcasting remains unauthorized.
- Current checkpoint: token-specific creator rewards are complete on controlled schema-v4 devnet. Token-page claims, Portfolio individual/Claim All/advanced controls, wallet-gated visibility, LAN/public HTTPS routing, responsive acceptance, full validation and isolated chain-46630 rehearsal pass. No public testnet broadcast occurred.
- Next step: commit and push the final browser/keeper/deployment hardening checkpoint, then review/merge the branch. Before any public testnet transaction, separately authorize broadcast and reverify funding, DEX manifest, exact commit and protected build.
- Current task: the approved RDAO governance and immutable 50/25/20/5 protocol-fee release is complete on branch `codex/dao-governance-fees`; public testnet broadcasting remains unauthorized.
- Current checkpoint: fixed-supply RDAO/governance/fee contracts, schema-v3 deployment/verifier, indexer/API/keeper, responsive DAO/proposal UI, controlled reset/reseed, protected testnet rehearsal, LAN/browser acceptance, and public HTTPS acceptance are complete. The persistent VM serves the optimized build with all eight PM2 processes online and saved.
- Deployment checkpoint: schema-v3 local deployment now creates and seeds WETH/base conversion liquidity, deploys RDAO/Governor/Timelock/router/converter, binds v3 launch contracts, seals reward exclusions, assigns/renounces timelock roles, creates genesis atomically, and passes the expanded verifier on an isolated chain-31337 rehearsal.
- Economic invariant: every collectible fee allocates 50% to the launch basket, 25% to creator native claims, 20% to RDAO-holder native claims, and 5% to the timelock treasury. Existing launch splits and baskets are immutable.
- DAO decisions: RDAO is fully transferable and fixed at 1B; token balance controls instant native rewards, delegated checkpoints control votes; 1-day delay, 3-day vote, 2-day timelock, 10% quorum, 1% proposal threshold; guardian may pause conversion and cancel queued operations only.
- Active Codex goal: completed 2026-07-22 — securely persist and fund a dedicated Robinhood Chain Testnet deployer wallet and prove no-broadcast deployment readiness without exposing secrets.
- Goal completion standard: the encrypted operational wallet and recovery bundle survive isolated restore, owner-only permissions pass, the official chain-46630 balance is sufficient for deployment plus testing, and the workflow is documented and pushed without committing key material.
- Current task: atomic-launch and Robinhood Testnet Uniswap implementation is complete on feature branch `codex/uniswap-auto-graduation`; no public-testnet broadcast is authorized.
- Last meaningful change: added the v2 coordinator-only CREATE2 launch factory, size-bounded launch helper, coordinator-only Uniswap market factory, and one-transaction launch/market/seed/exclusion coordinator.
- Last verification: 2026-07-22 all 48 Foundry tests pass. New coverage proves inactive factories, immutable coordinator bindings, predicted addresses, exact supply custody, zero residual coordinator allowance/balance, direct-call rejection, duplicate salt rejection, concurrent launch identity, complete rollback against a pre-created pool, and successful graduation.
- Next step: review/merge the feature branch. Public chain-46630 deployment remains separately blocked on explicit broadcast authorization, clean exact `origin/main`, phase-one DEX verification, protected build, and live gas estimation after coordinator deployment.
- Current progress: local and protected-testnet creation now simulate and submit one coordinator call, generate a browser-random salt, and decode the canonical token from that receipt. The indexer gates schema-v2 launches on coordinator event plus seeded/sealed state. Testnet tooling is split into a verified DEX phase and atomic protocol phase.
- External gates: explicit broadcast authorization is still required before public-testnet deployment. Human alert delivery and independent contract review remain required before real-value operation.

## Current State

### 2026-07-23 - Isolated recovery fingerprint and keeper terminal-state fix

- Context: The isolated native restore reached complete service, API, contract,
  keeper and browser-HTTP smoke, then correctly failed its live-state guard
  because the keeper was rewriting a terminal job every five seconds.
- Decision: Treat `superseded` as terminal. Only `dead_letter` jobs may enter
  stale-observation reconciliation. Compare live PostgreSQL state with
  order-independent per-table JSON row digests instead of nondeterministic
  `pg_dump` output.
- Files: `apps/keeper/src/eligibility.ts`,
  `apps/keeper/src/server.ts`, `apps/keeper/test/eligibility.test.ts`,
  `scripts/rehearse-restore.sh`.
- Commands/tests: Keeper Vitest 7/7, keeper strict typecheck, Prettier check.
- Result: The repeated-audit root cause is fixed and volatile database
  normalization is limited to `service_heartbeats` and
  `indexer_checkpoints`. A direct isolated restore passed all gates with
  `liveStateTouched=false`; transient-systemd browser hold then exposed and
  fixed operator ownership for the clean source checkout.
- Follow-up: Rebuild/promote the exact pushed checkpoint, create a new
  encrypted off-VM backup, and rerun isolated CLI plus in-app-browser recovery.

### 2026-07-23 - Local alert delivery and stale-job reconciliation

- Native Alertmanager listens on `127.0.0.1:9093` with clustering disabled;
  `robyn-alert-receiver.service` listens on `127.0.0.1:9094` under systemd
  hardening and appends JSONL evidence.
- `scripts/verify-alert-delivery.sh` proved firing and resolved delivery for
  all 14 component, lag, divergence, keeper, conversion, accounting, restore,
  capacity and soak alerts. Evidence:
  `/var/backups/robyn/alert-validation/20260723T072319Z/`.
- A real dead-letter alert identified a stale historical bounded-conversion
  job. The keeper now marks it `superseded` only after its observed amount
  differs from authoritative onchain pending state, while retaining the
  failure in `job_audit_events`.
- Grafana now includes creator/RDAO native liabilities, treasury balance,
  pending protocol base, conversion age, restart counts, keeper progress,
  accounting status, restore status and soak status.

### 2026-07-23 - Assurance audit and economic checkpoint

- The first fresh security run failed closed on six new high dependency
  advisories inherited only through deprecated
  `@uniswap/swap-router-contracts` Hardhat tooling.
- The executable package was removed. Its exact official `SwapRouter02` JSON
  artifact was copied to controlled vendor storage with SHA-256
  `210a7bf29f26de9f45d35dac1214943eca41c3a002007dd6a0e1aa870bf2d2d1`;
  deployment and verification scripts use that path.
- `UniswapV3NativeFeeConverter` now has function-wide reentrancy guards.
  Narrow Slither annotations document existing guarded balance-delta and
  canonical creator claim-to paths. Security audit now reports zero high or
  critical dependencies and zero unresolved high contract findings.
- The schema-v4 simulation now models 512 wallets, 32 launches, 25,000
  deterministic economic actions across 20 seeds and 100 voters. The
  assurance profile runs invariants at 256 runs/depth 128.
- Full format, lint, typecheck, 70 Foundry tests, service tests, Anvil smoke,
  optimized build, deployment verification and zero-pending action coverage
  pass. Raw economic evidence is under
  `/var/backups/robyn/economic-simulation/20260723T071107Z/`.

### 2026-07-23 - Protected testnet stack rehearsal repair

- The schema-v4 protocol-only chain-46630 rehearsal passed, including atomic
  launch, graduation, post-graduation trading, all three basket conversions,
  holder claims, bounded native conversion, creator claim, RDAO claim and
  deployment verification.
- The first full application-stack rehearsal then failed closed because
  `scripts/rehearse-testnet-stack.sh` still invoked the protocol deployment
  without first deploying and supplying the required verified DEX manifest.
- The stack rehearsal now deploys the pinned Robyn-controlled test-only
  Uniswap v3 suite first and supplies its manifest to the protocol deployment.
  The rerun passed with isolated chain 46630, isolated PostgreSQL, protected
  web build, API, indexer, keeper and artifact services, three keeper
  conversions, cleanup, and preserved devnet health.
- No public Robinhood Testnet transaction was broadcast.

### 2026-07-23 - Live-lifecycle deployment verifier repair

- The final devnet verifier correctly found that the manifest's original demo
  phase is not authoritative after users legitimately graduate a bonding
  market. ROBYN had graduated during browser acceptance while its deployment
  manifest still recorded the seed phase as bonding.
- `scripts/verify-devnet-deployment.sh` now reads each market's live
  `graduated()` state, requires 100 percent progress and locked-pool liquidity
  after graduation, and otherwise requires bounded nonterminal progress.
- The repaired verifier passed the exercised schema-v4 devnet at block 1961.

### 2026-07-23 - Large exercised-state restore repair

- Encrypted off-VM backup creation passed for the exercised chain, 14 database
  tables and eight content-addressed artifacts.
- Isolated restore initially failed closed because the 6.8 MiB encrypted state
  contained an Anvil `anvil_dumpState` payload larger than Anvil's default 2
  MiB JSON-RPC request limit. Direct `--load-state` is not compatible with the
  encoded dump-state payload.
- `scripts/rehearse-restore.sh` now starts only the isolated restore Anvil with
  `--no-request-size-limit`, then uses the canonical `anvil_loadState` RPC.
  Checksum, decryption, all database row counts, artifact hashes, chain ID and
  factory bytecode passed; the rehearsal reported `liveStateTouched=false`.

### 2026-07-23 - Higher-scale web memory restart finding

- A 120-second, 150 rps, 256-concurrency, 512-client run produced 17,982 of
  18,000 valid responses but failed because the web process crossed its 512
  MiB PM2 ceiling twice. The 18 failed requests aligned with those restarts;
  API and RPC endpoints had zero failures.
- The production and preview Next.js memory ceilings are now 1 GiB, which fits
  the VM's 8 GiB capacity while retaining a hard bound. Other service budgets
  remain unchanged.
- `scripts/load-test.mjs` now snapshots the participating PM2 process status,
  restart count and PID before and after the run. A process restart or
  non-online service fails the simulation even if all HTTP responses happen to
  succeed.
- A 100-request validation run passed with all five monitored services stable.
  The complete corrected rerun at `af0c27a` then passed 18,000 of 18,000
  requests with zero restarts. P95 latency was 17.45 ms web, 5.01 ms API
  status, 4.07 ms API launches, 6.98 ms RPC chain ID and 7.23 ms RPC head.
  Checksummed raw evidence is under
  `/var/backups/robyn/system-simulation/final-af0c27a/`.

### 2026-07-23 - Built-browser lifecycle and defect checkpoint

- Codex in-app-browser acceptance against the optimized LAN build completed
  atomic creation, bonding and post-graduation trading, holder/creator/RDAO
  claims, creator batch claims, SIWE profile editing, Markets filtering,
  watchlist persistence, interactive chart keyboard use, DAO proposal voting,
  queueing and timelock execution, and disconnected-wallet gating.
- Browser acceptance found and fixed three product defects: homepage buy
  confirmation now reports the measured token delta and truthful four-way fee
  routing; successful launches disable resubmission and expose explicit view or
  start-another actions; zero-value RDAO claims and claim-to actions are
  disabled.
- Mobile and tablet checks passed without horizontal overflow across Home,
  Markets, token detail, Portfolio, DAO and Create. The token mobile trade
  sheet passed discard confirmation, backward focus wrapping and opener-focus
  restoration. Browser diagnostics were empty.
- `scripts/test-api-surface.mjs` now exercises a real ephemeral SIWE signature,
  authenticated profile update, sanitized media upload/read/report, logout and
  session invalidation. The same-origin surface passes 64 of 64 cases and is
  now the default test URL.
- Follow-up: complete final operational restart/rebuild, backup/isolated
  restore, protected testnet build/rehearsal, final exact-commit simulation and
  fail-closed action manifest before closing the active goal.

### 2026-07-23 - Exhaustive system test and 256-user simulation checkpoint

- Added `SchemaV4HundredsUsersSimulationTest`: 256 deterministic EOA actors, eight atomic launches by four creators, bonding buys/sells, two automatic graduations, post-graduation trades, basket conversion and holder claims, native conversion, RDAO transfer-aware rewards, per-token creator batch claims, 100 delegated voters, proposal voting, queue and timelock execution.
- Added `scripts/simulate-real-use.sh` and expanded `scripts/load-test.mjs` with stable virtual-client identities and internal-backend mode. The fail-closed runner writes raw logs, JSON metrics and SHA-256 checksums under `evidence/system-simulation/<UTC run id>/`.
- Initial live load failed with 2,907/6,000 requests: public Nginx per-IP limits returned 429 to internal SSR/load traffic, Next surfaced those as 500, and duplicate discovery analytics fanout pushed the API over its 384 MiB PM2 limit.
- Fixed PM2 devnet web configuration with `DATA_API_URL=http://127.0.0.1:3101`. Added tested `SingleFlightTtlCache`, bounded to 16 keys and 3 seconds, around discovery analytics. Rejected work is evicted and retryable.
- Rerun result: 6,000/6,000 requests passed at 100 rps, 200 concurrency and 256 modeled clients. P95 was 25.2 ms web discover, 5.5 ms API status, 4.1 ms API launches, 4.7 ms RPC chain ID and 4.5 ms RPC head. No API restart occurred during the passing run.
- This is a checkpoint, not goal completion. The finite coverage model and remaining browser, failure-injection, operational, rebuild and reconciliation gates are documented in `docs/system-testing.md`.

### 2026-07-23 - Contract and API failure-matrix expansion

- Added schema-v4 atomic rollback/authorization/pause coverage, a five-test Governor/Timelock matrix, a four-test RDAO permit/delegation/reward matrix, and a four-test native fee-converter matrix.
- The native converter matrix proves missing-pool, TWAP-deviation, excessive-impact, unsafe-minimum, expired, unauthorized, invalid-recipient/asset, dishonest balance-delta, success, and allowance-cleanup behavior.
- Full Foundry result is 70 passing tests, including four 128-run/depth-64 stateful invariants. `forge coverage` cannot produce a reliable report: non-IR compilation hits stack depth, and `--ir-minimum` cannot resolve pnpm-linked OpenZeppelin imports in the coverage analyzer.
- Added `scripts/test-api-surface.mjs`; all 54 public API route, query, validation, not-found, anonymous-session, invalid-signature/replay, profile, media, metadata, DAO, and artifact cases pass.
- SIWE tests must traverse `http://192.168.50.250:3000/api` with Origin `http://192.168.50.250:3000`; a direct backend-port request intentionally fails because Host and Origin differ.
- Follow-up: complete the machine-audited action manifest, authenticated creator/media integration, keeper/indexer failure matrix, full-scale final simulation, built-browser acceptance, and release reconciliation.

### 2026-07-23 - Multi-wallet connection release

- Added pinned RainbowKit `2.2.11`, wagmi `2.19.5`, TanStack Query `5.101.4` and existing viem `2.55.4` behind testnet-only provider/control aliases. EIP-6963 discovery, WalletConnect, wrong-chain gating, reconnect and one active connector now drive every testnet transaction surface.
- Robinhood Wallet is presented through standard WalletConnect without an invented deep link. MetaMask, Rabby, Coinbase Wallet, Rainbow, Trust, Safe and Ledger connectors are configured, but compatibility remains conditional on each wallet accepting custom chain `46630`.
- Account changes/disconnects invalidate the previous SIWE session. Wallet connection and SIWE remain separate. No recovery phrase/private key UI or storage was introduced.
- Protected builds require a 32-character WalletConnect project ID, HTTPS app URL and public HTTPS browser RPC, add a bounded WalletConnect CSP, and scan selected server/static output for devnet key/faucet markers. Build evidence schema 2 records `rainbowkit-wagmi` and public-RPC validation.
- Verification: web lint, strict typecheck and 13 unit tests pass. A protected chain-46630 candidate compiled cleanly with build-only metadata; in-app-browser acceptance proved connector grouping, Escape close, no page overflow and usable 390x844 presentation. Expected Reown allowlist errors remain with the fake project/domain and are the explicit external acceptance gate.
- The dependency audit exposed high findings in Next.js, transitive `ws` and transitive `axios`. Next is patched to `15.5.21`; bounded pnpm overrides select `ws` `8.21.0` only for vulnerable v8 ranges and `axios` `1.18.0` only for the vulnerable range. Production audit now has zero high/critical findings and one moderate finding.
- The optimized devnet build was restored, both persistent web services restarted, PM2 state saved, and browser verification confirmed the devnet session-wallet control rather than testnet wallet code.

### 2026-07-23 - Token-specific creator rewards final acceptance

- The controlled devnet was backed up to `/var/backups/robyn/robyn-state-20260723T040455Z.tar.zst.age`, reset, redeployed with schema v4, reseeded, rebuilt and restarted under saved PM2 state. Browser acceptance then created launch #6, `Creator Proof (CRTR)`, from wallet `0x9363...FEeb1`; the private session key remains outside the repository and memory.
- Creator fee accounting was accepted end to end. Browser trades accrued CRTR-only pending creator base, the keeper converted bounded batches, the token page claimed only CRTR ETH, and Portfolio `Claim all` cleared the subsequently accrued token balance in one transaction. Lifetime earned/claimed values remained attributed to CRTR; DAO Rewards exposed no creator claim controls.
- Browser acceptance proved the creator panel absent while disconnected/noncreator, present for the immutable creator, public HTTPS anonymous routing at `https://called-junior-documents-winston.trycloudflare.com`, no horizontal overflow at 390x844 or 768x1024, and no browser warnings/errors.
- Browser testing found and fixed local-account signing in both creator claim components: simulation now retains `walletClient.account`, allowing local devnet clients to sign raw transactions while injected testnet wallets continue using their provider.
- Keeper testing found and fixed three retry/safety defects: decode the schema-v4 fee account tuple, preflight and execute only the bounded native batch, and retry a previously failed protocol job only after a fresh safe preflight succeeds. The native conversion pool now provisions 64 observations; devnet starts with 10,000 base/WETH liquidity so repeated demo conversions do not immediately trip TWAP deviation. Production safety thresholds were not weakened.
- Final verification: Prettier, lint, monorepo strict typecheck, all application tests, Anvil smoke, 54 Foundry tests and four 128-run invariants, optimized devnet build, schema-v4 devnet verifier, and isolated chain-46630 rehearsal all pass. The rehearsal covered atomic launch, bonding, graduation, post-graduation trade, basket conversion/claim, bounded native conversion, token-attributed creator claim and RDAO claim without a public broadcast.

### 2026-07-22 - Token-specific creator rewards implementation checkpoint

- Creator native rewards are now accounted by launch token rather than aggregated by wallet. Each fee account records pending creator base, claimable creator native, cumulative creator native and claimed creator native while `totalCreatorNativeLiability` remains the solvency invariant.
- Creator calls are `claimCreatorFees(token)`, `claimCreatorFeesTo(token,recipient)`, and atomic batch equivalents. Unknown or foreign tokens revert the whole batch, zero owned balances are skipped, state clears before the single aggregate transfer, and each paid token emits an attributed event.
- API additions are `GET /launches?creator=<canonical-address>` and `GET /launches/:token/creator-rewards?account=<address>`. DAO account responses no longer expose creator claims; aggregate liability remains in Treasury monitoring.
- Token pages render earnings only for the connected immutable creator. `/portfolio` adds wallet-owned profile context, created-token cards, per-token claims, aggregate totals, Claim All and an advanced claim-to address. DAO Rewards retains RDAO member claims only.
- Deployment manifests move to schema 4 and explicitly identify `per-token-v2` creator accounting. Devnet/testnet scripts deploy `RobynProtocolFeeRouterV2`; verifiers and rehearsal calls use the expanded fee-account tuple.
- Verification: Solidity format check; all 54 Foundry tests including four 128-run invariants; API typecheck and 29 tests; indexer typecheck; web typecheck, 9 tests and optimized build. Controlled reset and browser acceptance are still pending.
- Isolated chain-46630 rehearsal passed schema v4 on 2026-07-23 without public broadcast. It deployed the pinned test-only Uniswap suite plus fresh protocol, graduated, traded post-graduation, converted all basket legs, performed bounded native conversion, claimed the token-attributed creator balance, claimed RDAO rewards, and reverified the manifest.

### 2026-07-22 - DAO browser acceptance and allocation manifest gate

- Browser acceptance on the persistent VM completed delegation, an 800M-vote proposal, quorum, queue, two-day timelock, successful target execution, and a 0.025 ETH RDAO member claim. Overview, Rewards, Governance, Treasury, Members, Activity, and proposal detail rendered without horizontal overflow at desktop, 768x1024, and 390x844.
- The browser caught and fixed a local-wallet signing bug in `apps/web/src/components/dao-view.tsx`: DAO transactions now retain the connected local account instead of replacing it with a bare address, and transaction failures render as controlled feedback.
- `scripts/deploy-testnet.sh` now refuses a real chain-46630 broadcast without `ROBYN_RDAO_ALLOCATION_MANIFEST`. The schema requires unique recipients, exactly 10,000 bps, non-empty purposes, and a `timelock` treasury reserve. The resolved allocation and source SHA-256 are frozen in schema-v3; `verify-testnet-deployment.sh` checks every onchain recipient balance.
- `config/rdao-allocation.example.json` is documentation only. Real member addresses and allocations remain an explicit human input and must not be invented or broadcast without participant approval.
- The isolated chain-46630 rehearsal passed again after this gate, including DEX verification, atomic launch, bonding, graduation, basket claims, bounded native conversion, creator claim, RDAO claim, and treasury receipt. No public testnet broadcast occurred.
- Final controlled reset created encrypted backup `/var/backups/robyn/robyn-state-20260723T033508Z.tar.zst.age`, redeployed schema-v3 from `179113a0973973fc91f34558933e6f272598ff05`, reseeded five launches with 28 trades, rebuilt, restarted, and saved all eight PM2 processes. Deployment manifest freeze is `9c536ac5662cfa60deec96e772f5ae26a26df272`.
- Public HTTPS acceptance caught hardcoded client port `:3100` in the DAO and Portfolio devnet clients. Commit `8e9eb43` uses the same-origin `/api` reverse proxy. LAN and `https://called-junior-documents-winston.trycloudflare.com/dao` now load authoritative DAO data with zero browser warnings/errors; the public Portfolio fetch also passes. Quick Tunnel hostnames remain ephemeral.

### 2026-07-22 - DAO and fee-routing contract checkpoint

- Added `RobynDaoToken`, `RobynGovernor`, `RobynProtocolFeeRouter`, `INativeFeeConverter`, and `UniswapV3NativeFeeConverter` plus fresh `UniswapV3MarketFactoryV3` and `RobynDaoLaunchCoordinator` integration surfaces.
- Curve fees route the basket half immediately while native obligations queue asynchronously. The LP NFT and principal remain locked; harvested launch-token fees may be sold only through guarded conversion before using the same split.
- Native conversion requires current-vs-TWAP tick agreement, a quoter-derived minimum with bounded price impact, a caller minimum, and a deadline. Guardian pause cannot unpause or withdraw assets.
- Verification: the full pre-existing Foundry suite remains green. New tests prove 50/25/20/5 conservation, treasury reward exclusion, transfer-aware claims, creator claims, launch-token fee conversion, fixed supply, and the complete propose/vote/queue/timelock-execute lifecycle.
- Follow-up: integrate deployment scripts/manifests, add v3 atomic fixture coverage, index DAO/fee events, build the DAO UI, reset/reseed local chain, and run browser acceptance.
- Deployment rehearsal: `deploy-devnet-protocol.sh` and `verify-devnet-deployment.sh` passed from a fresh isolated Anvil chain through schema-v3 block 49. The controlled persistent devnet has not yet been reset; application/indexer compatibility must land first.

### 2026-07-22 - DAO application and automation checkpoint

- API: `/dao`, `/dao/proposals`, proposal detail, members, and activity read authoritative RDAO, Governor, Timelock, fee-router, treasury, proposal/vote, and per-launch fee state from contracts and logs.
- Indexer: schema-v3 launches are exposed only when the coordinator event, factory mappings, seeded market, sealed exclusions, and fee-router creator/vault/market/locker registration all agree.
- Keeper: permissionless jobs now harvest LP fees, retry unsafe launch-token-to-base conversion, and retry queued base-to-native conversion using the converter's TWAP and quoter-enforced safe minimum. Default batch floors are configurable through `KEEPER_MINIMUM_PROTOCOL_BASE` and `KEEPER_MINIMUM_LAUNCH_FEES`.
- Web: `/dao` provides Overview, Rewards, Governance, Treasury, Members, and Activity views; `/dao/proposals/[id]` selects an onchain proposal. Controls simulate then claim, claim-to, delegate, propose, vote, queue, and execute. Devnet and protected-testnet wallet adapters remain separate so the session private-key path cannot enter testnet bundles.
- Verification: API tests (28), keeper tests (4), API/indexer/keeper/web strict typechecks, keeper/web lint, and optimized devnet web build pass. Persistent services still point to schema-v2 until the intentional reset/reseed checkpoint.

### 2026-07-22 - DAO conversion and testnet hardening

- Corrected a safety gap: the native converter now compares the Uniswap quote with post-fee current spot output and rejects excessive price impact, in addition to its TWAP deviation and caller-minimum checks.
- Base-to-native routing now accepts a maximum base input and proportionally consumes creator/DAO/treasury queues, so large liabilities drain through bounded retryable batches instead of requiring one unsafe swap. A new Foundry test proves conservation across partial and final batches.
- Keeper default maximum native-conversion batch is `100000000000000000` base units and remains configurable with `KEEPER_MAXIMUM_PROTOCOL_BASE`.
- Chain-46630 deployment and verification scripts now produce schema-v3 DAO manifests. The isolated rehearsal passed DEX verification, atomic launch, bonding/graduation, basket claims, bounded native conversion, creator native claim, RDAO native claim, and treasury receipt. The protected testnet web candidate built without forbidden devnet markers. No public testnet broadcast occurred.
- Added PRD 11, DAO user stories, and the DAO architecture/economics/threat/operations runbook. Persistent devnet reset/reseed and browser acceptance remain.

### 2026-07-22 - Atomic app, indexer, and chain-46630 rehearsal

- Web: local and protected-testnet creation now use one `RobynAtomicLaunchCoordinator.createLaunch` transaction. Both simulate first, generate a nonzero random browser salt, decode `AtomicLaunchCreated` from their own receipt, and distinguish indexing/artwork failures from onchain failure.
- Indexer: schema-v2 manifests use coordinator logs as canonical identity and require event-to-mapping agreement plus `seeded` market and sealed token exclusions before exposing a launch.
- Testnet DEX: `deploy-testnet-uniswap-v3.sh` and its verifier produce a separate `robyn-controlled-uniswap-v3-testnet` manifest with addresses, transaction inputs, constructor arguments, artifact/creation/runtime hashes, owner, fee tiers, pinned versions, and wiring. No public-testnet broadcast occurred.
- Testnet protocol: the old fixed-price path is replaced by schema-v2 atomic Uniswap deployment and refuses to run without a passing DEX manifest.
- Verification: formatting, lint, strict monorepo typecheck, and nine web tests pass. The isolated two-phase chain-46630 rehearsal passed atomic launch, bonding buy, automatic graduation, nonzero locked Uniswap liquidity, post-graduation sell, all reward conversions, and all claims.
- Gas: isolated chain-46630 measurement used 54,297,844 gas across 29 DEX-plus-protocol deployment transactions; the single atomic genesis launch used 14,021,027 gas. At the then-live 10,000,000 wei gas price the execution-only total is 0.00054297844 ETH, excluding Arbitrum L1 data fees. A live `eth_estimateGas` against the deployed coordinator remains a mandatory post-phase-two, pre-smoke-launch gate.
- Persistent devnet: schema-v2 contracts are deployed and five curated demos reseeded; PM2 services are online and saved. In-app-browser acceptance created canonical launch #6 through one coordinator transaction, immediately indexed it, bought 100 mUSD on the bonding curve, and observed truthful 24h volume/change/trader metrics. At 390x844 the token title remained 309px wide, discovery had no horizontal overflow, and the first card began at 608px. Browser console warnings/errors were empty.
- Final hardening: both creation clients translate pool-precreation, unbound-coordinator, reused-salt, and invalid-configuration custom errors into explicit fail-closed user messages. DEX verification also binds published npm source commits, lockfile integrity values, and current local artifact SHA-256 values before accepting the manifest.


### 2026-07-22 - Atomic local deployment tooling

- Devnet deployment now creates `RobynLaunchDeployerV2`, `RobynLaunchFactoryV2`, `UniswapV3MarketFactoryV2`, and `RobynAtomicLaunchCoordinator`, performs all one-time bindings, and creates genesis through one coordinator transaction.
- Demo seeding creates every launch through the coordinator with deterministic local-only salts; the deployment manifest is schema version 2 and records the coordinator and CREATE2 helper.
- Verification checks coordinator/factory/helper bindings, code presence, coordinator exclusion, zero residual token balance and allowance, seeded markets, and sealed exclusions.
- An isolated chain-31337 rehearsal deployed and verified the v2 stack, seeded five demos with 28 trades, and passed final verification at block 94. The persistent devnet has not yet been reset because web and indexer integration must land first.

### 2026-07-22 - Atomic launch contract core

- Contracts: `RobynLaunchFactoryV2` begins inactive and accepts creation/sealing only from its one-time-bound coordinator. `UniswapV3MarketFactoryV2` follows the same pattern. `RobynAtomicLaunchCoordinator` creates the launch, market, pool, inventory seed and five reward exclusions in one reverting transaction.
- Address safety: launch vaults and tokens use creator/configuration/user-salt-bound CREATE2 addresses. The browser must generate a fresh nonzero random salt; reused salts fail closed, and the adapter still rejects any pre-existing canonical pool.
- Size: `RobynLaunchDeployerV2` owns the CREATE2 creation bytecode and token exclusion authority, leaving `RobynLaunchFactoryV2` at 6,685 bytes with 17,891 bytes of EIP-170 margin. The helper itself is 21,046 bytes.
- Verification: `forge test --root packages/contracts` passes 46 tests including six new atomic coordinator tests and all existing accounting, malicious-callback, graduation, fork and invariant suites.
- Follow-up: deployment scripts and application code still use the prior multi-transaction ABI until the remaining release checkpoints are completed and the persistent devnet is intentionally reset.

### 2026-07-22 - Local canonical Uniswap deployment and automatic fee harvest

- Deployment: `scripts/deploy-local-uniswap-v3.sh` deploys pinned official v3-core 1.0.0, v3-periphery 1.4.4, and SwapRouter contracts 1.1.0 artifacts on chain 31337 only. The deployment manifest binds package versions and runtime code hashes.
- Factory: `UniswapV3MarketFactory` uses separately bound adapter/market deployers to remain under EIP-170, computes the initial sqrt price from base-per-token for either token ordering, creates the pool before exclusions seal, and preserves `createMarket`/`marketByToken` compatibility.
- Exclusions: every native launch now seals market, graduation adapter, immutable position locker, and canonical pool. API holder accounting also excludes and labels the locker.
- Data plane: the API accepts both legacy and canonical graduation events, exposes venue/locker/NFT/fee-tier metadata, ingests direct canonical pool swaps without double-counting Robyn-routed transactions, and shows the canonical venue on token pages.
- Automation: the existing keeper simulates and queues permissionless locker harvests for graduated Uniswap markets; quote fees enter `FeeBasketVault`, then the existing conversion jobs buy basket assets. Launch-token fees remain sequestered in the excluded locker.
- Persistent deployment: chain 31337 is reset and served from `/home/hendo420/Robyn`; five demo launches are indexed, EVID is graduated, and the manifest binds canonical local factory, position manager, router, quoter, package versions, and runtime hashes. All PM2 services are online.
- Verification: isolated deployment and five-demo seeding passed. EVID graduated and completed post-graduation buy/sell. Manual harvest moved mUSD fees from the NFT into the vault and left launch-token fees locked. A later trade was harvested automatically by one completed BullMQ audit job, increasing vault fees from 76.852318362795422879 to 79.852318362795422878 mUSD. In-app-browser acceptance additionally confirmed a fresh-wallet 100 mUSD buy through the same post-graduation interface, responsive rendering, the guided create dialog, and zero browser warnings/errors.
- Remaining limitation: `createLaunch` and `createMarket` are two wallet transactions. The market factory is atomic once called, but a public launch coordinator is still required to remove the intervening pool-precreation denial-of-service opportunity.

### 2026-07-22 - Canonical Uniswap graduation contract checkpoint

- Implemented: `packages/contracts/src/uniswap/UniswapV3BondingCurveMarket.sol`, `UniswapV3GraduationAdapter.sol`, `RewardFeePositionLocker.sol`, and minimal pinned interfaces. The threshold-reaching buy refunds excess input and atomically creates/initializes liquidity; any graduation failure reverts the whole purchase.
- Custody: the canonical Uniswap v3 position NFT is minted directly to a locker with no approval, transfer, rescue, or liquidity-decrease selector. Canonical `NonfungiblePositionManager` uses direct ERC-721 `_mint`, so the adapter explicitly calls `bindPosition` after verifying locker ownership and position metadata; the receiver callback remains fail-closed defense for safe transfers.
- Fees: quote-side pool fees are permissionlessly collected and passed to `FeeBasketVault.recordFees`; launch-token-side fees remain permanently in the excluded locker. LP principal and residual liquidity are not withdrawable. Reported pool fee is nominal; protocol fee activation can reduce the LP share actually harvested.
- Compatibility: Robinhood deploys official `SwapRouter02`, whose `exactInputSingle` struct omits the legacy deadline field. The canonical fork regression caught and fixed the original legacy-router ABI mismatch.
- Verification: `forge fmt --check`, 38 Foundry tests, invariants, and `forge build --sizes` pass. Explicit `ROBINHOOD_MAINNET_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract RobinhoodUniswapGraduationForkTest` passes against official chain-4663 factory `0x1f7d...2EfA`, position manager `0x7399...E0D3`, SwapRouter02 `0xCaf6...5cb2`, QuoterV2 `0x33e8...A9E7`, and WETH `0x0Bd7...AD73`; it is a local fork and performs no broadcast.
- Remaining gate: these contracts are not yet selected by the persistent chain-31337 deployment or application data plane. Chain-46630 deployment remains prohibited until canonical testnet DEX addresses/code hashes are independently established and the user explicitly authorizes broadcasting.

### 2026-07-22 - Canonical Uniswap graduation decision

- Decision: Native Robyn launches graduate automatically in the threshold-reaching buy into the pre-bound canonical Uniswap v3 token/quote pool. The liquidity position NFT is minted directly to an immutable no-withdrawal locker that can collect configured fees into the launch's existing basket vault.
- UX: The token remains tradable on Robyn. The same token-page Buy/Sell controls switch from curve quotes/execution to the bound Uniswap quote/router path from canonical phase state; no separate migration, venue-selection or external-site action is required. Direct pool trades are indexed into the same market history.
- Current implementation boundary: chain 31337 already proves atomic graduation and post-graduation trading through `DevnetLockedLiquidityPool`. It must remain labeled as a local rehearsal, not Uniswap.
- Required implementation: versioned `UniswapV3GraduationAdapter`, immutable `RewardFeePositionLocker`, pool-squatting and code-hash checks, terminal-price continuity simulation, canonical pool/locker indexing, direct-swap ingestion and browser acceptance through graduation, pool buy/sell, fee collection and holder claim.
- Testnet gate: no public-testnet broadcast until canonical chain-46630 factory, position manager, router/quoter, wrapped quote asset, fee tier and code hashes are independently verified. Identically named explorer contracts are insufficient provenance.

### 2026-07-22 - Robinhood launchpad graduation research

- Context: The user asked whether competing Robinhood Chain launchpads move to a DEX, which DEX they use, how their curves work, and whether Robyn matches.
- Result: `research/18-robinhood-launchpad-graduation-study.md` compares twelve products and separates internal curve-to-DEX migration from pool-native milestone systems. Circus, hood.fun, and Robinlaunch use or document Uniswap v3 graduation; vladlaunch uses SushiSwap v3; Rooket documents Uniswap v4; Robinfun claims Uniswap v2. pons, LaunchHood, NOXA Fun, LootPad, Robin Launchpad, and Circus Fair Open do not perform a conventional migration.
- Onchain evidence: verified source was inspected for Robinlaunch, pons, and LaunchHood components. Circus RH67 was independently resolved through the canonical mainnet Uniswap v3 factory to a live 1% WETH pool with nonzero liquidity.
- Robyn comparison: the local 1B/800M/200M virtual-reserve curve and atomic threshold transition are consistent with the dominant true-graduation pattern. Robyn differs by using local mUSD and sending pre/post-graduation fees to a weighted holder reward basket. Its current graduated pool is a local rehearsal, not a production DEX adapter.
- Testnet finding: Robinhood publishes chain-46630 RPC/explorer details but no canonical testnet Uniswap address table found in this pass. The canonical mainnet WETH, v3 factory, position manager, and router addresses are not contracts at those same addresses on testnet. Arbitrary testnet contracts with matching names are not acceptable provenance.
- Follow-up: decide WETH versus USDG from real routing/liquidity evidence; verify canonical chain-46630 DEX contracts; implement a versioned v3 adapter and no-withdrawal fee-collecting position locker; simulate price continuity and independently review both contracts.

### Robinhood Testnet Deployer Wallet Inventory

- Last verified 2026-07-22: the dedicated Robyn deployment and testing wallet is `0xecc5d6d032ADc9ca9E0F4042128067b8366da17A` on Robinhood Chain Testnet, chain ID `46630`. This is the wallet that contains the project testnet gas funds.
- Last verified 2026-07-22: the wallet contains exactly `10000000000000000` wei (`0.01` testnet ETH). The official RPC and Robinhood Blockscout independently agreed. Treat balances as live state and rerun `scripts/check-robinhood-testnet-wallet.sh` before relying on them. ERC-20/test Stock Token balances were not part of the completion balance audit and must be queried separately if needed.
- Operational encrypted keystore: `/home/hendo420/.config/robyn/wallets/robinhood-testnet-deployer/keystore/robyn-testnet-deployer`. The separate password file and non-secret address/environment pointers are under `/home/hendo420/.config/robyn/wallets/robinhood-testnet-deployer/`. Directories are mode `700`; secret files are mode `600`.
- Local encrypted recovery archive: `/home/hendo420/.local/share/robyn-wallet-backups/robinhood-testnet-deployer-recovery.tar.gz.age`, with its checksum sidecar. Verified archive SHA-256: `22f901854fd9f39e6cf09d21dcc9acec3245cabd4d1c6aade9cc6be54c4afed8`.
- Off-VM encrypted recovery: private GitHub repository `fourtytwo42/Robyn`, release tag `robyn-state-backups`, assets `robinhood-testnet-deployer-recovery.tar.gz.age` and `robinhood-testnet-deployer-recovery.tar.gz.age.sha256`. A fresh download, digest check, isolated decrypt and address recovery reproduced the expected wallet.
- Deployment readiness: a fresh isolated full package used 20 transactions and 15,352,146 gas. At the observed 10,000,000 wei gas price, execution cost was `0.00015352146` ETH, giving the funded wallet about `65x` execution-only headroom. Arbitrum L1 data fees are not reproduced by local Anvil, so retain the `0.005` ETH readiness floor and remeasure before public deployment.
- The actual encrypted keystore signed and completed the full isolated chain-46630 deployment rehearsal. No public-testnet deployment was broadcast and the readiness evidence records `broadcastPerformed: false`.
- Never put the seed phrase, raw private key, keystore password, decrypted recovery material, or signatures in Git, PM2, manifests, logs, chat, or `MEMORY.md`. Wallet funding does not authorize a public-testnet broadcast; explicit user authorization is required.

- Last verified 2026-07-22: dedicated Robinhood Chain Testnet deployer `0xecc5d6d032ADc9ca9E0F4042128067b8366da17A` is persisted as an encrypted Foundry keystore with separately permissioned password under `$HOME/.config/robyn/wallets/robinhood-testnet-deployer`. Its age-encrypted recovery archive passed local and fresh off-VM download/restore verification. No secret is stored in Git, PM2, a manifest, or this memory. Official chain-46630 balance is 0.01 ETH.
- Last verified 2026-07-22: the official faucet accepted the deployer address, completed its human/Google eligibility flow, and funded the wallet. Official RPC and Robinhood Blockscout both report exactly 10,000,000,000,000,000 wei.
- Last verified 2026-07-22: an isolated full-bundle deployment used 20 transactions and 15,352,146 gas. At the live 10,000,000 wei testnet gas price this is 0.00015352146 ETH execution cost, so the advertised 0.01 ETH faucet claim provides about 65x execution-only headroom before Arbitrum L1 data fees and repeated testing.
- Last verified 2026-07-22: `scripts/check-robinhood-testnet-deployment-readiness.sh` passed from clean, pushed main with a 0.005 ETH minimum floor and 0.01 ETH actual balance. The actual encrypted keystore and standardized testnet environment names completed and verified the full package on an isolated chain-46630 instance; `broadcastPerformed` remained false for the public testnet.
- Last verified 2026-07-22: the signed exact-release browser journey bought through the bonding curve, waited for the keeper to convert all three weighted reward legs and claimed mNVDA, mSPY and mETH. The homepage `Sell 100k` control then exposed its stale `parseEther("99")` minimum. It now derives a 99% minimum from the market's live `quoteSell` result and uses truthful dynamic confirmation copy; validation and a replacement exact release remain required.
- Last verified 2026-07-22: full-page in-app-browser inspection at 390x844 caught a visual token-hero clipping defect that document-overflow and nonzero-title-width assertions missed. The final mobile override now changes `.token-detail-hero` from a 76px/two-column grid to one column, gives identity copy full width and uses a 96px square artwork. Validation, replacement exact release and the entire closure sequence remain required.
- Last verified 2026-07-22: post-reboot in-app-browser acceptance of exact `3f2efbdfbb3e2634b13b69da89e5fc91e918629c` passed responsive, discovery, chart, watchlist and mobile trade-sheet checks, then found the standalone `/create` wallet button only emitted an event whose listener existed on the homepage. `LaunchpadConsole` now owns session-key creation and controlled faucet funding directly; web formatting, lint, typecheck, nine tests and optimized build pass. A replacement exact release and full closure rerun are required.
- Last verified 2026-07-22: exact artifact `0c1d7a7adb142ddcff3fe902718770147d9dc05e` promoted successfully with six operator-owned processes and a passing creator-data-plane verification. Pre-rehearsal inspection found the symmetric rollback wrapper still used root PM2 and verification, so it now uses the same `runuser` boundary. A replacement exact release must include both wrapper fixes before rollback/re-promote rehearsal.
- Last verified 2026-07-22: replacement artifact `d8ae3211e5d0866772ce81441caa40290028abf9` passed all twelve build gates and independent live verification, but its promotion wrapper failed closed because root could not use the operator peer-authenticated PostgreSQL role and briefly launched PM2 children as root. `scripts/promote-release.sh` now requires root only for privileged mutations while using `runuser` for PM2 and verification. A new exact release must include this wrapper fix; `d8ae321` is not final.
- Last verified 2026-07-22: post-reboot acceptance of `adcb0eaae37ea3ee356398aaed86f8843e94a4d1` exposed two fail-closed release defects before soak: `http://192.168.50.250:3000/rpc` returned the Next 404 because the primary Nginx web server lacked an RPC location, and immutable Next emitted EACCES while attempting `.next/cache/images`. Source fixes add the bounded same-origin RPC locations plus an installer JSON-RPC assertion and disable runtime image optimization for read-only releases. The replacement release must repeat all closure gates; `adcb0e` must not soak or be tagged final.
- Last verified 2026-07-22: immutable build fail-closed testing exposed that the testnet PM2 API lacked new creator-auth runtime inputs. `ecosystem.testnet.config.cjs` now provides `ROBYN_AUTH_ORIGINS`, Redis DB 1, testnet artifact URL, RPC URL and manifest; the isolated stack rehearsal passes all five services and cleanup. No failed artifact was created or promoted.
- Last verified 2026-07-22: security audit initially blocked immutable release creation on GHSA-f88m-g3jw-g9cj affecting sharp below 0.35.0. API and transitive Next sharp paths now resolve to 0.35.0; 26 API tests, strict types, API/web builds and the static audit pass with zero high/critical known vulnerabilities. No failed immutable artifact was created or promoted.
- Last verified 2026-07-22: `scripts/verify-creator-data-plane.sh` is a new fail-closed read-only release gate. It checks all five creator/media PostgreSQL tables, anonymous session null behavior, canonical profile/metadata identity, and active WebP bytes; `build-release.sh` records `creator-data-plane` as a twelfth exact-release gate and `verify-release.sh` embeds its result.
- Last verified 2026-07-22: `docs/ux-market-identity-release-audit.md` maps every approved responsive, discovery, analytics, trading, creation, media, profile, persistence and release requirement to current evidence. All implementation rows are PROVEN; exact release/reboot/backup/restore and 24-hour soak remain release gates.
- Last verified 2026-07-22: mobile applied-filter chips and the collapsed Filters count cover text search, basket asset/size, non-default sort, phase and window; a search-only ART22 query renders `Search: ART22`, `Clear all`, `Filters (1)` and exactly one result.
- Last verified 2026-07-22: `/create` no longer exposes the old launch registry or genesis trading console when dismissed. Its selected artwork/crop now triggers the discard warning, remains mounted across keep-and-close, and resets with the rest of the draft only on explicit discard.
- Last verified 2026-07-22: public browser interaction passed keyboard chart tooltip movement, mobile trade-sheet forward/reverse focus wrapping, entered-value discard confirmation, watchlist reload persistence, guided upload preview and zero warning/error console entries.
- Last verified 2026-07-22: a final source-ordered mobile homepage override prevents the late desktop hero grid from producing a zero-width copy column. At 390x844 the featured ROBYN artwork is visible in the initial viewport from 594-804px, the first market board begins at 978px, horizontal overflow is absent, and no creation modal leaks onto home.
- Last verified 2026-07-22: creator upload limiting is unit-tested as a wallet-scoped ten-per-hour fixed window; a live adversarial smoke proves already-bound launch metadata returns 409 and an authenticated wallet cannot bind artwork to another canonical creator's launch (403).
- Last verified 2026-07-22: `/create` opens a focus-trapped three-step modal for Token and artwork, Reward basket, and Review and launch. It preserves the draft and selected crop between steps, warns before discarding, exposes a compact Start launch page when dismissed, and uses the actual devnet/testnet name, symbol, basket, wallet funding/connection, transaction receipt and launch functions.
- Last verified 2026-07-22: the creator UI supports square crop/zoom for token artwork and creator avatars, SIWE wallet proof, existing-profile reload, profile editing, sanitized upload and one-time post-index launch binding. A public ART22 browser launch rendered `/api/media/bcc408c2-8ade-4ea0-a8d5-5f56ad9b96e0`; its creator proof rendered the saved Browser Demo Creator profile and sanitized avatar. Public reports explicitly do not auto-hide media.
- Last verified 2026-07-22: indexer launch projection now updates `created_block` when the canonical factory log arrives after an initial same-block fallback. Browser acceptance caught and proved the repair: ART22 changed from incorrect deployment block 19 to canonical block 131, and its chart launch timestamp changed to the matching current timestamp.
- Last verified 2026-07-22: browser acceptance created canonical UAT22 and ART22 launches; both received real 1,000 mUSD buys through the UI and now show truthful +45.69% indexed 24h change instead of insufficient history. The controlled registry therefore contains seven launches.
- Last verified 2026-07-22: `scripts/build-testnet-candidate.sh` passed for the protected chain-46630 mock manifest after guided-creation changes, proving forbidden devnet wallet/faucet markers remain absent and injected-wallet markers remain present. The controlled devnet build was restored afterward and both web processes were restarted/saved.
- Last verified 2026-07-22: creator authentication uses five-minute single-use Redis nonces, EIP-4361 origin/domain/chain validation, signature recovery through viem, one-hour opaque HTTP-only SameSite-strict sessions and request-origin binding. HTTPS cookies are Secure; non-Secure cookies are accepted only for the controlled chain-31337 HTTP surfaces. The live replay smoke passed.
- Last verified 2026-07-22: creator profiles and sanitized media are persisted through migration `0005_creator_identity.sql`. JPEG, PNG and static WebP uploads are decoded, dimension-checked, metadata-stripped and re-encoded to 1024-square WebP before the content-addressed artifact store; originals, signatures and browser-local watchlists are not persisted. Uploads are limited to ten per wallet/hour.
- Last verified 2026-07-22: an authenticated canonical creator can bind one owned token-art asset to an indexed launch exactly once. Active upload, controlled-devnet curated art, then generated fallback is the rendering order. Public reports do not hide media; `scripts/moderate-media.sh` records quarantine/restore audit history. Public-browser acceptance proved an active upload immediately falls back to curated art while quarantined and returns after restore.
- Last verified 2026-07-22: `scripts/seed-devnet-creator-metadata.sh` seeded the five controlled launches with sanitized curated art and a clearly labeled `Robyn Devnet Demo` wallet-owned profile. Discovery cards, token headers and creator proof render the profile/media through same-origin `/api` routes and state that social links are not externally verified.
- Last verified 2026-07-22: desktop token trading remains the existing sticky network-selected panel. At mobile widths, the same live form moves into a modal bottom sheet opened by a persistent Buy/Sell bar; it traps focus, locks background scroll, returns focus to the opener and requires an accessible in-sheet confirmation before discarding edited input.
- Last verified 2026-07-22: token actions support token-address copy, native share with clipboard fallback, browser-local watchlists keyed by canonical lowercase chain/token pairs, canonical factory creator proof and recent-activity navigation. Watchlists are not sent to the server and survived public-browser reload acceptance.
- Last verified 2026-07-22: discovery defaults to Trending over indexed 24h data and supports New, Near graduation and Graduated views plus selected-window volume/market-cap sorting. `GET /launches` retains old newest-first semantics when new parameters are omitted; ranked requests use opaque cursors bound to sort/window/phase and fail closed if the temporary 1,000-launch ranked projection capacity is exceeded.
- Last verified 2026-07-22: analytics derives canonical timestamped 24h/7d change, volume, buy/sell volume, trade count and unique traders without changing all-time semantics. A window with no timestamped trade reports null change and insufficient history. Five new canonical local-chain demo buys create honest current 24h data for all five demo launches; `scripts/refresh-devnet-market-activity.sh` is the controlled refresh command.
- Last verified 2026-07-22: the token page decision area shows labeled 24h change/volume/buy-sell split/lifecycle/traders and compact basket composition. Its SVG chart supports Price/Volume, 1H/24H/7D/All, axes, pointer/keyboard tooltips, buy/sell markers, transaction context and graduation markers.
- Last verified 2026-07-21: the shared controlled devnet was reset through `scripts/reset-devnet-demo.sh` after encrypted off-VM backups. It now contains exactly five bonding-generation launches and 28 real seeded trades: ROBYN 63.3%, SOAK 34.4%, ONE 15.7%, graduated EVID 100% and MYCO 68.0%. Discovery, home and token-detail UAT expose no legacy market.
- Last verified 2026-07-21: `scripts/seed-devnet-demo.sh` refuses any registry except a fresh bonding-only one-launch deployment. `scripts/reset-devnet-demo.sh` requires exact operator confirmation, a clean checkout, loopback chain 31337 and successful encrypted backup before destructive state replacement, and now forces a direct web rebuild after the monorepo build so compile-time manifest addresses cannot come from Turbo cache.
- Last verified 2026-07-21: discovery analytics read canonical active-liquidity balances from the bonding market or graduated pool while retaining indexed transfers and trades. This handles the intentional manifest boundary after seed liquidity without negative reconstructed reserves; a regression test covers that boundary.
- Last verified 2026-07-21: the eight saved PM2 apps serve the mutable repository checkout for LAN and preview after the generation reset. Exact release `8def270b1856c2bcfcd69d429a8d88def4ab15a8` is retired, and the next production-readiness step is a new immutable release plus uninterrupted soak.
- Last verified 2026-07-21: native devnet launches now use a 1B fixed supply, 800M constant-product bonding allocation, 200M graduation allocation, 1% basket fee and 6,500 mUSD graduation target. The threshold-reaching buy atomically and irreversibly initializes the pre-bound no-withdrawal pool and refunds excess input; no keeper or second graduation transaction is required.
- Last verified 2026-07-21: the public preview API runs with `ROBYN_DEMO_MARKET_CHANGES=true` on chain 31337. Discovery summaries expose deterministic address-derived movement between 1.25% and 18% plus `priceChangeSource: "demo"`; the API ignores the flag on every other chain ID. The ticker visibly says `Demo reward markets` and exposes each demo value accessibly. No chain state or canonical fixed-price analytics were changed.
- Last verified 2026-07-21: `dfd099e08459b695a310186388b80a4d1af09daa` blends Circus's market-density conventions into Robyn's dark basket-first identity. The shell has a canonical market tape; home has real launchpad statistics; discovery uses segmented immutable-weight rails and four/three/two/one responsive columns; token detail leads with market cap and indexed price; create has a representative basket preview. No invented percentage changes, bonding progress or unsupported economic claims were added.
- Last verified 2026-07-21: public preview URL is `https://fridge-bikini-arrangement-cottage.trycloudflare.com`. It is a random Quick Tunnel hostname and changes whenever the service establishes a new tunnel; the authoritative current value is `/var/lib/robyn-preview/public-url`. `robyn-preview-tunnel.service` is enabled at boot, Nginx listens only on `127.0.0.1:3080`, and the preview web PM2 environment uses `NEXT_PUBLIC_ROBYN_RPC_URL=/rpc`.
- Last verified 2026-07-21: Cloudflare `cloudflared` 2026.7.2 was installed from the official amd64 package after verifying SHA-256 `88195157a136199a86977c122a22084dae6907480bbe3640222b7b55834afc3a`. Quick Tunnels have no uptime SLA, a 200 in-flight-request limit and no SSE support; use a named tunnel/domain before production.
- Last verified 2026-07-21: `df9a2cfd417ab50b214d7dc4e84797a5c0fa66ef` implements the compact discovery browser and shared `rewardAssetMetadata` catalog; `076e790242277de651e5cdaf00d75dc6a9b77601` removes operational reward accounting; `ecf0a5f68c94cad3f0e2eacb38f27c42b5ed9678` adds market cap, total volume and holder count. Wide desktop uses three cards per row, compact desktop/tablet uses two and mobile uses one; square art is never stretched, and pending/converted/block accounting remains on canonical token pages.
- Last verified 2026-07-21: `77b549976cc83c0cdd4ccb4bbdc6560c04542604` establishes the canonical Robyn identity and `058076272eeb9038413a265b5863d1a009c4bba0` prioritizes the two above-fold discovery images. Production assets are `apps/web/public/assets/brand/robyn-logo.{png,webp}` and Next metadata files `apps/web/src/app/{favicon.ico,icon.png,apple-icon.png}`; the mark is a navy/teal robin with exactly three basket feathers and no embedded text.
- Last verified 2026-07-21: implementation commit `43deacaeb93d35bd29d54a657743a4b1f7d5bab7` plus LCP follow-up `996d859d7b418e00ebd7459d1f4e25781cd10193` add `GET /launches/:token/analytics` and a complete per-token market surface. The endpoint is bounded to 10,000 logs and fails closed beyond that point until a durable projection exists; it never invents missing metrics. Devnet trading uses the existing session wallet and testnet builds compile only injected-wallet controls.
- Last verified 2026-07-21: product messaging leads holders with the per-token reward basket and what they can earn. Creator-fee routing is the funding explanation on creator/economics surfaces, not the acquisition headline. Copy says a launch token “has” a basket and never says the nonredeemable token “is” or is backed by the basket.
- Last verified 2026-07-21: launchpad art assets live under `apps/web/public/assets/launchpad/`; generated PNG masters remain outside the repository and the production assets are 31-122 KB WebP files. `TokenArt` provides curated demo mappings and a generic permissionless fallback; `BasketAssetArt` covers mNVDA, mSPY and mETH.
- Last verified 2026-07-21: exact candidate d90e218 was invalidated as the final release after an independent audit found 39 owner-writable regular dependency executables with shared pnpm-store inodes. The soak was stopped cleanly after 191 samples with zero runtime errors; its summary correctly records aborted=true, completedDuration=false and passed=false. A replacement release must use copied dependencies and prove zero writable regular files/directories, shared dependency hardlinks and external symlinks.
- Last verified 2026-07-21: the copied-dependency b4c4436 artifact passed all release gates and staging immutability validation, but Linux denied moving its non-writable root between staging and releases because the directory's parent entry must change. No release target remained. The corrected sequence validates read-only staging, grants write only to its root for the atomic rename, removes that bit at the target and validates the final tree again; the behavior passed a disposable exact-path test.

- Last verified 2026-07-21: the first 2ba08ef full soak was intentionally stopped after nine samples proved API and artifact restart drift from PM2 ceilings below their normal resident memory. Reviewed 384 MB floors now cover both services in devnet and testnet configs; `scripts/validate-pm2-config.mjs` prevents regression across all 11 app definitions. A two-minute regression soak passed with zero restarts and zero endpoint, alert, resource or verification errors.

- Last verified 2026-07-21: exact release a4d9d4d passed post-reboot browser claim, sell, discovery, detail and portfolio acceptance with zero browser warnings/errors. A post-UAT backup with matching git SHA is present in the private off-VM release. The first final soak attempt exposed only an obsolete UI-copy assertion before sample collection; the corrected check for `Controlled development network` passed a complete short soak lifecycle.

- Last verified 2026-07-21: post-reboot signed browser acceptance found a keeper/manual conversion race. All devnet and protected-testnet conversion buttons now read live pending state and suppress a transaction error only when a post-error reread proves the keeper already consumed that leg; every other error is rethrown. A forced 5.2-second keeper race then passed buy, idempotent conversion, claim of all three assets and sell with zero console warnings/errors.

- Last verified 2026-07-21: in-app-browser UAT passed protected testnet home, injected-wallet absence handling, one-launch registry, anonymous discovery, canonical detail, repaired portfolio, zero console warnings/errors and a 390 by 844 responsive overflow check. The browser found and drove fixes for a portfolio 404, stale devnet disclosure and dishonest PM2 cleanup evidence.

- Last verified 2026-07-21: protected chain-46630 deployment, verification and compile-time web module selection are implemented. Protected builds reject devnet markers, faucet routes and generated session keys, require injected-wallet calls and target Robinhood Testnet chain 46630.
- Last verified 2026-07-21: the full chain-46630 mock journey and isolated five-service stack rehearsal pass. The rehearsal uses dedicated PostgreSQL database robyn_testnet_rehearsal, Redis DB 1, separate PM2 names/ports/queue and an owner-only operator key file, then removes its processes and preserves devnet health.
- Last verified 2026-07-21: Foundry passed 28 unit/fuzz/adversarial tests plus four handler invariants at 128 runs and depth 64. Malicious router and reward-token callbacks cannot reenter accounting; exclusions are capped at 16.
- Last verified 2026-07-21: the fresh release security audit reports zero unresolved critical/high, eight medium, five low and one informational Slither finding; zero high/critical dependency advisories; and zero Git-history secret findings. Medium/low dispositions are documented in docs/protocol-security-review.md.

- Last verified 2026-07-20: the authoritative workspace is `/home/hendo420/Robyn` on Ubuntu VM `robyn` at `192.168.50.250`; the Windows checkout is control-only and not an execution environment.
- Last verified 2026-07-21: the repository is a functional controlled-devnet launchpad with browser-operated permissionless launch/trade/convert/claim flows, a persistent six-process PM2 topology, native PostgreSQL/Redis/MinIO and lower-level contract/service tests. It is not yet production-ready or testnet-ready.
- Last verified 2026-07-21: LAN users can browse launches anonymously, filter by literal name/symbol, exact canonical token, basket size or basket asset, inspect canonical contracts/activity and reconcile held, claimable and cumulatively claimed assets for the tab's session wallet without sending its private key to the API.
- Last verified 2026-07-21: Prometheus, hardened node-exporter, PostgreSQL-backed Grafana and the 30-second custom collector run natively under systemd on loopback only. Both scrape targets, datasource and dashboard passed; a reversible alert fire/resolve drill passed. External human notification delivery remains required before real-value testnet operation.
- Last verified 2026-07-21: native Nginx is the only LAN application edge and UFW permits only subnet-scoped SSH, web, read API and restricted RPC ports. All application upstreams and raw infrastructure bind to loopback. Reproducible abuse/security gates, a forced-build contention run and targeted adversarial vault callbacks passed; the real 24-hour soak and independent review remain open.
- Last verified 2026-07-21: a persistent daily backup timer encrypts PostgreSQL, Anvil, content-addressed artifacts and configuration, uploads to a private GitHub release, retains seven backup pairs and has a separately protected off-VM recovery identity. Clean-target restore meets the under-four-hour target by a wide margin.
- Last verified 2026-07-21: the native contract core and devnet fixtures are deployed persistently from `deployments/31337.json`. The faucet-enabled block-45 deployment supports a fully browser-operated genesis buy, weighted fee conversion, transfer-aware multi-asset claim and sell flow.
- Last verified 2026-07-20: `prd/` is the authoritative product-intent layer. It specifies R0 validation, R1 crypto adapter pilot, R2 Stock Token beta and optional R3 native launchpad; research remains authoritative for external evidence.
- Last verified 2026-07-20: `user-stories/` is the delivery-backlog layer derived from the PRDs. Its generated traceability matrix covers all 182 PRD requirements with 154 stories.
- Last verified 2026-07-20: settled application stack is pnpm/Turborepo; Next.js 15, React 19, strict TypeScript, Tailwind v4, Radix/shadcn-owned components, viem/wagmi, WalletConnect/injected wallets, TanStack Query/Table, Zod/React Hook Form; Fastify; VM-native PostgreSQL/Drizzle, Redis/BullMQ and MinIO; Solidity/Foundry/OpenZeppelin; Vitest/Testing Library/Playwright; OpenTelemetry/local structured errors/Prometheus/Grafana; PM2 plus systemd; and a VM self-hosted GitHub Actions runner. Docker and containers are prohibited.
- Last verified 2026-07-20: the R1 visual direction is dark-first and restrained with canvas `#0B1020`, teal `#35D0BA` primary, violet `#8B7CF6` secondary, gold `#F2B84B` reward/pending accent, Inter UI typography and IBM Plex Mono for addresses/numbers. The basket is the primary visual concept; a final logo remains unresolved.
- Last verified 2026-07-20: Alloy provides the closest reusable source implementation for the reward-stream model. Its MIT-licensed `AlloyMeme` has single-asset transfer-aware reward accounting, but production reuse requires a multi-asset rewrite, guarded swaps, a canonical asset allowlist and a new audit.
- Last verified 2026-07-20: IndexPad has mainnet and testnet deployments for a fee-funded redeemable basket design, but it is not a safe dependency: no professional audit, conflicting/stale documentation, partially verified Blockscout source and a linked GitHub repository that currently returns 404.
- Last verified 2026-07-20: Vladdy provides a live launch-time single-Stock-Token reward mode and transfer-aware distributor. Its four launches all use the 5% tier, but all four reported zero stock purchased and distributed. The fallback conversion trusts an agent, the factory does not enforce canonical registry membership, and the deployed design cannot express a weighted basket.
- Last verified 2026-07-20: the old Alloy launchpad has 15 launches but currently reports a 0/100/0 holder/creator/protocol split. Its repository keeper value is malformed, its published old index address has no code, and a clean-checkout suite compiled only after a TypeScript pin then failed 4 tests. The current website uses a different unverified launchpad.
- Last verified 2026-07-20: raw factory scans found 64,602 pons `TokenLaunched` events and 3,066 Bags `TokenCreated` events through block 15,070,088-era state. Counts are not unique-user, active-token, quality, liquidity or revenue measures.
- Last verified 2026-07-20: the RHJ registry exposed 96 assets; Dexscreener discovery found USDG pairs for 70, but 59 of those displayed under $10,000 liquidity and only 6 at least $50,000. Firm execution remains unverified because anonymous 0x/1inch quote requests returned 401.
- Last verified 2026-07-20: HoodETF, Alloy Index and BASKET Protocol are additional mainnet permissionless Stock Token basket factories. They increase competition for a redeemable basket product but do not provide Robyn's requested weighted multi-asset reward stream from a separate community token's trading fees.
- Last verified 2026-07-20: canonical Safe v1.4.1 deployments include Robinhood chain ID 4663.
- Last verified 2026-07-20: Robinhood Chain mainnet is live on chain ID 4663 and the official RHJ API lists 96 active Stock Tokens and tokenized ETFs.
- Last verified 2026-07-20: Robinhood Chain Testnet is live on chain ID 46630; its public RPC and explorer respond, and its RPC permits browser cross-origin POST requests.
- Last verified 2026-07-20: this folder is a Git repository on branch `main` with origin `https://github.com/fourtytwo42/Robyn.git`; the private GitHub repository is also cloned at `/home/hendo420/Robyn` on the VM.

## User Preferences

- Keep `MEMORY.md` updated consistently with durable context that should survive chat compression.
- Agents should read `AGENTS.md` often and check `MEMORY.md` whenever context is missing, stale, or uncertain.
- Use uppercase filenames `AGENTS.md` and `MEMORY.md`.
- For this project, document research and recommendations in Markdown files in the workspace.
- Run all project builds, tests, package installs, databases, services, migrations, workers, RPC nodes, deployments and Git operations on the `robyn` VM, never on the Windows workstation.
- Do not use Docker or containers for this project.
- Make Node processes persistent with PM2 plus systemd startup and `pm2 save`; make native infrastructure services persistent with systemd.
- Start development on the VM-hosted native Anvil chain rather than depending on Robinhood Testnet ETH; keep Hardhat Network out of the stack unless a later ADR changes the decision.
- Perform all user-facing acceptance testing through the Codex in-app browser against the VM-served application.
- Keep lower-level Foundry, service, database, migration, security and operational tests in addition to browser UAT.
- Commit and push every major validated change from the VM so GitHub stays current; use feature branches for incomplete/risky work and keep `main` deployable.
- Run any project-operated RPC server, database, queue, object store, monitoring stack or CI runner natively on the VM.

## Source Of Truth

When sources conflict, use this order:

1. Current files in `/home/hendo420/Robyn` on the VM.
2. Latest command output or freshly verified tool output.
3. This `MEMORY.md` file.
4. Chat history.

## Freshness Rules

- Treat browser state, email state, authentication state, and external service results as stale unless verified in the current session.
- Treat documented repo structure, user preferences, and decisions as durable unless current files or fresh verification contradict them.
- Use `Last verified YYYY-MM-DD` for facts that can drift.

## Privacy Rules

- Do not store secrets, tokens, passwords, private keys, or sensitive personal data.
- For Outlook or ICJIA email work, do not store full email bodies, private addresses, case details, or sensitive agency data.
- Store only brief summaries, message IDs, dates, and action state when email context must survive handoff.

## Setup And Commands

- Last verified 2026-07-20: start all work with `ssh hendo420@192.168.50.250`, then `cd /home/hendo420/Robyn` and verify `git status --short --branch`.
- Last verified 2026-07-20: the VM repository uses `main`; origin is `https://github.com/fourtytwo42/Robyn.git` and GitHub reports the repository visibility as private.
- Docker/Compose packages were installed before the no-Docker decision, but `docker.service`, `docker.socket` and `containerd.service` are disabled and inactive. They are not part of the project stack; package removal is a separate administrative action.
- Install PostgreSQL, Redis, MinIO, PM2, monitoring, reverse proxy, self-hosted runner and RPC software natively on the VM only when required by the current implementation slice.
- Live controlled devnet operations: `docs/devnet-operations.md`. Services are `robyn-anvil.service` and `pm2-hendo420.service`; user RPC is port 8546 and raw privileged RPC is loopback port 8545.
- Last verified 2026-07-21: Node `24.18.0`, pnpm `11.15.1`, Foundry/Anvil `1.7.1`, Solidity `0.8.30`; run `pnpm install --frozen-lockfile` then `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- The pnpm build-script allowlist permits only pinned transitive Next.js dependencies `sharp` and `unrs-resolver`; do not broaden it without review.
- Monitoring reference: `docs/monitoring-operations.md`; services are `prometheus`, `prometheus-node-exporter`, `grafana-server` and `robyn-metrics-collector.timer`. Operator UIs remain loopback-only.
- Operational reference: `docs/vm-runtime-and-operations.md`.
- Official Stock Token registry: `https://api.robinhood.com/rhj/assets`.
- Robinhood Chain public RPC: `https://rpc.mainnet.chain.robinhood.com`; mainnet chain ID `4663`.
- Robinhood Chain Testnet: chain ID `46630`, public RPC `https://rpc.testnet.chain.robinhood.com`, explorer `https://explorer.testnet.chain.robinhood.com`, feed `wss://feed.testnet.chain.robinhood.com`.
- No official public testnet ETH faucet or canonical testnet Stock Token registry was found in the official documentation reviewed on 2026-07-20. Use deployed mocks after a test-ETH funding route is confirmed.

## Project Map

- Project purpose: Research and potentially build a Robinhood Chain launchpad that converts creator trading fees into an immutable creator-selected asset basket for token-holder rewards.
- Main workflow: Token launch -> creator fee capture -> weighted Stock Token or crypto purchases -> pull-based holder claims.
- External systems: Robinhood Chain, RHJ asset registry, Chainlink feeds, Uniswap/UniswapX, 0x RFQ, and a launchpad such as Bags or pons.
- Important paths:
  - `AGENTS.md`: repository-local agent workflow and memory rules.
  - `MEMORY.md`: durable context store.
  - `docs/devnet-to-testnet-readiness-plan.md`: controlled Anvil topology, production-readiness definition, phased build sequence, browser UAT matrix, Git checkpoints, evidence gates and testnet migration package.
  - `README.md`: executive finding and research index.
  - `docs/vm-runtime-and-operations.md`: binding VM-only execution, native service, PM2/systemd persistence, CI, RPC, deployment, backup and capacity rules.
  - `research/01-chain-and-assets.md`: chain, liquidity, Stock Token, and registry findings.
  - `research/02-launchpads-and-competition.md`: verified launchpad and adjacent-product comparison.
  - `research/03-product-feasibility-and-architecture.md`: recommended product definition and implementation paths.
  - `research/04-regulatory-security-and-risks.md`: legal, security, operational, and stop conditions.
  - `research/05-asset-registry-snapshot.md`: 2026-07-20 canonical asset table.
  - `research/06-launchpad-product-blueprint.md`: concrete product UX, adapter and native architecture, requirements, release stages, and MVP definition.
  - `research/07-cross-chain-launchpad-ux-study.md`: 13-platform product and UX comparison with live screenshots and Robyn interface recommendations.
  - `research/08-launchpad-subpage-ux-study.md`: creation, token-detail, rewards, discovery, profile, portfolio, and authentication-flow comparison.
  - `research/09-launchpad-terms-comparison.md`: 13-platform terms, eligibility, creator-obligation, dispute, open-access, and adapter-diligence comparison.
  - `research/10-robinhood-chain-and-stock-token-terms.md`: RHDA Chain Services terms, permissionless-chain scope, RHJ securities terms, smart-contract composability, transfer restrictions, issuer powers, RPC implications, and Robyn-specific analysis.
  - `research/11-reusable-contracts-and-infrastructure.md`: deployed-protocol, open-source, API, oracle, multisig and library reuse audit; exact addresses; license boundaries; minimized contract sets; and adapter-versus-native recommendation.
  - `research/12-indexpad-like-products.md`: current direct and adjacent competitor map for fee-funded Stock Token rewards and redeemable basket factories, including deployment/source/audit caveats.
  - `research/13-live-contract-and-integration-due-diligence.md`: live deployment truth, provenance corrections, reuse map and funded adapter/execution spike protocols.
  - `research/14-liquidity-traction-and-economics.md`: raw launch-event counts, Stock Token liquidity snapshot, conversion policy, fee-flow scenarios, RPC cost split and go/no-go thresholds.
  - `research/15-security-legal-operations-validation-plan.md`: contract topology, threat model, invariants, incident runbooks, written diligence questions, user-research script and delivery gates.
  - `prd/README.md`: PRD index, source hierarchy, requirement namespaces and current blockers.
  - `prd/00-product-brief-and-decisions.md`: vision, terminology, settled decisions, assumptions, unresolved decisions and explicit non-goals.
  - `prd/01-master-product-requirements.md`: users, outcomes, release scope, core requirements, quality attributes and product acceptance.
  - `prd/02-creator-launch-and-discovery.md`: creator wizard, immutable basket configuration, preview, discovery and creator-profile requirements.
  - `prd/03-trading-rewards-and-holder-experience.md`: token detail, trading, reward states, epoch claims, portfolio and comprehension requirements.
  - `prd/04-protocol-accounting-and-execution.md`: adapter/native topology, fee lifecycle, accounting, execution guards and invariants.
  - `prd/05-platform-data-and-infrastructure.md`: client, indexer, API, keeper, RPC, environment and service-target requirements.
  - `prd/06-security-compliance-and-operations.md`: trust model, controls, permissionless policy, operational roles, incident requirements and release gates.
  - `prd/07-delivery-plan-and-acceptance.md`: risk-first milestones, epic mapping, ten end-to-end scenarios and definition of done.
  - `prd/08-analytics-and-experimentation.md`: metrics, event taxonomy, user research, quote study, experiments and expansion gates.
  - `prd/09-ui-ux-visual-design-system.md`: settled palette, typography, responsive grid, information hierarchy, components, charts, motion, content and design QA requirements.
  - `prd/10-technology-stack-and-repository-architecture.md`: settled monorepo, frontend, backend, contracts, persistence, queue, artifacts, testing, observability and CI/CD baseline.
  - `user-stories/README.md`: story conventions, personas, epic index, definition of ready and definition of done.
  - `user-stories/01-access-wallet-and-shared-experience.md` through `10-technology-stack-and-developer-platform.md`: 154 user, technical-enabler, operational, design, stack and release-gate stories.
  - `user-stories/TRACEABILITY.md`: generated mapping from every PRD requirement to covering story IDs.
  - `scripts/validate-user-stories.py`: validates story structure/PRD coverage and regenerates the traceability matrix.
  - `research/live-contract-audit.json`, `market-snapshot.json`, `competitor-traction.json`, `reward-economics.json`: machine-readable point-in-time evidence.
  - `scripts/audit-live-contracts.py`, `measure-market-snapshot.py`, `measure-competitor-traction.py`, `model-reward-economics.py`: read-only reproducibility and scenario scripts.
  - `research/screenshots/launchpads/`: dated visual evidence, capture metadata, and two labeled contact sheets.
  - `research/screenshots/launchpad-subpages/`: 22 subpage captures, metadata, and four labeled contact sheets.
  - `scripts/capture-launchpad-screenshots.mjs`: reproducible Playwright capture script.
  - `scripts/build-launchpad-contact-sheets.py`: contact-sheet generator.
  - `scripts/discover-launchpad-subpages.mjs`: public route discovery helper.
  - `scripts/capture-launchpad-subpages.mjs`: reproducible subpage capture script with selective recapture support.
  - `scripts/build-launchpad-subpage-contact-sheets.py`: subpage contact-sheet generator.
  - `scripts/discover-launchpad-legal-links.mjs`: fresh anonymous-session homepage and footer legal-link discovery.
  - `scripts/inspect-dynamic-launchpad-terms.mjs`: JavaScript-rendered terms and disclaimer text capture.
  - `research/launchpad-legal-links.json`: dated machine-readable legal-link discovery evidence.
  - `research/dynamic-launchpad-terms.json`: dated machine-readable dynamic terms and disclaimer extracts.

## Architecture Notes

- Default client RPC strategy: call `https://rpc.mainnet.chain.robinhood.com` directly from each browser, use Multicall/caching/moderate polling, support a user-supplied RPC, and avoid proxying routine wallet traffic through project infrastructure.
- Do not assume Robinhood's undocumented public rate-limit key is always a unique user IP. Shared NAT, carrier, corporate, and VPN egress can concentrate traffic. Add retry with jitter, degraded-state UX, and a low-volume fallback.
- Reserve one archive-capable shared endpoint for correctness-critical background work: complete Transfer log ingestion, Merkle epoch construction, harvest execution, and monitoring. Never expose an unrestricted secret provider key in browser code.
- Recommended initial model is a fee-funded reward token, not a redeemable basket token. Do not call it backed unless redemption is implemented.
- Recommended implementation sequence is testnet proof -> crypto-only mainnet adapter -> permissionless Stock Token beta with no project-operated eligibility gate -> optional native launchpad.
- Bags is the clearest adapter candidate because it explicitly supports multiple creator fee claimers. pons is also promising because creators choose a fee wallet, but contract-wallet compatibility must be tested.
- Native launches should use transfer-aware cumulative reward-per-share accounting. Existing-token adapters should use auditable epochs and pull claims; never push to all holders.
- Stock purchases require offchain 0x or UniswapX quotes plus onchain token, expiry, minimum-output, Chainlink, sequencer, and pause validation.
- Basket assets and weights should be immutable per launch; failures retain that weight in WETH or USDG rather than silently reallocate it.
- Robinhood's official developer docs expressly support Stock Token indices, baskets, lending, yield vaults, trading interfaces, price-aware contracts, and derivatives. This establishes technical composability, not unrestricted legal distribution.
- The RHJ Base Prospectus says a Stock Token transfer is legally effective only if disposal moves between natural or legal persons and complies with the Registration Agreement and Product Terms. A successful ERC-20 transfer to or from a contract does not by itself prove a legally valid transfer.
- RHJ may require investor or beneficial-owner certification and may block, freeze, pause, seize, destroy, migrate, or refuse to honor Stock Tokens or transfers in specified circumstances. Prohibited Investors have no Product rights, including redemption rights.
- Testnet proof uses locally deployed mock ERC-20s, mock Chainlink-style feeds, and a mock issuer-controlled token. Do not reuse mainnet Stock Token addresses because no canonical testnet Stock Token registry was located.

## Verification Ledger

- 2026-07-23: Root-agent release browser UAT on immutable candidate `b7127d0`
  passed discovery, graduated and bonding trading, charts, Portfolio, atomic
  launch, creator-only accounting, DAO views/delegation, holder claims and
  `390x844` mobile trading. The wallet and transaction hashes are bound in
  `docs/assurance/uat-root-2026-07-23.md`; browser warning/error logs were empty.
  Portfolio claim discoverability was the single medium finding and was fixed.
  Three independent browser persona agents remain blocked by missing in-app
  browser capability and are not counted as a pass.

- 2026-07-22: Mobile trading and token-actions checkpoint - web lint, strict typecheck, nine tests and optimized build passed. Public in-app-browser 390x844 acceptance proved a visible fixed Buy/Sell bar, modal sheet/focus entry, body scroll lock, accessible discard confirmation with value preservation, confirmed close/focus return, local watchlist persistence and truthful creator proof. Browser UAT found locale-dependent chart hydration text; explicit en-US/UTC chart and ticker formatting removed the mismatch, and a fresh verification tab had zero warnings/errors.

- 2026-07-22: Market-intelligence checkpoint - API strict typecheck and 16 tests, web lint/strict typecheck and nine tests, both optimized builds, PM2 restart/persistence and live API smoke passed. Public in-app-browser UAT at 390x844 proved first-card visibility, collapsed/expanded filters, no horizontal overflow, nonzero token title width, a single-column market layout, range controls and a keyboard chart tooltip; browser logs contained zero warnings/errors. Five timestamped canonical demo buys now expose nonzero 24h volume and indexed change for every demo token.

- 2026-07-22: Mobile token-detail repair checkpoint - moved the responsive token grid override after the launchpad desktop layer, restored a nonzero identity column and stacked the quote across both columns. Web lint, strict typecheck, nine tests and optimized build passed. Public in-app-browser 390x844 geometry reduced the hero from 1258px to 318px, restored the title from 0px to 213px wide and retained zero horizontal overflow.

- 2026-07-21: Canonical cross-page token-card checkpoint - `MarketCard` now supplies one implementation for Home and Markets, while `TokenCardArt` supplies the same large image, overlay identity, phase/context badge and launch number to Portfolio and both interactive registries. Web formatting, lint, strict typecheck, nine tests and optimized build passed. Public in-app-browser UAT showed four aligned homepage cards, five aligned Markets cards, complete basket/market/lifecycle information, zero old discovery-card nodes, no overflow and no Legacy content.

- 2026-07-21: Compact homepage showcase checkpoint - reduced the information panel from about 277px to 211px while preserving the 239px large artwork and every basket, market-cap, volume, holder, lifecycle, progress and raised/liquidity field. Web formatting, lint, strict typecheck, nine tests and optimized build passed. Public in-app-browser geometry measured four identical 284.5 by 452.3 cards and identical action baselines, with no legacy content or horizontal overflow.

- 2026-07-21: Shared bonding-generation reset checkpoint - encrypted off-VM backups `robyn-state-20260722T014835Z` and `robyn-state-20260722T015508Z` preserved the previous state before the controlled chain, projections and queues were replaced. The new deployment contains five launches and 28 real buy/sell transactions, with four bonding phases and one automatically graduated pool. Discovery reserve snapshots fixed manifest-boundary reconstruction without discarding indexed holder/trade history. Full repository gates, 29 Foundry tests/four invariants, manifest verification and public in-app-browser discovery/home/detail acceptance passed with no Legacy content and aligned showcase actions.

- 2026-07-21: Bonding-only demo reset rehearsal - an isolated Anvil instance on loopback port 8555 deployed a fresh protocol and seeded five launches with 28 buy/sell transactions across six development accounts. Progress was ROBYN 63.3%, SOAK 34.4%, ONE 15.7%, EVID graduated 100% and MYCO 68.0%. The manifest verifier passed with no legacy-factory assumptions. Full repository gates passed afterward.

- 2026-07-21: Homepage market-card parity checkpoint - the four large-art showcase cards now expose lifecycle, launch number, named basket weights, segmented rail, market cap, volume, holders, phase status and a bottom-aligned market action. Web formatting, lint, strict typecheck, nine tests and optimized build passed. Public in-app-browser geometry measured equal 283 by 239 art, equal card bounds and equal action coordinates for ROBYN, SOAK, ONE and EVID; the single-asset ONE card remained aligned without fabricated placeholders.

- 2026-07-21: Discovery-card alignment checkpoint - the card is explicitly full-height and its dedicated action wrapper uses auto top margin plus fixed spacing. Web formatting, lint, strict typecheck, nine tests and optimized build passed. Public in-app-browser geometry showed identical button coordinates for all four cards in row one, all four cards in row two and all three cards in row three across mixed one/three-asset and bonding/graduated/legacy content.

- 2026-07-21: Bonding-curve and graduation checkpoint - full format, lint, strict typecheck, service tests, isolated Anvil smoke and optimized build passed. Twenty-nine Foundry tests and four 128-run invariants covered quote rounding, reserve conservation, final-buy refunds, one-time atomic graduation, post-graduation trading, fee routing, locked-liquidity access denial and reward exclusions. Deployment verification passed at block 246. Public in-app-browser UAT created BBT, bought CURVE and changed its progress, rendered GRAD at 100% with the locked pool and verified the same-origin faucet.

- 2026-07-21: Demo market-movement checkpoint - commits `7fe8039932b3754496446ac4cec3e46cbff72237` and `44014804bff3aad89fa2e2aebc0fbc416e0e72b6` add bounded deterministic non-zero ticker changes, strict chain-31337 activation, API source labeling and visible/accessibility disclosure. Full repository gates passed for the implementation; web gates passed for the labeling follow-up. API output showed eight non-zero mixed values and `source: demo`; public in-app-browser verification showed `DEMO REWARD MARKETS`, correct positive/negative classes and zero warnings/errors. PM2 saved the explicit preview flag and optimized production build `kzR4me7nDWEIjDll8XU9O`.

- 2026-07-21: Production preview and market-ticker checkpoint - pushed implementation commit `e5948bf2a69262964f3939d42ab0e76567d24feb`, exposed `priceChangeBps` in discovery summaries and replaced basket-size ticker text with canonical market cap plus signed percentage change. Full format/lint/typecheck/test passed, including Anvil smoke, 28 Foundry tests and four 128-run invariants. API and web were rebuilt from the committed SHA; PM2 serves optimized build `nYHzxplphlNRKXkqRb1m0` via `next start` with production environment, zero restarts and zero unstable restarts. Public in-app-browser verification observed eight ticker entries with `1M mUSD` market caps, truthful fixed-price `0.00%` values and hashed production chunks.

- 2026-07-21: Canonical logo and favicon checkpoint - used the saved cross-chain launchpad screenshots to select the common single-glyph identity pattern, then generated and refined an original right-facing robin with three reward-basket feathers. Commit `77b549976cc83c0cdd4ccb4bbdc6560c04542604` adds optimized transparent header assets, a multi-size ICO, 512px app icon, 180px Apple-touch icon, accessible header integration and the settled PRD brand rule. Full lint/typecheck/test/devnet build/protected testnet build, Anvil smoke, 28 Foundry tests, four 128-run invariants and 182/182 traceability passed. In-app-browser desktop/mobile checks verified asset loading, icon metadata and no overflow. A final reload exposed one unrelated discovery-card LCP hint; `058076272eeb9038413a265b5863d1a009c4bba0` corrected the two above-fold images and passed web lint/typecheck/test and both builds. Stable `8def270` remained untouched.

- 2026-07-21: Canonical token-market-page checkpoint - pushed `43deacaeb93d35bd29d54a657743a4b1f7d5bab7` with bounded event/state analytics, responsive price and cumulative-volume charts, devnet/testnet-selected buy/sell panels, reward economics, top holders, recent trades and provenance for every launch. Full lint/typecheck/test/devnet build/protected testnet build passed; API unit coverage validates transfer/trade reconstruction and snapshot reconciliation; Anvil smoke, 28 Foundry tests, four 128-run invariants, 182/182 traceability and production dependency audit passed. In-app-browser UAT verified ROBYN desktop/mobile, truthful zero-trade PIXEL state, chart and buy/sell controls, then executed and independently rebound a PIXEL buy/sell pair to blocks 213/215 with no mobile overflow or runtime errors. Final reload found one Next.js LCP priority hint; follow-up `996d859d7b418e00ebd7459d1f4e25781cd10193` corrected the first detailed basket image and passed web lint/typecheck/test/build. Stable release `8def270` remained untouched.

- 2026-07-21: Reward-basket messaging checkpoint - home now leads with “Hold the token. Earn the basket,” discovery leads with rewards earned, token detail says “What holders earn,” and `/create` explains how trading fees build the creator-selected basket. PRD decisions bind this holder-benefit-first hierarchy without implying collateral backing or redemption. Full lint/typecheck/test/build passed, including Anvil smoke, 28 Foundry tests and four 128-run invariants. In-app-browser desktop and 390x844 checks found no overflow; clean post-build preview had RPC ok and zero warnings/errors.

- 2026-07-21: Launchpad visual-system checkpoint - generated nine square masters and committed 31-122 KB WebP derivatives totaling 680 KB for ROBYN, MYCO, EVID, ONE, SOAK, mNVDA, mSPY, mETH and the permissionless fallback. Home, discovery, create, detail, reward, registry and portfolio surfaces now use artwork. Full format/lint/typecheck/test/build passed, including 28 Foundry tests and four 128-run invariants. Clean in-app-browser desktop and 390x844 checks had no overflow or warnings/errors; `/create` funded a session wallet, launched PIXEL as canonical #8 and verified its fallback art in discovery. The stable 8def270 release remained untouched while the PM2 preview ran on loopback port 3003.

- 2026-07-21: PM2 memory-budget soak checkpoint - the first exact 2ba08ef full soak was stopped after nine samples because API and artifact restart totals moved from 4 to 12 while health stayed superficially green. Their measured normal RSS of roughly 278-301 MB exceeded the 256 MB PM2 ceilings. Devnet API/artifact and testnet API/artifact ceilings were raised to a reviewed 384 MB floor, and a release-gated validator now covers names, autorestart and memory floors for all 11 PM2 definitions. A 120-second nine-sample regression soak then passed with zero errors, restart totals 0 to 0, both protocol verifications, zero alerts, healthy resources and 33.14 ms worst endpoint p95.

- 2026-07-21: exact-release browser and soak-gate checkpoint - immutable release a4d9d4d passed post-reboot signed claim and sell, discovery, canonical launch detail and portfolio reconciliation at block 120 with zero browser warnings/errors. Its matching encrypted post-UAT state backup was uploaded as private GitHub release assets. The full soak stopped before sampling on an obsolete discovery-copy assertion; updating the gate to the rendered controlled-development-network label then passed a 20-second five-sample lifecycle with zero errors, unchanged restart count, 38.05 ms worst endpoint p95 and successful initial/final protocol verification. The 24-hour clock must restart on the replacement exact release.

- 2026-07-21: LAN edge cold-recovery checkpoint - exact commit 72166d91b498cba11f23b4ff4b2d3592783a9757 was pushed and encrypted off-VM with matching gitSha, then a fresh reboot returned zero failed units, every required native unit active, all six PM2 apps online with zero restarts, block 102/two launches/169 logs intact, two healthy monitoring targets and zero firing alerts. A Windows TCP probe exposed only 22, 3000, 3100 and 8546; nine internal ports remained closed. In-app browser discovery and portfolio reconciliation passed through Nginx with preserved balances, empty logs and no horizontal overflow.
- 2026-07-21: LAN edge, security and short-load checkpoint - native Nginx and UFW expose only subnet-scoped ports 22, 3000, 3100 and 8546 while nine application/infrastructure ports remained unreachable from LAN; Nginx scored 3.8 OK. Edge abuse tests passed headers, TRACE rejection, privileged-RPC denial, RPC batch/body/input bounds, explicit 429 shedding and recovery. A forced-build 180-second run completed 4,500 of 4,500 validated requests with 12.16 ms worst p95, no PM2 restarts, no state drift and more than 6.2 GB free memory. Full history Gitleaks, package audit and production Slither returned zero secrets, known vulnerabilities and high findings. A malicious router could not reenter either guarded vault entry point, and all 22 Foundry tests passed.
- 2026-07-21: Monitoring and cold-start checkpoint - native loopback Prometheus, hardened node-exporter and PostgreSQL-backed Grafana passed both scrape targets, custom metrics, datasource/dashboard and a reversible scoped alert fire/resolve drill. The first reboot exposed an artifact/MinIO race and unused failed IPMI unit; explicit PM2 dependencies and IPMI disablement fixed both. A second reboot recovered all required services, all six PM2 apps with zero restarts, block 102 and two launches, healthy monitoring, zero alerts/failed units, and browser discovery/detail/portfolio state without console issues.
- 2026-07-21: Encrypted backup/restore checkpoint - a no-root systemd job uses PostgreSQL peer access, a dedicated read-only/no-write MinIO credential, age encryption and private GitHub release assets outside the VM failure domain. The recovery identity round-trip hash matched its OS-protected off-VM copy without writing plaintext there. The 830 ms clean-target rehearsal verified 9 restored tables, 1 content-addressed artifact, chain 31337 and factory bytecode, cleaned temporary targets and left live health green.
- 2026-07-21: Discovery/detail/portfolio checkpoint - the API added bounded literal and exact-address discovery filters with parser tests; the live deployment returned correct MYCO/exact/literal-percent results and HTTP 400 for malformed/overflowing cursors. In-app-browser acceptance verified filtered anonymous discovery with live reward state, canonical launch details with 20 of 50 recent logs, the active wallet's 2,960,000 MYCO position and claimed reward history, plus an isolated no-wallet empty state without session leakage.
- 2026-07-21: Native artifact storage checkpoint - installed checksum-pinned MinIO Community server and mcli as a hardened loopback-only systemd service, provisioned a versioned bucket and no-delete service account, added PostgreSQL migration 0004 and the persistent `robyn-artifacts` PM2 process. First/duplicate writes returned 201/200, exact bytes survived restarts, negative request and delete tests passed, a MinIO outage propagated degraded/503 state and recovered, the systemd exposure score was 2.7 OK, and in-app-browser status showed Artifacts ok without console issues.
- 2026-07-21: Bounded conversion keeper checkpoint - added a single-concurrency BullMQ worker with deterministic IDs, three-attempt exponential backoff, current-state audit, append-only transition/receipt events, Redis-validated heartbeat, API visibility and devnet-only manual retry. A fresh browser MYCO buy converted exact 4/4/2 mUSD legs on attempt one, wrote nine queued/active/completed events, zeroed pending base and ended in a browser claim without console errors. Earlier signer-chain and SQL-parameter defects stopped before fund movement and were recovered. PM2 persistence, non-devnet fail-closed behavior and Redis degraded/503 recovery passed; full gates and zero-known-vulnerability audit passed.
- 2026-07-21: Redis faucet quota checkpoint - gateway uses atomic Redis Lua reservations with bounded TTL. Address quota survived PM2 restart and returned HTTP 429 with 3,589 seconds remaining. A controlled Redis outage made the faucet fail closed with HTTP 503 before privileged RPC; Redis/gateway restart restored service. Unit suite remains deterministic through the injectable memory limiter.
- 2026-07-21: Reorg-aware indexer/API checkpoint - persistent PM2 indexer stores canonical blocks and 75 raw logs, verifies its checkpoint hash and rebuilds two launch projections. The read API exposes bounded status/launch/detail/activity/assets endpoints with asOfBlock/indexedAt. Truncating all derived/indexed state and restarting reproduced the exact counts at block 90; API/indexer restart retained them; browser showed Indexer ok at block 90.
- 2026-07-21: Native data foundation - installed Ubuntu PostgreSQL 16.14 and Redis 7.0.15 natively, enabled both systemd services, verified loopback-only listeners and created peer-authenticated database robyn owned by hendo420. Added the Drizzle schema plus transactional idempotent migration 0001 for canonical blocks, raw logs, launch projections, checkpoints, job audit and migration ledger; applying it twice succeeded.
- 2026-07-21: Permissionless browser launch UAT - a session creator launched and seeded MYCO with a 40/40/20 basket as registry launch #2. A distinct session holder funded, bought 990,000 MYCO, generated and converted exact 4/4/2 mUSD legs, claimed 7,904,349,388,211,341 mNVDA, 15,808,698,776,422,683 mSPY and 11,856,524,082,317,012 mETH units, then sold 10,000 MYCO. The mobile 390x844 registry had no horizontal overflow.
- 2026-07-21: Self-service market factory - added DevnetMarketFactory so each recorded launch creator can permissionlessly deploy exactly one fixed-policy controlled-devnet market without bundling deployment bytecode in the browser. Contract suite passes 21 tests. Deployment block 74 from d31c68f includes the market factory, and live verification confirms its factory/market registry links plus genesis accounting.
- 2026-07-21: Browser genesis journey - in-app-browser LAN UAT created a session-only wallet, received 10 DEV and 10,000 mUSD, bought 990,000 ROBYN, observed exact 4/4/2 fee weights, converted all legs, claimed mNVDA/mSPY/mETH, sold 100,000 ROBYN and recovered the 890,000-token and reward state after reload. The 390x844 layout had no horizontal overflow. Next.js production build, strict typecheck and web tests passed.
- 2026-07-21: Devnet faucet fixture and current deployment - 20 Foundry tests passed. The mock base asset permits one 10,000-unit claim per address while reward-asset faucets are disabled. The persistent block-45 deployment manifest and verifier enforce that policy.
- 2026-07-21: Devnet trading fixture and eligible-supply correction - 19 Foundry tests passed. One-time exclusion sealing prevents market inventory dilution; a full mock buy/sell generated fees, converted a basket leg and paid a holder claim. Deployment scripts refuse non-31337 chains and require loopback unlocked accounts without storing a private key.
- 2026-07-21: Persistent protocol deployment - `deployments/31337.json` records block 19 deployment from fad0444. Live account 1 bought 990,000 ROBYN, generated a 10-base fee, permissionlessly converted the 4-base mNVDA leg, claimed 7,904,349,388,211,341 mNVDA units, sold 100,000 ROBYN for 99 base, and retained its 890,000 ROBYN balance across Anvil systemd restart. Live bytecode, links, exclusions and fee conservation reverified at block 26.
- 2026-07-21: Native protocol core - full repository gates passed; 16 Foundry tests including 512 aggregate fuzz cases passed; pnpm audit found no known vulnerabilities after exact PostCSS 8.5.20 and esbuild 0.28.1 overrides. Largest runtime was RobynLaunchFactory at 19,588 bytes, 4,988 bytes below EIP-170.
- 2026-07-21: Controlled devnet infrastructure - native Anvil systemd service enabled and active with five-second state persistence; state balance survived restart. Restricted gateway passed 10 unit/integration tests plus live standard-method, privileged-method rejection, fixed faucet funding, repeat-rate-limit, CORS and LAN port-isolation checks. PM2 systemd restart resurrected web and gateway; in-app browser then showed `ok · chain 31337` with no console warnings/errors. Remaining gaps include Redis-backed limits, TLS/firewall, immutable releases, full VM reboot, backups and load/metrics.
- 2026-07-21: Full VM reboot recovery - passed from pushed commit dd90518. Host returned with robyn-anvil.service and pm2-hendo420.service enabled/active, robyn-web and robyn-rpc-gateway online, the 10-dev-ETH test balance unchanged, both health endpoints healthy and the in-app browser showing robyn-devnet plus ok on chain 31337 without warnings/errors.
- 2026-07-21: Foundation checkpoint 01 - VM production build passed; Vitest 2/2, Foundry 5/5 including 256 fuzz runs, isolated Anvil chain 31337 smoke, lint, strict typecheck and formatting passed. In-app browser verified the VM URL at 1440x900, 768x1024 and 390x844 with correct `robyn-devnet` status, unique semantic landmarks, no element crossing viewport bounds and no console warnings/errors. Browser testing caught and drove fixes for static environment labeling and mobile wrapping before acceptance.
- 2026-07-20: Controlled-devnet planning traceability - passed; `python3 scripts/validate-user-stories.py` ran on the VM and reports 154 stories covering 182/182 requirements, including Anvil isolation, browser acceptance and Git checkpoint requirements.
- 2026-07-20: Initial repository publication - passed; initialized local `main`, committed 105 files as the research/product baseline, created private `fourtytwo42/Robyn`, pushed through the authenticated VM, set `main` as default, and cloned the repository to `/home/hendo420/Robyn`.
- 2026-07-20: VM-only runtime decision - passed documentation review; `AGENTS.md`, README, PRD decisions, stack/infrastructure requirements, delivery mappings, research blueprint and user stories consistently require the `robyn` VM and prohibit Docker/containers.
- 2026-07-20: VM-native traceability - passed; `python3 scripts/validate-user-stories.py` ran on the VM and reports 151 stories covering 178/178 requirements, including new PM2/systemd, native-service, self-hosted-runner and VM-hosted-RPC requirements.
- 2026-07-20: Docker status after policy decision - no containers or images existed; `docker.service`, `docker.socket` and `containerd.service` were stopped and disabled. Packages remain installed for reversible administration but are outside the project architecture.
- 2026-07-20: Initial repository content validation - passed; secret-pattern scan found no supplied VM password, GitHub token, private key, or password assignment in staged files; Python caches are ignored; `python scripts/validate-user-stories.py` reports 150 stories covering 170/170 requirements.
- 2026-07-20: VM provisioning - passed; confirmed Ubuntu 24.04.4 LTS host `robyn` at `192.168.50.250`, pinned its SSH ED25519 host key, expanded `/dev/ubuntu-vg/ubuntu-lv` online from 31 GiB to 62 GiB, and verified 60.8 GiB root capacity with 49.9 GiB available.
- 2026-07-20: VM toolchain - passed; installed official GitHub CLI and Docker apt repositories, checksum-verified official Node 24.18.0 binary, pnpm 11.15.1 through Corepack, and attestation-verified Foundry 1.7.1. Docker is active/enabled and the developer account has working non-sudo access.
- 2026-07-20: GitHub VM authentication - passed; GitHub CLI is authenticated to `github.com` as active account `fourtytwo42` with HTTPS Git protocol and `repo`, `read:org`, and `gist` scopes. `gh auth setup-git` configured Git credential helpers, `gh api user` returned `fourtytwo42`, and the credential file is owner-only mode `0600`.
- 2026-07-20: Corrected stale VM authentication record - the current SSH ED25519 fingerprint is `SHA256:O4LRivRcNlGWE74lz5ze0CbVKioUgzh3kBxAjHy++Bc`; authentication succeeded and supersedes the earlier failed-authentication entry below.
- 2026-07-20: Corrected VM target check - `192.168.50.250` has SSH open and presented pinned ED25519 fingerprint `SHA256:OQLIjyUlmwBA7T6cedgNV/hs8oqIW7jjl9piBfzIXag`. The supplied password for `hendo420` was rejected, so no remote commands or modifications occurred. The credential itself was not recorded.
- 2026-07-20: Static-IP availability probe - `192.168.50.250` produced no ICMP reply, PTR record, or ARP neighbor after active probing and is the recommended currently-unused VM address. Nearby `.249` and `.251` are occupied. Availability is point-in-time; reserve `.250` in DHCP or exclude it from the dynamic pool before relying on it as static.
- 2026-07-20: VM address recheck - blocked safely; `192.168.50.251` responds as `EPSONEA0557.silverbacks.cash` with ARP MAC `a4-d7-3c-ea-05-57`, TCP/80 and TCP/443 open, and TCP/22 closed. This is an Epson device, not the requested SSH VM. A read-only TCP/22 discovery check found other systems, but no credentials were tried against them and no remote changes were made.
- 2026-07-20: VM reachability check - blocked safely; `192.168.5.251` timed out for ICMP and TCP/22 from source `192.168.50.143`. `192.168.50.251` was independently identified as an Epson device and was not accessed. No password, secret or VM change was stored.
- 2026-07-20: technology-stack PRD validation - passed; STACK-001 through STACK-020 are uniquely defined and the PRD v0.3 index/decision register/platform/delivery documents consistently reflect the settled stack.
- 2026-07-20: stack story traceability - passed; 150 unique stories across ten epic files cover 170/170 PRD requirements including all 20 stack requirements.
- 2026-07-20: UI/UX PRD validation - passed; DESIGN-001 through DESIGN-018 are uniquely defined, PRD v0.2 indexes the visual system, and palette/typography/layout/component/motion/accessibility decisions are explicit.
- 2026-07-20: updated story traceability - passed; 134 unique stories across nine epic files cover 150/150 PRD requirements including all 18 design requirements.
- 2026-07-20: comprehensive user-story validation - passed; 119 unique stories across eight epic files cover 132/132 PRD requirements with zero uncovered or unknown requirement IDs.
- 2026-07-20: story artifact integrity - passed; validator compiles/runs, all story files are indexed, all local Markdown links and generated story anchors resolve, and no Unicode replacement markers exist.
- 2026-07-20: PRD set validation - passed; 10 Markdown files including index, 132 unique requirement definitions, all namespaces contiguous from 001, no broken local Markdown links and no Unicode replacement markers.
- 2026-07-20: PRD decision consistency - passed; R1 is Bags-first conditional crypto adapter with Merkle epochs, R2 adds gated Stock Tokens, R3 is optional native transfer-aware accounting, baskets are immutable 1-3 assets and product language remains nonredeemable fee-funded rewards.
- 2026-07-20: deep live-contract audit - passed with warnings; generated `live-contract-audit.json` from public RPC/Blockscout and documented verified/proxy/license/ABI/read-only state across Vladdy, Alloy, HoodETF, BASKET, IndexPad, Bags and pons.
- 2026-07-20: Vladdy execution-state check - completed; 4 launches all use 5% stock mode and all report zero stock reserve/purchased/distributed. Verified source shows a trusted-agent fallback and no canonical registry enforcement.
- 2026-07-20: Alloy clean-checkout reproduction - failed as a production-reuse gate; no lockfile, TypeScript 7 incompatibility, then 0 passing/4 failing after temporary TypeScript 5.7.3 pin. Live old split is 0/100/0; keeper record malformed; index address has no code.
- 2026-07-20: competitor raw-event scan - passed; bounded `eth_getLogs` scan produced 3,066 Bags creation events and 64,602 pons launch events. Counts explicitly exclude active-user/liquidity/revenue claims.
- 2026-07-20: Stock Token market snapshot - passed with liquidity warning; 96 canonical assets, 70 discovered USDG pairs, 59 below $10k displayed liquidity and only 6 at/above $50k. Anonymous 0x and 1inch calls returned 401, so firm execution remains unverified.
- 2026-07-20: reward-economics scenario generation - passed; model records gross fee capture and execution-loss sensitivity without representing it as APY or promised return.
- 2026-07-20: final research artifact validation - passed; all research JSON parses, all Python scripts compile with the bundled runtime, all local Markdown links resolve, no Unicode replacement markers were found, and reports 13-15 are indexed from README.
- 2026-07-20: IndexPad-like competitor refresh - passed; reviewed first-party pages for Vladdy, Alloy, IndexPad, HoodETF, BASKET Protocol, Vimen, HOODL, Skep, hMAG7, HoodStocks, HoodStrategy, HOODETF, DIVIDENDS and FEES/MacroHard and documented live, pre-launch and unverified distinctions.
- 2026-07-20: competitor contract status check - passed with warnings; Blockscout address API returned contract and verified for Vladdy factory/hook and BASKET factory, contract but not verified for HoodETF factory and Alloy's current launchpad address.
- 2026-07-20: competitive-gap correction - passed; Robyn's remaining gap is weighted multi-asset fee-funded holder rewards, not generic Stock Token dividends or permissionless redeemable baskets.
- 2026-07-20: build-versus-reuse research - passed; reviewed official/deployed integration surfaces for Alloy, IndexPad, Bags, pons, Vimen, Uniswap Liquidity Launcher, OpenZeppelin, 0x, Chainlink and Safe and documented direct-call, library, fork, API and reference-only boundaries.
- 2026-07-20: Alloy provenance check - passed; repository is MIT, reviewed head `ffbc72de1aa3ea4b354916c06e178250dfb74d27`, mainnet addresses are published, and source contains transfer-aware single-reward accounting. Public audit report is unavailable, zero-minimum-output swaps and arbitrary reward addresses remain unacceptable production defaults.
- 2026-07-20: IndexPad source/deployment check - completed with warnings; official docs list mainnet/testnet contracts, Blockscout exposes MIT-tagged partially verified mainnet source, linked GitHub returned 404, no professional audit exists, and published routing still assumes Stock Token AMM liquidity that the project itself says must be adapted.
- 2026-07-20: Safe deployment check - passed; the canonical safe-deployments repository contains chain ID 4663 for v1.4.1 Safe L2, proxy factory, MultiSend, MultiSendCallOnly and fallback handler.
- 2026-07-20: live Blockscout address verification - passed; Bags factory, pons factory, Alloy launchpad, IndexPad factory, Safe L2 singleton, Safe proxy factory and Uniswap v4 PoolManager all returned `is_contract=True` and `is_verified=True`.
- 2026-07-20: reusable-contract report validation - passed; report is linked from README and the architecture and blueprint documents point to it.

- 2026-07-20: documentation coverage audit - passed; all ten research reports, saved screenshot and JSON evidence sets, and seven reproducibility scripts are indexed from README or the relevant research report.
- 2026-07-20: Robinhood Chain Testnet live check - passed; `eth_chainId` returned `0xb626` (`46630`), `eth_blockNumber` returned live height `91,820,526`, explorer returned HTTP 200, and RPC CORS preflight returned HTTP 204 with `POST`, `content-type`, and wildcard origin allowed.
- 2026-07-20: testnet documentation gap check - completed; no official public testnet ETH faucet, canonical testnet Stock Token registry, or official testnet token-address table was located in the current Robinhood Chain documentation.
- 2026-07-20: documentation validation - passed; all local Markdown targets resolve, all project Markdown files contain no Unicode replacement marker, both terms-research JSON files parse, and all MJS scripts pass `node --check`.
- 2026-07-20: Robinhood Chain and Stock Token terms study - passed; reviewed the official RHDA Chain Terms, permissionless-chain statement, Stock Token developer guides, RHJ issuer site, Product, FAQ, restricted-jurisdiction notice, Use of Website, 2026-06-30 Base Prospectus, and Final Terms library.
- 2026-07-20: smart-contract use-case verification - passed; Robinhood's official guide expressly names indices and baskets, yield vaults, lending, trading interfaces, conditional contracts, perps, and derivatives and shows standard ERC-20 transfer and approval operations.
- 2026-07-20: RHJ transfer-restriction verification - passed; Base Prospectus confirms beneficial-owner certification, selling restrictions, legal-transfer conditions, issuer block/freeze/pause/seizure/update powers, possible void transfers, and loss of rights for Prohibited Investors.
- 2026-07-20: Robinhood terms document validation - passed; `research/10-robinhood-chain-and-stock-token-terms.md` is 250 lines, linked from README, and contains no invalid Unicode replacement marker.
- 2026-07-20: launchpad terms comparison - passed; reviewed official terms or first-party notices for all 13 launchpads and documented effective dates, eligibility and geography, creator duties, prohibited conduct, disputes, risk allocation, public-document gaps, Robyn requirements, and adapter questions.
- 2026-07-20: legal-link discovery - passed; fresh anonymous browser sessions checked homepages, menus, footers, and selected token pages. No public platform terms were located for Clanker or pons; Four.meme exposed a disclaimer only; SunPump exposed no clearly linked SunPump-specific terms.
- 2026-07-20: terms document validation - passed; `research/09-launchpad-terms-comparison.md` is 179 lines, is linked from README, and contains no invalid Unicode replacement marker.
- 2026-07-20: launchpad subpage capture - passed; 22 public logged-out states captured at 1440 by 900 across Pump.fun, Bags, Four.meme, Clanker, hood.fun, pons, Virtuals, and BONKfun.
- 2026-07-20: launchpad subpage visual QA - passed; four contact sheets and all represented flows were inspected. No terms were accepted, wallet connected, CAPTCHA attempted, or transaction initiated.
- 2026-07-20: public-flow limitations verified - Pump and hood.fun preserve first-visit gates; Virtuals token launch requires login and agent creation exposes only an unconnected shell; pons did not expose a public creation form or token-detail destination in the anonymous session.
- 2026-07-20: cross-chain launchpad screenshot capture - passed; 13 PNGs captured at 1440 by 900 for Pump.fun, Bags, Believe, BONKfun, DAOS.FUN, Clanker, Zora, Four.meme, PinkSale, SunPump, Virtuals, pons, and hood.fun.
- 2026-07-20: launchpad visual QA - passed; all individual captures and both labeled contact sheets were inspected. PinkSale is intentionally represented by its Cloudflare human-verification page; no CAPTCHA or terms gate was accepted.
- 2026-07-20: launchpad study integration - passed; `research/07-cross-chain-launchpad-ux-study.md`, capture metadata, reproducible scripts, and the README index entry are present.
- 2026-07-20: public RPC browser-access check - passed; mainnet endpoint CORS preflight returned HTTP 204 and allowed cross-origin POST with the content-type header. Robinhood documentation still labels the endpoint rate-limited and unsuitable as the sole production dependency.
- 2026-07-20: permissionless-access policy propagation - passed; README, product architecture, risk analysis, product blueprint, and MEMORY now consistently exclude active eligibility enforcement from current scope.
- 2026-07-20: product blueprint validation - passed; 337 lines, no invalid replacement characters, no missing relative links, and README and MEMORY entries confirmed.
- 2026-07-20: Robinhood RHJ asset API query - passed; returned 96 active assets on chain ID 4663.
- 2026-07-20: registry snapshot comparison - passed; all 96 documented symbols and contract addresses matched the live API.
- 2026-07-20: key asset check - passed; `NVDA` and `SPY` present; `XYZ`, `SQ`, and `HOOD` absent.
- 2026-07-20: Markdown relative-link check - passed; all local `.md` targets resolve.
- 2026-07-20: encoding-marker scan - passed with no invalid replacement markers in project Markdown.
- 2026-07-20: `git status --short` and `git rev-parse --show-toplevel` - failed because this folder is not a git repository.
- 2026-06-18: `git status --short` - failed because this folder is not a git repository or is not inside one.
- 2026-06-18: `Get-Content -Raw .\agents.md` and `Get-Content -Raw .\memory.md` - passed; confirmed original lowercase memory-system files were readable after edits.
- 2026-06-18: `Get-ChildItem -Force` - passed; confirmed `AGENTS.md` and `MEMORY.md` exist after the case-safe rename.
- 2026-06-18: `Get-Content -Raw .\AGENTS.md` and `Get-Content -Raw .\MEMORY.md` - passed; confirmed uppercase files are readable after rename.
- 2026-06-18: `rg --files -g '*.md'` - passed; confirmed only `MEMORY.md` and `AGENTS.md` are present as Markdown files.
- 2026-06-18: `rg -n "agents\.md|memory\.md" .\AGENTS.md` - passed with no matches; confirmed operational instructions use uppercase filenames.

## Decisions

### 2026-07-21 - Art-Forward Launchpad Visual System

- Context: The first production-shaped UI communicated protocol state well but resembled an infrastructure dashboard and lacked the token artwork, dense market discovery and branded creation flow common to Pump.fun, Bags, Four.meme, pons, DAOS.FUN and other reviewed launchpads.
- Decision: Keep the dark navy, teal, violet and gold system, but lead with square token art, compact real-market cards, a dedicated `/create` route, visual reward-asset tiles and artwork on detail/portfolio/registry surfaces. Curated demo art maps by token symbol; unknown permissionless symbols use a generic visual fallback until durable custom metadata is implemented.
- Files: `apps/web/public/assets/launchpad/`, `apps/web/src/components/launchpad-visuals.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/app/discover/page.tsx`, `apps/web/src/app/create/page.tsx`, `apps/web/src/app/launches/[token]/page.tsx`, `apps/web/src/app/globals.css`.
- Commands/tests: VM Prettier and web typecheck; Codex in-app-browser desktop and 390x844 checks through the isolated PM2 preview.
- Result: all seven indexed demo launches have visible artwork via ROBYN, MYCO, EVID, ONE and SOAK mappings; the three reward assets have dedicated visuals; canonical cards link to real launch pages without invented market metrics.
- Follow-up: implement durable creator-uploaded token metadata as a separately threat-modeled artifact/API feature; do not imply the current fallback is a persisted custom upload.

### 2026-07-21 - Native Protocol Core Uses Fixed Router And Transfer Corrections

- Context: The controlled devnet needs a complete launch-to-claim accounting seam before market, data-plane and web work can be trusted.
- Decision: Deploy each launch as a fixed-supply ERC-20 plus an isolated immutable-weight vault. The vault fixes its base asset, conversion router and reward outputs; public callers can trigger only bounded per-leg operations. The token uses magnified per-share corrections on every transfer and pull claims.
- Decision: Measure fee receipt, conversion output and final reward-token deposit independently. Failed legs revert atomically and cannot reallocate weight or block other legs.
- Files: `packages/contracts/src/RobynLaunchFactory.sol`, `packages/contracts/src/FeeBasketVault.sol`, `packages/contracts/src/RobynLaunchToken.sol`, `packages/contracts/test/RobynProtocol.t.sol`, `docs/protocol-core.md`.
- Commands/tests: `forge test --root packages/contracts -vv`; `forge build --root packages/contracts --sizes`.
- Result: 16 tests pass, including two 256-run fuzz properties; OpenZeppelin Contracts is pinned to 5.4.0.
- Follow-up: Add formal handler invariants, malicious callback fixtures, mock market/fee source, deployment manifest and shared-devnet/browser integration. Contracts remain unaudited and must not hold real value.

### 2026-07-20 - Controlled Anvil Devnet And Browser Release Gates

- Context: Robinhood Testnet ETH has no documented public faucet, while development needs deterministic funding and complete user-flow validation.
- Decision: Use native Anvil chain ID 31337 on the VM, with loopback privileged RPC, a restricted LAN gateway, controlled faucet, persistent shared state and separate ephemeral automated-test chains. Hardhat Network is not selected.
- Decision: Accept every user-facing story through the Codex in-app browser at desktop, tablet and mobile viewports, without replacing lower-level correctness tests.
- Decision: Commit and push from the VM after every major validated change; incomplete or risky work stays on feature branches and `main` remains deployable.
- Files: `docs/devnet-to-testnet-readiness-plan.md`, VM operations, PRDs, stories and traceability.
- Result: A complete planning-only path now runs from the documentation-only repository through a production-shaped controlled-devnet release candidate and Robinhood Testnet migration package.
- Follow-up: Do not start implementation until authorized; then execute the plan's bounded first slice.

### 2026-07-20 - Application and Developer Stack Settled (VM runtime updated)

- Context: The user accepted the recommended application stack and requested corresponding PRD updates.
- Decision: Use pnpm/Turborepo; Next.js 15/React 19/strict TypeScript/Tailwind v4/Radix-shadcn/viem-wagmi frontend; Fastify with VM-native PostgreSQL/Drizzle, Redis/BullMQ and MinIO; Solidity/Foundry/OpenZeppelin; Vitest/Testing Library/Playwright; OpenTelemetry/local structured errors/Prometheus/Grafana; PM2/systemd; and a self-hosted GitHub Actions runner on the VM. Docker/containers are prohibited and the workstation is control-only.
- Files: `prd/10-technology-stack-and-repository-architecture.md`, related platform/delivery/decision PRDs, and `user-stories/10-technology-stack-and-developer-platform.md`.
- Commands/tests: Regenerated traceability on the VM with `python3 scripts/validate-user-stories.py`; validated unique requirements/stories, links, anchors and encoding.
- Result: 24 stack requirements and the updated stack/infrastructure stories make VM-native repository scaffolding and engineering boundaries implementation-ready.
- Follow-up: Scaffold `US-STACK-001` on the VM; install native services and persistent PM2 processes only when their implementation slice begins.

### 2026-07-20 - Dark-First Basket-Forward Visual System

- Context: The user asked whether palette and UI/UX decisions existed, then directed that the recommended direction be added to the PRDs.
- Decision: R1 uses a dark-first restrained onchain-capital design with deep navy canvas, teal primary, violet secondary, gold pending/reward accent, semantic status tokens, Inter/IBM Plex Mono typography and accessible non-color-only states. The asset basket is the dominant visual concept; the final logo remains open.
- Files: `prd/09-ui-ux-visual-design-system.md`, `prd/00-product-brief-and-decisions.md`, `user-stories/09-ui-ux-and-design-system.md`.
- Commands/tests: Regenerated traceability with `python scripts/validate-user-stories.py`; validated requirement/story coverage and links.
- Result: 18 design requirements and 15 design stories now make the visual direction testable.
- Follow-up: Produce CSS/design-tool tokens, wireframes, component-state inventory and clickable desktop/mobile prototype before frontend implementation.

### 2026-07-20 - Traceable User Stories Become the Delivery Backlog

- Context: The user requested a comprehensive user-story set derived from the implementation-ready PRDs.
- Decision: Use `user-stories/` as the delivery backlog. Stories have stable IDs, personas, release/priority, PRD mappings, dependencies and acceptance criteria. `TRACEABILITY.md` is generated and must remain at 100% PRD coverage.
- Files: `user-stories/README.md`, eight epic files, `user-stories/TRACEABILITY.md`, `scripts/validate-user-stories.py`.
- Commands/tests: Ran `python scripts/validate-user-stories.py`, Python compile, link/anchor/index and encoding validation.
- Result: 119 stories cover every one of the 132 PRD requirements; R0/R1/R2/R3 and external evidence gates are represented explicitly.
- Follow-up: Prioritize and assign R0/Milestone 1 stories before implementation; rerun the validator whenever PRDs or stories change.

### 2026-07-20 - PRDs Become the Product-Intent Source of Truth

- Context: The user requested a set of PRD documents after completing extensive feasibility and ecosystem research.
- Decision: Use `prd/00-product-brief-and-decisions.md` as the authoritative decision register, followed by the master PRD and relevant subsystem PRD. External facts still come from fresh deployed evidence and research.
- Files: `prd/README.md`, `prd/00-product-brief-and-decisions.md` through `prd/08-analytics-and-experimentation.md`, `README.md`.
- Commands/tests: Parsed all Markdown links, scanned encoding, extracted requirement definitions and checked duplicate/contiguous IDs.
- Result: 132 requirements across 13 namespaces, four release stages, risk-first delivery gates and ten end-to-end acceptance scenarios are ready for review and ticket decomposition.
- Follow-up: Resolve the explicit open product decisions, assign owners and implement Milestone 1 spikes before building the broad application.

### 2026-07-20 - Selective Reuse Replaces a From-Scratch Build

- Context: The user requested extensive research into existing contracts and infrastructure that can be reused.
- Decision: Use Alloy's MIT-licensed transfer-aware reward accounting as the native Robyn token starting point, OpenZeppelin for generic primitives, RHJ and Chainlink for canonical assets and prices, 0x for Stock Token quote execution, and Safe plus a timelock for administration. Keep Bags as the fastest adapter route if Merkle reward epochs are acceptable. Do not depend on or fork IndexPad without obtaining its complete source and provenance.
- Files: `research/11-reusable-contracts-and-infrastructure.md`, `research/03-product-feasibility-and-architecture.md`, `research/06-launchpad-product-blueprint.md`, `README.md`.
- Commands/tests: Checked current official documentation, GitHub repository metadata and licenses, GitHub Actions state, Safe deployment manifests, Bags ABIs, and Blockscout verified source.
- Result: The custom Solidity surface can be reduced to multi-asset weighted reward accounting, guarded fee conversion, immutable basket configuration, asset/oracle policy and thin launch glue. A new AMM, oracle, quote optimizer, ERC-20 base, multisig, timelock, clone library or Merkle proof implementation is not required.
- Follow-up: Reproduce Alloy locally, obtain its claimed audit report, run Bags and 0x contract-wallet spikes, then choose the adapter or native route.

### 2026-07-20 - Fresh Contract Evidence Narrows Selective Reuse

- Context: The prior reuse decision assumed Alloy could be the direct native-code starting point and that live verified contracts broadly matched published descriptions.
- Decision: Independently implement the bounded multi-asset accumulator using pinned OpenZeppelin primitives, with Alloy and Vladdy used as behavioral/mathematical references. Do not fork Vladdy without an explicit license; do not deploy Alloy unchanged or depend on its old deployment. Test Bags first and pons second as external adapter integrations.
- Files: `research/13-live-contract-and-integration-due-diligence.md`, `research/14-liquidity-traction-and-economics.md`, `research/15-security-legal-operations-validation-plan.md`, `README.md`.
- Commands/tests: Public RPC/Blockscout audit, bounded factory-event scans, canonical registry/market snapshot, anonymous aggregator probes, and clean-checkout Alloy compile/test reproduction.
- Result: The next authorized implementation should be only a three-asset accounting harness plus a funded Bags compatibility spike, not a complete launchpad.
- Follow-up: Obtain aggregator credentials and written integration/legal answers; perform funded spikes and 30-day quote sampling.

### 2026-07-20 - Testnet Proof Uses Mocks Until Official Test Assets Are Published

- Context: The user requested that testnet and any previously undocumented research be added to the repository.
- Decision: Use Robinhood Chain Testnet at chain ID 46630 for the accounting proof, but deploy project-owned mock assets, feeds, and issuer controls rather than assuming mainnet Stock Token contracts exist there.
- Files: `README.md`, `research/01-chain-and-assets.md`, `research/06-launchpad-product-blueprint.md`, `research/07-cross-chain-launchpad-ux-study.md`, `research/08-launchpad-subpage-ux-study.md`, `research/09-launchpad-terms-comparison.md`.
- Commands/tests: Live JSON-RPC chain and block queries, explorer HTTP check, CORS preflight, local Markdown link and encoding checks, JSON parsing, and MJS syntax checks.
- Result: Testnet is live and browser-accessible. Deployment remains blocked on obtaining test ETH; no official faucet or canonical testnet Stock Token registry was located.
- Follow-up: Ask Robinhood Chain or a supported infrastructure provider for test ETH and current test asset addresses before deploying.

### 2026-07-20 - Stock Token Composability Is Technically Supported but Distribution Is Restricted

- Context: The user asked whether Robinhood has terms for entities or smart contracts that interact with tokenized stocks.
- Decision: Treat Robinhood Chain, RHDA-hosted Chain Services, and RHJ Stock Tokens as three separate layers. Smart-contract composition is expressly supported, but Stock Token holder, beneficial-owner, offer, sale, delivery, and jurisdiction restrictions remain controlling.
- Files: `research/10-robinhood-chain-and-stock-token-terms.md`, `README.md`.
- Commands/tests: Reviewed current official Robinhood Chain and RHJ pages plus the June 30, 2026 Base Prospectus and Final Terms library; validated the Markdown artifact and README link.
- Result: No public special launchpad license was located. A Robyn basket vault is a documented technical pattern, but a permissionless Stock Token claim cannot determine whether each recipient is a U.S. Person or other Prohibited Investor. A smart contract does not bypass beneficial-owner rules or issuer enforcement powers.
- Follow-up: Send the documented architecture questions to `chain-developers-group@robinhood.com` and `contact.rhj@robinhood.com`; keep first production release crypto-only until RHJ treatment of contract-held tokens and changing beneficiaries is clarified.

### 2026-07-20 - Launchpad Terms Requirements Documented

- Context: The user requested terms research for every launchpad in the cross-chain UX study.
- Decision: Use the competitor terms as design evidence, not as legal clearance. Robyn's agreement must distinguish interface from protocol, impose creator accuracy, IP, anti-manipulation and lawful-use representations, accurately describe variable nonredeemable rewards, disclose basket and third-party risks, and include complete entity, privacy, liability, indemnity and dispute provisions.
- Files: `research/09-launchpad-terms-comparison.md`, `README.md`.
- Commands/tests: Inspected live legal links and dynamic pages in fresh anonymous browser sessions; checked official web sources; validated file encoding and README linkage.
- Result: DAOS.FUN expressly excludes U.S. users; the older general SUN.io terms do as well but their SunPump coverage is ambiguous. Clanker and pons lack discoverable public platform terms, and Four.meme provides only a disclaimer. These are integration diligence issues, not evidence of unrestricted use.
- Follow-up: Have counsel draft Robyn-specific terms after the operating entity and contract architecture are fixed; obtain written integration and contract-recipient permission from the chosen upstream launchpad.

### 2026-07-20 - Cross-chain Product Pattern Selected

- Context: The user requested a broad visual and product study of launchpads across Solana, EVM, TRON, Robinhood Chain, and adjacent creator markets.
- Decision: Position Robyn as a portfolio-building token launchpad, not a generic no-code memecoin deployer. Keep the launch flow short, make the immutable one-to-three-asset basket visible above the fold, and foreground fees invested, reward-vault balances, and holder claimables.
- Files: `research/07-cross-chain-launchpad-ux-study.md`, `research/screenshots/launchpads/`.
- Commands/tests: Captured and visually inspected 13 live main pages at 1440 by 900; checked official product documentation for fee and launch mechanics.
- Result: Four.meme is the closest configurable allocation precedent, Pump Cashback and hood.fun validate redirecting creator-fee value to users or holders, Bags remains the strongest adapter candidate, and no reviewed interface offers a creator-selected external multi-asset basket funded by future creator fees.
- Follow-up: Use the recommended homepage, creator wizard, token page, and portfolio page as the implementation brief after the Bags compatibility spike.

### 2026-07-20 - Public RPC First, Minimal Shared RPC

- Context: The user wants RPC costs minimized and proposed leveraging the public endpoint from each user's browser.
- Decision: Use Robinhood's public RPC directly for normal client reads and wallet traffic. Do not proxy routine calls through the backend. Maintain one small archive-capable provider only for the indexer, Merkle epochs, keeper, and monitoring, plus an origin-restricted or method-limited fallback for degraded public-RPC conditions.
- Files: `research/06-launchpad-product-blueprint.md`.
- Commands/tests: Official connecting documentation checked; live CORS preflight to the public mainnet RPC returned HTTP 204 with `Access-Control-Allow-Origin: *` and `POST` allowed on 2026-07-20.
- Result: Central RPC consumption is limited to correctness-critical background workloads rather than scaling with every UI user.
- Follow-up: During implementation, measure actual throttling behavior and select the cheapest archive-capable fallback tier that supports the epoch indexer's log volume.

### 2026-07-20 - Permissionless Access Without Eligibility Enforcement

- Context: The user directed the project to assume users are non-U.S. and not actively block anyone for now.
- Decision: Do not implement KYC/KYB, IP geoblocking, wallet allowlists or denylists, eligibility attestations that block transactions, or onchain claim restrictions. Launch, harvest, and claim contracts remain permissionless. Show accurate non-blocking disclosures and retain an optional future extension point.
- Files: `research/06-launchpad-product-blueprint.md`, `README.md`.
- Result: Eligibility enforcement is removed from the current engineering scope. This product assumption does not resolve issuer restrictions or legal exposure.
- Follow-up: Build the permissionless technical system as directed; continue legal and entity review in parallel without treating it as technical authorization.

### 2026-07-20 - Concrete Launchpad MVP Defined

- Context: The user asked what the product should look like and what is required to build it.
- Decision: Present a branded launchpad UI but use Bags underneath for the first release. Route 100% of the upstream creator-fee share to an immutable one-to-three-asset basket. Use time-weighted Merkle epochs for adapter holder accounting, then transfer-integrated accounting in a later native launchpad.
- Files: `research/06-launchpad-product-blueprint.md`, `README.md`.
- Result: The creator flow, token and portfolio pages, contract set, offchain services, integrations, security controls, legal gates, release sequence, staffing, and MVP acceptance condition are specified.
- Follow-up: Run the Bags contract-recipient integration spike before implementation; operating-jurisdiction review proceeds in parallel and does not add an active eligibility gate under the current decision.

### 2026-07-20 - Fee-Funded Reward Model Recommended

- Context: The proposed launch token would direct creator fees into a selected portfolio for holders.
- Decision: Recommend a reward-bearing community token for the initial product. Reserve “backed” for a separate, redeemable vault-share model.
- Files: `README.md`, `research/03-product-feasibility-and-architecture.md`.
- Result: The product remains differentiated from Vimen's already-live redeemable basket factory.
- Follow-up: Choose adapter versus native implementation.

### 2026-07-20 - Existing Launchpad Adapter First (Partially Superseded)

- Context: pons, Bags, hood.fun, and other launchpads already provide token creation, liquidity, and creator fee streams.
- Decision: Validate a Bags or pons fee-recipient adapter before building a new curve, AMM, or locker. The later reuse audit adds a parallel native route based on Alloy's MIT accounting and existing Uniswap infrastructure; Bags is no longer the only preferred MVP architecture.
- Files: `research/02-launchpads-and-competition.md`, `research/03-product-feasibility-and-architecture.md`.
- Result: Bags is the clearest documented adapter path; pons needs contract-wallet payout testing.
- Follow-up: Run fork or testnet compatibility tests if implementation is authorized.

### 2026-07-20 - Stock Token Release Is Conditional (Partially Superseded)

- Context: RHJ Stock Tokens are restricted tokenized debt securities, not wrapped shares.
- Decision: Prototype with mocks and launch crypto-only before adding Stock Tokens. The earlier requirement for active eligibility controls before release is superseded by the 2026-07-20 permissionless-access decision. Reliable RFQ execution, oracle guards, correct accounting, and an audit remain required engineering gates; legal review continues in parallel.
- Files: `research/01-chain-and-assets.md`, `research/04-regulatory-security-and-risks.md`.
- Result: RWA mainnet work is a conditional phase, not the MVP.
- Follow-up: Obtain jurisdiction and operating-entity decisions.

### 2026-06-18 - Memory System Initialized

- Added `agents.md` with instructions for future agents to read this file often and keep it updated. Superseded 2026-06-18 by uppercase `AGENTS.md`.
- Treat `MEMORY.md` as the repository-local source of retained context when chat history is incomplete, compressed, or ambiguous.
- Store durable project decisions, setup notes, known issues, test results, follow-ups, and user preferences here.
- Do not store secrets, tokens, passwords, private keys, or sensitive personal data.

### 2026-06-18 - Memory Structure Expanded

- Expanded `AGENTS.md` with startup, checkpoint, compression recovery, entry quality, and final-response rules.
- Structured `MEMORY.md` into durable sections for current state, preferences, setup, decisions, known issues, completed work, open follow-ups, and high-priority reminders.
- Correction 2026-06-18: previous lowercase filename preference was superseded by the user request to use uppercase `AGENTS.md` and `MEMORY.md`.

### 2026-06-18 - Handoff And Verification Rules Added

- Added `Active Handoff`, `Project Map`, `Verification Ledger`, `Source Of Truth`, `Freshness Rules`, and `Privacy Rules`.
- Updated `AGENTS.md` to require reading `Active Handoff` during startup and compression recovery.
- Added email-specific privacy rules because Outlook/Office 365 may be part of the project workflow.

### 2026-06-18 - Uppercase Memory Filenames

- Decision: use uppercase `AGENTS.md` and `MEMORY.md` for stronger agent discovery and consistency.
- Context: the user explicitly requested uppercase names for both files.
- Result: Windows case-safe rename completed and uppercase files were verified by readback.

## Known Issues

- Robinhood Chain launched on 2026-07-01, so launchpads, asset lists, fees, contracts, and liquidity are highly volatile and must be reverified before implementation.
- Block, Inc. / Cash App is not in the 2026-07-20 canonical Stock Token registry as `XYZ` or `SQ`.
- Vimen already offers permissionless, immutable, redeemable Stock Token baskets, and hood.fun already offers creator-fee rewards to holders.
- The hood.fun whitepaper and terms conflict on whether community-mode holder rewards are automatically sent or claimed onchain; deployed contracts must decide any integration assumption.
- The canonical Stock Token implementation is beacon-upgradeable and includes role-based pause, mint, burn, and `adminBurn` controls.

## Completed Work

- 2026-07-21: Aligned the homepage token showcase with the Markets information model while preserving its larger visual treatment and unique curated token art. Rich mobile cards switch to one column below 680px for legible metrics and artwork.

- 2026-07-21: Anchored every discovery-card `View market` action to the bottom of its stretched grid card, preserving a consistent gap without forcing lifecycle placeholders or artificial basket rows.

- 2026-07-21: Implemented a Pump/Circus-style native launch lifecycle for the controlled network: constant-product bonding trades, reserve-derived progress, exact final-buy refund, automatic atomic graduation, a pre-bound no-withdrawal local pool, cross-phase basket fees, lifecycle analytics and complete create/discovery/detail/trade UI. This local pool is a rehearsal dependency, not the Robinhood-testnet production AMM adapter.

- 2026-07-21: Added transparent demo-only market movement for every controlled-devnet ticker entry without mutating chain state. The feature is explicitly enabled only on chain 31337, ignored on testnet/mainnet, labeled in API/UI, built from pushed commit `44014804bff3aad89fa2e2aebc0fbc416e0e72b6` and verified through the public in-app browser.

- 2026-07-21: Converted the global ticker from reward-asset counts to market cap and indexed percentage change, documented the production-preview build/run procedure, rebuilt the API and optimized Next app from pushed commit `e5948bf2a69262964f3939d42ab0e76567d24feb`, persisted the PM2 topology and verified the public result in the in-app browser.

- 2026-07-21: Captured six current Circus pages/treatments, documented the reusable patterns and non-copy boundaries, updated the visual PRD, and shipped the dark Robyn hybrid in `dfd099e08459b695a310186388b80a4d1af09daa`. Full repository, devnet build, protected-testnet build and in-app-browser desktop/mobile acceptance passed.

- 2026-07-21: Added and deployed the public demo route in `4201a6d1cb1f0b11d169a0275d4cd398c8aec837`: checksum-verified cloudflared package, hardened persistent systemd Quick Tunnel, loopback Nginx preview edge, same-origin RPC/faucet routing, PM2-persisted preview environment and operations documentation. Public in-app-browser testing proved live reads and a faucet write without changing the stable LAN release.

- 2026-07-21: Redesigned discovery into a compact launchpad-style token browser with three/two/one responsive columns, undistorted square art, readable reward-asset symbols/names and canonical token-page links. `076e790242277de651e5cdaf00d75dc6a9b77601` removed pending/converted/block accounting; `ecf0a5f68c94cad3f0e2eacb38f27c42b5ed9678` added verified market cap, total volume and holder count through a bounded indexed summary path with an immutable-supply reconciliation fallback. Updated the design PRD, passed all gates and verified the live page through the in-app browser.

- 2026-07-21: Installed and verified the subnet-scoped native Nginx/UFW edge, loopback service topology, abuse/security gates, 180-second contention capacity run and guarded-vault malicious callback regression fixture.
- 2026-07-21: Installed and verified the native loopback monitoring stack, nine scoped alerts, dashboard, systemd hardening, incident runbooks and a live reversible fire/resolve drill.
- 2026-07-20: Added the IndexPad-like product refresh covering direct reward launchpads, mainnet basket factories, pre-launch projects and single-token fee-funded reward experiments.
- 2026-07-20: Completed the documentation coverage audit, added verified testnet operating details, and indexed all saved evidence and reproducibility scripts.
- 2026-07-20: Completed the Robinhood Chain Services, permissionless-network, RHJ securities, smart-contract, transfer-restriction, and Robyn architecture terms analysis.
- 2026-07-20: Completed the 13-platform terms, access, creator-obligation, risk, dispute, and adapter-diligence comparison.
- 2026-07-20: Completed the 22-state launchpad subpage and product-flow UX study with creation, trading, discovery, rewards, profile, portfolio, and authentication comparisons.
- 2026-07-20: Completed the 13-platform cross-chain launchpad product and UX study, including reproducible 1440 by 900 screenshots and two labeled contact sheets.
- 2026-07-20: Completed Robinhood Chain feasibility, asset, launchpad, architecture, regulatory, and security research.
- 2026-07-20: Captured and verified all 96 live canonical Stock Token and ETF addresses.
- 2026-07-20: Documented the competitive overlap with pons, Bags, hood.fun, Virtuals, Vimen, NOXA, Robinfun, HoodPad, and RobinPad.
- 2026-06-18: Created the repository-local memory system with `agents.md` and `memory.md`, then superseded the filenames with uppercase `AGENTS.md` and `MEMORY.md`.
- 2026-06-18: Added structured memory sections and stronger agent rules for context recovery and handoff.
- 2026-06-18: Added active handoff, project map, verification ledger, source-of-truth ordering, freshness rules, archive guidance, and email privacy rules.

### 2026-07-21 - Protocol hardening and protected testnet package

- Context: Production readiness required stateful financial properties and a fail-closed Robinhood Testnet package, not only unit happy paths.
- Decision: Keep production core separate from explicit TESTNET_MOCK_ONLY fixtures; require injected wallets in protected builds; refuse real-network unlocked accounts; make transaction and five-service rehearsals immutable release gates.
- Files: packages/contracts/src/testnet, packages/contracts/test/RobynProtocolInvariant.t.sol, scripts/deploy-testnet.sh, scripts/verify-testnet-deployment.sh, scripts/rehearse-testnet.sh, scripts/rehearse-testnet-stack.sh, scripts/build-testnet-candidate.sh, infrastructure/pm2/ecosystem.testnet.config.cjs, docs/testnet-operations.md, docs/protocol-security-review.md.
- Commands/tests: Foundry 28 unit/fuzz/adversarial tests; four invariant campaigns at 128 runs/depth 64; protected Next build marker scan; chain-46630 journey; isolated five-service rehearsal; security-audit.sh.
- Result: All passed; no unresolved critical/high. The actual public-testnet broadcast remains separately authorized and unfunded.
- Follow-up: Browser UAT exact protected candidate, final release/reboot/backup, uninterrupted 24-hour soak, human alert receiver and independent review before real-value use.

### 2026-07-21 - Protected testnet browser UAT and teardown correction

- Context: CLI rehearsals passed but in-app-browser acceptance was still mandatory.
- Decision: Expose an isolated chain-46630 candidate temporarily on LAN, test home/wallet failure/discovery/detail/portfolio/mobile state, then remove exact temporary edge, firewall, chain, database and PM2 resources.
- Files: apps/web/src/app/portfolio/page.tsx, apps/web/src/app/discover/page.tsx, scripts/deploy-testnet.sh, scripts/rehearse-testnet-stack.sh.
- Commands/tests: protected build, in-app-browser DOM and console checks, 390 by 844 overflow check, full monorepo gates, transaction rehearsal, five-service rehearsal and security audit.
- Result: Browser exposed portfolio 404 and stale copy; both were fixed. Teardown exposed comma-selector deletion failure; cleanup now uses explicit PM2 names and asserts none remain. Rehearsal passed afterward with no testnet processes and live devnet health preserved.
- Follow-up: push the fix commit and run the same exact-release gates during immutable build.

### 2026-07-21 - Keeper and manual-conversion race

- Context: On exact release c9807e1, the post-reboot browser funded and bought successfully, but the keeper consumed the pending fee before the user clicked Convert; the stale manual call reverted InsufficientPending.
- Decision: Re-read each leg immediately before submission; if submission errors, re-read again and treat it as success only when pending is now below the executable threshold. Rethrow every error while principal remains pending. Apply the rule to genesis and permissionless launch controls in both devnet and protected testnet modules.
- Files: apps/web/src/components/devnet-console.tsx, launchpad-console.tsx, network-console.testnet.tsx and network-launchpad.testnet.tsx.
- Commands/tests: web format/lint/typecheck/test/build; in-app-browser forced race after waiting beyond the keeper scan interval; signed buy, convert, three-asset claim and sell.
- Result: Passed with status explaining raced legs were already converted, pending zero, claim enabled, nonzero mNVDA/mSPY/mETH rewards, completed sell and zero browser warnings/errors.
- Follow-up: cut a new exact immutable release; c9807e1 is not the final candidate.

## Open Follow-ups

- Before Robinhood Testnet, independently review the implemented production graduation adapter, immutable LP locker, atomic coordinator and fee router; recheck for an official chain-46630 Uniswap deployment. If none exists, deploy and freeze the separately verified Robyn-controlled test-only DEX manifest before protocol broadcast.
- Complete independent browser-persona UAT when subagent runtimes expose the
  Codex in-app browser, or obtain an explicit product-owner waiver. Root-agent
  serialized UAT is complete but is not independent.
- Complete the one explicitly started uninterrupted eight-hour soak. Short
  harness regressions are not soak completion and must never be described as
  such.
- Configure and test a human alert receiver before unattended public-testnet or real-value operation; local Prometheus/Grafana alert state alone is insufficient.
- Obtain independent protocol/security review before real-value operation. Stateful invariants and malicious callbacks are now implemented, but the internal engineering review is not independent.
- Ask Vladdy whether the team will provide a repository/license and whether a native multi-asset mode is planned; current deployed contracts do not expose a safe weighted-basket seam.
- Reconcile Alloy's current `0x5a5f...10f2` launchpad and `0x0E9705...` index factory with the pinned MIT repository and its older published deployment before treating the repository as exact source for the current app.
- Obtain HoodETF and BASKET Protocol complete source repositories, licenses and audit status before considering code reuse; do not infer a copying license from Blockscout verification.
- Request Alloy's claimed audit report and resolve its contradictory audited/unaudited documentation; repair and pin the suite only if its source remains useful during implementation.
- Decide whether the MVP promise requires native transfer-aware accrual or accepts Bags plus time-weighted Merkle epochs. This is now the main architecture choice.
- If IndexPad reuse is reconsidered, obtain its complete source repository, dependency lock and commit provenance; do not rely on the currently inaccessible GitHub link or partially verified Blockscout bundle alone.
- Obtain authenticated 0x/1inch commercial access and verify contract-wallet execution for $100/$1,000/$10,000 Stock Token quotes, including allowance target, minimum output, expiry and balance deltas.
- Obtain Robinhood Chain Testnet ETH and confirm whether Robinhood or a supported provider operates a faucet or manual funding process.
- Recheck for official testnet WETH, USDG, Stock Token, ETF, registry, and oracle addresses before deploying; continue with mocks if none are published.
- Ask Robinhood Chain and RHJ in writing who is the Investor and beneficial owner when an immutable contract holds Stock Tokens for changing token holders, and whether permissionless holder claims are permitted.
- Clarify whether Robyn needs a developer, data, distribution, offeror, market-maker, commercial, or other agreement or authorization for the proposed flow.
- Have counsel draft Robyn-specific user and creator terms once the operating entity, jurisdictions, launch flow, basket contracts, fee mechanics and upstream adapter are fixed.
- Obtain the full current Bags agreement and written confirmation that a smart contract may receive creator fees and route them into holder rewards; obtain equivalent terms from pons if it remains a candidate.
- Run a Bags contract-recipient compatibility spike; keep pons as the next adapter candidate if Bags cannot safely route creator fees to the basket contracts.
- If implementation is authorized, begin on the controlled Anvil devnet and move to Robinhood Testnet only after the migration gates pass.
- Test whether pons creator fee claims and redirects work safely when the payout recipient is a smart contract.
- Confirm 0x or UniswapX commercial/API access and quote reliability for selected Stock Tokens.
- Continue legal advice for the operating entity, target jurisdictions, issuer restrictions, and reward-token classification in parallel; do not add active user restrictions unless the product decision changes.

## Do Not Forget

- Read `AGENTS.md` and `MEMORY.md` before making future changes in this workspace.
- `/home/hendo420/Robyn` on VM `robyn` is authoritative. Never run project code, builds, tests, services, databases, migrations, workers, RPC nodes, deployments or Git operations on the Windows workstation.
- Never use Docker, Docker Compose, Kubernetes, containers, container images or a container registry for this project.
- When Node services exist, persist them with a committed PM2 ecosystem, systemd startup integration and `pm2 save`, then verify after reboot.
- Run PostgreSQL, Redis, MinIO, monitoring, reverse proxy, any self-hosted CI runner and any project-operated RPC node natively on the VM under systemd.
- Backup jobs run on the VM, but recoverable backup copies must leave the VM failure domain.
- Update `MEMORY.md` after durable discoveries, decisions, fixes, verification results, blocked work, and handoffs.
- Never store secrets, tokens, passwords, private keys, or sensitive personal data in `MEMORY.md`.
- Requery the official RHJ registry and launchpad contract parameters before relying on the 2026-07-20 snapshot.
- Use native Anvil chain ID 31337 for the controlled Robyn Devnet; do not add Hardhat Network without an approved ADR.
- Never expose raw Anvil privileged methods to LAN/browser users. Keep automated test chains isolated from persistent shared devnet state.
- Run all user-facing acceptance through the Codex in-app browser and retain responsive DOM, screenshot, console/network and transaction evidence.
- Commit and push every major validated change from the VM; verify the remote SHA before declaring the checkpoint complete.
- Do not call Robinhood Stock Tokens wrapped shares or direct stock ownership.
- Do not market a nonredeemable fee-reward token as backed.
- Do not treat an onchain Stock Token transfer as legally valid merely because the ERC-20 transaction succeeded; RHJ Product Terms and selling restrictions control legal effectiveness and holder rights.
- Robinhood's public RPC is rate limited, expressly not production-grade, and may be throttled or discontinued. Browser-direct use is a best-effort cost optimization, not a correctness dependency.
- Treat Stock Token mainnet support as technically blocked on quote execution, oracle/accounting safety, and audit readiness. The current scope intentionally contains no active eligibility gate; this does not establish legal clearance.

## Archive

- No archived entries yet.

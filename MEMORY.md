# Project Memory

### 2026-07-27 - Discovery metrics refresh latency remediation

- Context: The ten-hour endurance run reached 5,762.053 healthy seconds on
  release `905060c`, but one sample every five minutes exceeded the 750 ms API
  p95 gate. Failed intervals correctly contributed zero healthy time.
- Cause: The launch-discovery metrics cache expired synchronously every 300
  seconds. Concurrent Home and Markets requests then recomputed all launch
  metrics through the LAN RPC, producing 0.8 to 2.0 second responses.
- Fix: Use a bounded keyed stale-while-revalidate cache for discovery metrics.
  Cached requests remain non-blocking while each launch-set key refreshes in
  the background after 60 seconds, with a 10-minute maximum age and four-entry
  least-recently-used bound.
- Evidence: The runner was stopped before modification and raw samples were
  preserved under `/var/lib/robyn/testnet-endurance/active/` with the
  `samples-before-status-refresh-remediation-*` prefix.
- Commands/tests: API tests 60/60, repository lint and typecheck, API build,
  formatting, and `git diff --check` pass.
- Follow-up: Commit and push, build and promote the exact release, verify
  repeated five-minute boundaries remain below 750 ms, then resume the same
  confirmed transaction journal without replay.

### 2026-07-27 - Endurance keeper queue and status-latency remediation

- Context: Run `schema10-e7ea0f4-10h-sw` was paused after direct BullMQ
  inspection found failed financial jobs that the API heartbeat did not
  expose. It later accumulated 1,170 healthy seconds on release `b619639` but
  recurring 1.0 to 4.7 second `/status` responses caused intermittent
  zero-credit intervals.
- Cause: The keeper operator was depleted, archived-deployment jobs remained in
  the shared queue, V4 scanner retries were immediate, and retrying jobs whose
  authoritative onchain work had already been consumed were not superseded.
- Funding: Recovered 0.002928487677177834 test ETH from a completed campaign and
  funded the keeper operator with 0.002 ETH. Transaction evidence is protected
  under the active endurance evidence directory.
- Fix: Reject archived jobs, supersede consumed work, back off V4 retries,
  publish queue and operator balance health, and gate endurance on both.
- Queue result: Release `b619639` is promoted, archived work is removed, active
  failed work is reconciled without transaction replay, and the queue is empty.
  Router liabilities are solvent and the operator retains more than its
  configured safety floor.
- Status latency cause: `/status` synchronously repeated roughly 100 LAN-RPC
  invariant reads across every launch, locker, and reward asset on every
  request. Public pages remained near 130 to 195 ms while the internal status
  request dominated the endurance p95.
- Status latency fix: Serve the last verified protocol snapshot while a
  single-flight background refresh runs. Force a blocking refresh after two
  minutes so stale health cannot remain indefinitely. Unit tests cover
  coalescing, background refresh, maximum age, and transient refresh failure.
- Live latency result: Release `ad372a7` reduced the internal `/status` p95 to
  7.8 ms across 20 samples. Home, Markets, and DAO p95 values were 98.8,
  111.8, and 82.0 ms. The release was promoted with 531 verifier checks.
- Endurance funding: The project wallet funded the keeper operator with another
  0.001 test ETH at 2026-07-27 15:58 UTC before it crossed its safety floor.
  The project wallet retained more than the required 0.0015 ETH reserve, and
  the receipt is protected in the active endurance evidence directory.
- Protocol gate correction: A transient reward-stream mismatch appeared in the
  API protocol snapshot, but the runner incorrectly credited that sample
  because it did not gate the additive protocol health fields. The sample was
  preserved, the runner stopped, and the policy now fails any degraded protocol
  status, insolvency, DAO stream discrepancy, phase/locker/reward mismatch, or
  unattributed native balance. A focused policy test covers every condition.
- Keeper dust correction: Two matured basket legs with one wei pending reached
  the maximum-delay path, but their native-to-asset quotes rounded to zero and
  became dead letters after six retries. The endurance clock stopped and the
  failed jobs were preserved. The scanner now preflights each executable native
  conversion and leaves unquotable dust queued onchain, superseding an existing
  failed queue entry without broadcasting. The worker shares the same quote
  usability rule, and focused tests cover zero, one-unit, and usable outputs.
- Protocol snapshot consistency: Reward-stream invariants could transiently
  disagree because the API read deposited, queued, streaming, and vested values
  at different moving chain heads. The corrected endurance gate safely rejected
  those samples. The protocol health collector now captures one block number
  and pins every router, DAO, market, hook, locker, balance, and reward read to
  that same canonical block before comparing conservation values.
- Route recovery: Two testnet basket routes reached their immutable reference
  deviation boundary after one-way campaign conversions. Protected evidence
  records direct Universal Router counter-trades from the encrypted project
  software wallet, the restored route state, and safe retries of quote-stage
  jobs that had never submitted transactions.
- Workload funding bug: The first endurance graduation paused after the actor
  was funded to an EIP-1559 gas estimate that omitted the chain's additional L1
  data cost. Add a separate 0.000025 ETH per-transaction L1 data reserve to the
  dynamic 25% gas headroom calculation. This does not reduce workload value or
  the project-wallet 0.0015 ETH reserve.
- Verification: Full repository tests, 165 Foundry tests, typechecks, lint, and
  builds passed for `b619639` and the exact `ad372a7` status-cache release.
  The funding fix requires its own clean release build and journal resume.

### 2026-07-27 - Software-wallet endurance startup repair

- Context: The completed final-assurance campaign root could not be decrypted
  because its original passphrase file was no longer available. No endurance
  transaction was submitted from that failed startup.
- Decision: Use a fresh dedicated encrypted 100-wallet root for endurance and
  retain the completed campaign only as checksummed prerequisite evidence.
  MetaMask, Robinhood Wallet, WalletConnect, extensions, and user-controlled
  wallets remain outside the final assurance workflow.
- Funding: Recovered 0.0018 testnet ETH from accessible, completed schema-v9
  campaign software wallets into the project wallet. The fresh fixed-workload
  preflight passes with the 0.0015 ETH reserve intact.
- Operations: The initial zero-healthy-time samples correctly paused on disk
  headroom, a service-restart alert, and repeated keeper restarts. Six verified
  superseded immutable releases were removed while preserving current and
  previous releases, restoring root headroom from 11 GiB to 20 GiB.
- Root cause: `robyn-keeper-testnet` normally uses about 445 MiB RSS but its PM2
  ceiling was 256 MiB, so PM2 repeatedly restarted an otherwise healthy keeper.
  Raise the declared and validated testnet keeper ceiling to 512 MiB, promote a
  fresh exact release, and resume the same zero-healthy-time journal.

### 2026-07-27 - Testnet promotion database inheritance fix

- Context: Promoting the software-wallet-only application checkpoint without an
  explicit `ROBYN_TESTNET_DATABASE` selected the script's stale schema-10
  default instead of the active final-assurance database. The verifier exposed
  one launch, one phase mismatch, and degraded protocol status.
- Decision: A promotion now uses an explicitly supplied database or inherits
  the active testnet PM2 database. If neither exists, it fails closed. Database
  names are restricted to alphanumeric characters and underscores.
- Result: Services were immediately rebound to
  `robyn_testnet_final_e6dd172`. Public status returned to nine launches, three
  King awards, six bonding pools, three trading pools, zero phase/locker/reward
  mismatches, solvent liabilities, and zero indexing lag. Contracts and chain
  state were unaffected.
- Files: `scripts/promote-testnet-release.sh`.
- Follow-up: Build and promote the corrected exact commit before endurance.

### 2026-07-27 - Software-wallet-only final acceptance

- Context: The user corrected the final assurance scope after a MetaMask
  transaction prompt was initiated during browser acceptance.
- Decision: Do not use MetaMask, Robinhood Wallet, WalletConnect, browser
  extensions, or other user-controlled wallets for the remaining testnet
  assurance. Use only the encrypted VM-only campaign wallets for signing and
  state-changing wallet tests. Browser acceptance remains automated,
  disconnected/read-only UI, responsive, accessibility, and error-state
  coverage.
- Result: The unsigned MetaMask request was never broadcast; LAN RPC showed
  equal latest and pending nonces for the connected address. Real-wallet
  acceptance is explicitly removed from the prerequisites for the ten-hour
  endurance run.
- Follow-up: Promote the exact application-only candidate, finish automated
  browser acceptance, then start the one-shot ten-accumulated-healthy-hour
  endurance run from the durable software-wallet journal.

### 2026-07-27 - Final public-testnet lifecycle campaign complete

- Context: Campaign `final-assurance-e458382` ran against the fresh security-remediated chain-46630 deployment through the LAN RPC.
- Result: All phases passed with 2,197 confirmed transactions and 1,997 product writes: 100 funded actors, eight immutable-metadata launches covering all 24 basket assets, 900 buys, 200 transfers, 150 approvals, 150 sells, three graduations and five bonding states, direct and routed v4 swaps, hook and LP fee settlement, 24 basket conversions, successful/defeated/cancelled governance, 20 holder claims, eight creator claims across all four public claim methods, ten streamed DAO claims, token/RDAO/native sweep, and the 0.0015 ETH reserve preserved.
- Evidence: One failed out-of-gas sweep receipt is retained as expected remediation evidence; it changed no state and the same logical action later passed with the corrected gas margin. `state.json`, `evidence.json`, and `deployment-verifier.json` have a verified `SHA256SUMS` manifest in the protected campaign directory.
- Verification: Fresh live deployment verification passes 531 checks with zero failures through `192.168.50.117:8547`.
- Reproducibility: Exact commit `817e52f69c4b48d37b3d450be408c38628780faf` built twice from clean archives with fresh pnpm stores. Application bundles, contract ABI/bytecode/storage layouts, operations, dependency graph, license inventory, and CycloneDX SBOM match, and the second artifact served successfully.
- Empty rebuild: `robyn_testnet_final_817e52f` was migrated from zero and reconstructed only through canonical chain logs. At common block `93849331`, its canonical blocks, canonical logs, nine immutable launch projections, and three King of the Forest awards match `robyn_testnet_final_e6dd172` byte-for-byte after excluding ingestion timestamps. Rebuild evidence is in the protected campaign directory.
- Follow-up: Build the clean exact candidate, reconstruct an empty isolated database from canonical logs, reconcile projections and liabilities, complete browser/real-wallet/recovery/reproducibility gates, promote the exact release, then start the ten-hour endurance clock from zero.

### 2026-07-27 - Campaign dynamic-transfer gas correction

- Context: Governance, 20 holder claims, all eight creator claims, and ten streamed DAO claims passed. During token sweeping, `sweep-token-1-0` exhausted its 25%-buffered gas limit while settling transfer-aware reward state.
- Root cause: The live transfer path can accrue and settle multiple reward streams between estimation and mining. On this transaction, the RPC estimate plus 25% was still too tight; the receipt consumed the exact gas limit and failed without changing token state.
- Decision: Preserve the failed receipt as evidence, clear only its unconfirmed journal slot, and permit a same-label retry. Use a separate 50% execution-gas limit margin while retaining the 25% economic funding headroom. Confirmed transactions remain immutable and are never replayed.
- Follow-on: Token and DAO sweeping then reached the native sweep stage with 2,097 confirmed transactions, where the old 25% native reserve calculation was smaller than the new 50% transaction gas limit. No transaction was submitted. Native sweep reserve now uses the exact 50% execution-gas limit so value plus maximum fee cannot exceed the actor balance.
- Files: `scripts/lib/campaign-plan.mjs`, `scripts/testnet-assurance-campaign.mjs`, `scripts/test/testnet-assurance-campaign.test.mjs`.
- Commands/tests: Node syntax, campaign test suite 22/22, formatting, and diff check pass.
- Follow-up: Commit and push, resume the same sweep journal, reconcile the completed lifecycle, and continue the remaining pre-endurance gates.

### 2026-07-27 - Campaign streamed DAO settlement correction

- Context: The accounting-only fee router intentionally queues DAO and treasury liabilities. The campaign claims phase still assumed these destinations were paid synchronously.
- Decision: After the post-governance fee-bearing buys, permissionlessly settle the complete queued DAO and treasury liabilities, journal both transactions, wait for real chain time to begin vesting the seven-day DAO stream, and only then evaluate holder and DAO claims.
- Coverage: Creator withdrawals now exercise all four public paths across the eight creators: direct claim, claim-to, batch, and batch-to. Evidence records the method and recipient for every token-specific creator liability.
- Files: `scripts/testnet-assurance-campaign.mjs`, `scripts/test/testnet-assurance-campaign.test.mjs`.
- Commands/tests: Node syntax, campaign test suite 20/20, formatting, and diff check pass.
- Result: Conversion phase is complete with all 24 unique basket routes exercised. Governance is progressing through the real testnet voting lifecycle without artificial time changes.

### 2026-07-27 - Campaign locker fee-accounting correction

- Context: Campaign `final-assurance-e458382` completed the fixed trading workload and three graduations, waited for the real five-minute oracle window, then confirmed four hook/locker conversion transactions before failing safely at `locker-route-native-0`.
- Root cause: The campaign runner tried to route the locker's entire ETH balance and convert its entire launch-token balance. The principal-safe locker correctly rejected the request because only `pendingCollectedNativeFees` and `pendingCollectedTokenFees` are collectible revenue.
- Decision: Preserve all 1,539 confirmed transactions and resume without replay. Read the two tracked pending-fee values from the locker and use only those exact amounts for native routing and launch-token conversion.
- Follow-on: The corrected runner completed hook settlement, LP collection, tracked native routing, tracked launch-token conversion, and post-harvest settlement for all three graduates. It then failed safely before basket conversion because the accounting-only fee router liabilities had not yet been permissionlessly settled into each vault. Preserve all 1,556 confirmed transactions and explicitly journal `settleBasketFees` for each launch before its three conversion legs.
- Files: `scripts/testnet-assurance-campaign.mjs`, `scripts/test/testnet-assurance-campaign.test.mjs`.
- Commands/tests: Node syntax, campaign test suite 18/18, formatting, and diff check pass.
- Follow-up: Commit and push the runner correction, resume conversions from the durable journal, then complete governance, claims, fill, sweep, reconciliation, and the remaining pre-endurance gates.

### 2026-07-27 - Final campaign graduation top-up repair

- Context: Campaign `final-assurance-e458382` completed funding, eight atomic launches, 900 buys, 200 transfers, 150 approvals, and 150 sells, then failed closed because all three intended graduates remained at 94.71% progress.
- Root cause: The fixed 900-buy plan ended slightly below the live `0.001500000000000001 ETH` net graduation threshold after the 1% curve fee and planned sells. The runner assumed those purchases would graduate without calculating the remaining net reserve.
- Decision: Preserve all 1,508 confirmed transactions and resume without replay. Compute each remaining gross top-up from live `graduationThresholdNative`, `nativeRaised`, `feeBps`, and `maximumCurvePurchase`, bound it to `0.0001 ETH`, and journal one dedicated terminal buy per intended graduate.
- Files: `scripts/lib/campaign-plan.mjs`, `scripts/testnet-assurance-campaign.mjs`, `scripts/test/testnet-assurance-campaign.test.mjs`.
- Boundary correction: The first live top-up reached 100% native progress but left `0.000001014620529056` token because of integer rounding. Live simulation proved 1 and 2 wei cannot satisfy graduation-adapter residual checks while 10 wei completes atomically. The resumable runner now submits a separately journaled 10-wei terminal-dust buy only when the pool is still bonding after its threshold top-up.
- Commands/tests: Node syntax and all 17 campaign tests pass, including viem numeric fee-width normalization, exact fee gross-up, zero-needed, cap-rejection, total-value, and per-wallet funding conservation.
- Follow-up: Commit and push the runner repair, resume the same campaign journal, prove three graduations and five distinct bonding states, then continue conversions, governance, claims, fill, sweep, and reconciliation.

### 2026-07-27 - Faucet funding and immutable web-cache correction

- Context: The fixed 100-wallet campaign was blocked on faucet funding, and the staged read-only Next.js artifact logged an EACCES attempt to create `.next/cache` while fetching the ETH/USD reference price.
- Decision: Keep the immutable release read-only. Use a 60-second process-memory quote cache backed by a `cache: no-store` Coinbase request instead of Next.js disk revalidation.
- Files: `apps/web/src/lib/eth-usd.ts`, `apps/web/src/lib/eth-usd.test.ts`.
- Commands/tests: Web test suite 57/57, strict typecheck, lint, formatting, diff check, and optimized production build pass.
- Result: Project wallet balance is `0.019913879590852215 ETH`, above the `0.01682413048944 ETH` full campaign requirement including headroom and the `0.0015 ETH` reserve.
- Follow-up: Commit and push the application fix, rebuild an immutable exact release, verify no cache-write errors under read-only permissions, then initialize and fund a campaign tied to the new application SHA.
Durable project context lives here. Update this file whenever information should survive chat context compression or future agent handoff.
- Fresh final-assurance testnet deployment 2026-07-27: exact source commit
  `e6dd172e3f77dcbf8be2c7197d007b66295ad504` was broadcast only to
  Robinhood Testnet chain 46630. Deployment begins at block 93,808,580 and
  genesis completed at block 93,808,760. The canonical coordinator is
  `0x63BBC689a217BD6bF3a13EE0f07123FF734E177E`, fee router is
  `0x8715C2c1664b70e0d713162fa5Df70811dC159ad`, phase/fee hook is
  `0x40989ED86f75Ec4177A8aFa024D90B4ad499D8E4`, and asset router is
  `0x29927d799a5c293BFDb6Fd77d8864Bd92B604F0B`. LAN and official public RPC
  verification both have zero failures. Manifest SHA-256 is
  `6b9bb8fec2c973e055d105cd9caa0378134e03c97bcdaad2700505982c999a0d`.
  Wallet balance after deployment is 0.009913879590852215 testnet ETH. The
  public application remains on the predecessor until campaign and index gates
  pass.
- Final fork-rehearsal correction 2026-07-27: the schema-10 smoke harness
  still assumed synchronous basket/DAO/treasury delivery and immediate holder
  rewards. The remediated router is accounting-only and holder rewards stream
  for seven days. The harness now explicitly settles each queued liability,
  advances only its isolated Anvil clock for stream verification, and derives
  deadlines from chain time. The exact chain-46630 fork deployment then passed
  the full deployment verifier and lifecycle smoke with zero failures at fork
  block 93,806,751. No public transaction was sent.
- Final testnet assurance checkpoint 2026-07-27: the user authorized a fresh
  security-remediated chain-46630 deployment, the fixed 100-wallet lifecycle
  campaign, internal security/recovery/browser gates, and a ten-accumulated-
  healthy-hour endurance run. Failed intervals count zero. Application or
  infrastructure fixes may resume in a new evidence segment after regression
  and promotion, but any contract/deployment change, accounting discrepancy,
  or locked-principal violation resets endurance to zero. The public target is
  `testnet.sherwoodforest.trade`; Robinhood mainnet broadcasting, independent
  audit, external penetration testing, and legal review remain deferred and
  unclaimed. The `sherwood-10-hour-readiness-monitor` heartbeat is active every
  20 minutes with this policy. Source commit `1e808ed` matches `origin/main`,
  while the current deployed contracts predate its adapter/router ETH fixes.

- SF10-01B asset-router remediation 2026-07-27: the canonical v4 flow does not
  require fallback ETH receipt, so `RobynV4AssetRouter` now rejects direct ETH
  and permissionlessly sweeps unavoidable forced ETH only to its immutable
  governor, which deployment tooling binds to the timelock treasury. A focused
  regression proves forced ETH remains isolated through a normal protected swap
  and cannot leak through refund accounting. The full assurance suite passes
  165 tests with 256-run depth-128 invariants and the
  512-wallet/32-launch/25,000-action simulation; contract sizes and
  `scripts/security-audit.sh` pass. SF10-01A and SF10-01B are closed in source,
  but both require a fresh immutable testnet deployment.
- SF10-01A adapter remediation 2026-07-27: `RobynV4GraduationAdapter` now
  rejects direct ETH and permissionlessly sweeps unavoidable forced ETH to the
  immutable timelock treasury read from its canonical locker. The adapter
  exposes unattributed and cumulative-sweep accounting, and regression tests
  prove direct rejection, forced-ETH reconciliation, treasury-only routing,
  and zero-balance failure. The assurance suite passes 162 tests with 256-run
  depth-128 invariants and the 512-wallet/32-launch/25,000-action simulation;
  contract sizes and `scripts/security-audit.sh` pass. The change requires a
  fresh immutable deployment.
- Security-remediation checkpoint 2026-07-27: active work is on
  `codex/security-remediation` in `/home/hendo420/Robyn-schema9`, based on
  `09f4d80bde00931c9f88521b50692fe11bd8bb7b`. The public schema-v9 testnet
  deployment is unchanged and its endurance runner remains stopped. No
  remediated contracts have been broadcast.
- Security-remediation implementation 2026-07-27: the candidate adds the
  phase-aware v4 hook, principal-safe locker, accounting-only V4 fee router,
  immutable token sink, and seven-day transfer-aware launch-token and DAO
  reward streams. The indexer now persists and ingests canonical token, vault,
  market, adapter, and locker addresses. API, keeper, web, schema-10 deployment
  tooling, verifier, health invariants, and action coverage are updated.
- Security-remediation validation 2026-07-27: full format, strict typecheck,
  lint, repository tests, Foundry tests, 256-run/depth-128 invariants, the
  512-wallet/32-launch/25,000-action simulation across 20 seeds, contract-size
  checks, dependency audit, Git-history secret scan, and active-scope Slither
  review pass. An integration review caught and fixed a stale indexer router
  tuple. A manual review caught and fixed native residual dust being returned
  rather than held as principal. Detailed status is in
  `docs/assurance/security-remediation-review.md`.
- Security-remediation mainnet fork 2026-07-27: the first no-broadcast run
  against Robinhood's official public mainnet RPC failed with approximately
  0.5 ETH native residual. The 1.1B/2.25 ETH virtual reserves did not match the
  800M bonding, 200M graduation, and 6 ETH target allocations. Production now
  uses `1066666666666666666666666666` virtual tokens and 2 ETH virtual native;
  curve exhaustion is 6 ETH plus one wei and exactly matches the graduation
  inventory at terminal price. The corrected full lifecycle passes on chain
  4663 within the 1 gwei and 0.000001-token residual ceilings.
- Security-remediation blockers 2026-07-27: fresh testnet deployment, lifecycle
  campaign, empty-index rebuild, browser/real-wallet acceptance, recovery
  drills, reproducible builds, a new eight-hour run, and independent
  professional audit remain required.
- Security-remediation deployment rehearsal 2026-07-27: the first standard
  Anvil fork rehearsal found `RobynNativeLaunchDeployerV4` at 25,776 runtime
  bytes, above EIP-170. Token and vault CREATE2 deployment are now split
  between `RobynNativeLaunchDeployerV4` and
  `RobynNativeVaultDeployerV4`. Their runtimes are 17,518 and 9,299 bytes, and
  the size gate now covers every deployed component. A normal-limit chain-46630
  fork deployment, genesis launch, and verifier pass. The 56 deployment and
  configuration transactions use 59,143,474 gas. Current pricing plus 25%
  headroom requires 890,050,177,359,800 wei versus a project-wallet balance of
  11,163,294,240,852,215 wei. No public transaction was broadcast.
- Security-remediation testnet deployment 2026-07-27: exact `origin/main`
  `e754037bd40c5caee426e31b0886514da9c9ed12` was broadcast to chain 46630.
  The schema-10 deployment starts at block 93,785,971 and its genesis launch
  succeeded at block 93,786,122. LAN and official public RPC verification each
  pass all 531 checks with zero failures. The manifest SHA-256 is
  `5056fd70c94c2184de4498350348a19c16bbce6d9a2102ff7554d0e321db7912`.
  The project wallet retains 0.010525774830852215 testnet ETH. The archived
  schema-v9 manifest is preserved under
  `/home/hendo420/.local/state/robyn-testnet-deployments/schema9-security-no-go-e435b78/`.
  Application/index cutover and the eight-launch campaign are not yet complete.

- Security audit checkpoint 2026-07-26: a fresh manual review of deployed
  schema-v9 Solidity commit `e435b78` found a release-blocking pre-graduation
  v4-pool access flaw. The market factory initializes and registers a launch
  pool during atomic creation, while the hook does not gate swaps or liquidity
  additions before graduation. An isolated Foundry proof confirms a third
  party can add liquidity while the market is still bonding. Additional proven
  liveness risk: moving all RDAO into an excluded balance makes fee-bearing
  trades revert because synchronous DAO reward deposit has zero eligible
  supply. Do not promote schema-v9 to mainnet. Full evidence is under
  `/home/hendo420/robyn-evidence/schema9-mainnet-readiness-d76244a/security/manual-2026-07-26/`.
- Endurance repair checkpoint 2026-07-26: the first schema-v9 eight-hour run
  paused at 1,200.487 healthy seconds because `maybeGraduate()` attempted
  `eth_estimateGas` from an underfunded campaign actor before calculating its
  top-up. The estimate now uses the funded project account, followed by the
  existing exact actor funding calculation and actor-signed transaction. Node
  syntax and all 13 endurance-policy tests pass; live RPC estimate confirms
  the project account can estimate the failed terminal buy while the actor cannot.
- Endurance promotion checkpoint 2026-07-26: the replacement run was stopped
  at zero healthy seconds after metadata preparation returned
  `campaign_operator_required`. Promotion had injected the archived schema-v8
  operator-token file while the schema-v9 runner used its schema-v9 token.
  `scripts/promote-testnet-release.sh` now defaults to the active
  `schema9-e435b78` operator-token file. The failed zero-duration evidence is
  preserved under `/var/lib/robyn/testnet-endurance/schema9-30505f9-8h/` and a
  new immutable release plus full eight-hour run is required.

- Last verified 2026-07-26: fresh capped schema-v9 contracts were deployed to
  Robinhood Testnet from exact commit
  `e435b78bf8be3d2d443ec2253d2a6ed4d5212874` at block `93726965`.
  Independent verification passed all 513 checks. The deployment used
  `maximumCurvePurchase=0.00025 ETH`, retained the additional 1% graduated-pool
  hook fee, and consumed 56,641,011 gas across 54 transactions. The protected
  manifest is
  `/home/hendo420/.local/state/robyn-testnet-deployments/schema9-e435b78/46630-v4.json`.
- Last verified 2026-07-26: public campaign
  `schema9-e435b78-public` passed through the private LAN RPC at
  `192.168.50.117:8547`. It used 100 encrypted campaign wallets, created eight
  atomic launches covering all 24 reward assets, executed 2,181 successful
  transactions and 2,081 product writes, graduated three launches, preserved
  five distinct bonding states, completed direct v4 swaps, third-party
  liquidity dilution, hook and locked-LP settlement, all claims, and
  successful/defeated/cancelled governance. All receipts succeeded.
- Last verified 2026-07-26: campaign reconciliation proves exact 50/25/20/5
  conservation across 1,024 routed-fee events totaling
  `382838524443669 wei`, fixed one-billion-token launch supplies, fixed RDAO
  supply, solvent liabilities, immutable locked positions, zero remaining hook
  queues, and all 24 conversion routes. Evidence is
  `/home/hendo420/robyn-evidence/schema9-mainnet-readiness-d76244a/public-campaign-reconciliation.json`.
  The live campaign exposed an orchestration-order gap: locked-token conversion
  occurred after the prior hook settlement, leaving three small native queues.
  Three permissionless follow-up settlements cleared them. The runner now
  performs and tests a final post-harvest settlement.

- Last verified 2026-07-26: the fresh schema-v9 index was rebuilt from an empty
  database through the synchronized LAN RPC and matched the campaign database's
  immutable nine-launch projection hash. Release `d002ad3` was promoted with
  zero ingestion and projection lag and 513 deployment checks. Post-promotion
  review found that the deployment generator had mistakenly nested the King of
  the Forest policy inside `assetCatalog`, leaving the achievement projector
  inactive. Source and manifest are corrected, and the deployment verifier now
  rejects missing or misplaced policy configuration. A corrected exact release
  must replace `d002ad3` before browser acceptance and endurance begin.

- Last verified 2026-07-26: schema-v9 mainnet-readiness review found a
  release-blocking configuration mismatch. `maximumNativeSwap` limited only
  graduated swaps while bonding `buy()` had no onchain per-transaction cap.
  Source now adds immutable `maximumCurvePurchase`, enforced in both quote and
  execution paths and bounded by the graduation threshold. The proposed
  mainnet value is 0.5 ETH. The existing chain-46630 schema-v9 deployment does
  not contain this fix and must be replaced before the public campaign.
- Last verified 2026-07-26: post-remediation validation passes 148 Foundry
  tests, 256 invariant runs at depth 128, and the 512-wallet, 32-launch,
  25,000-action simulation across 20 deterministic seeds. The repository gates,
  Anvil smoke test, mainnet-curve validator, and security audit pass with no
  unresolved critical, high, or medium finding.
- Last verified 2026-07-26: the no-broadcast Robinhood mainnet fork rehearsal
  passes against chain 4663 using the live shared v4 PoolManager,
  PositionManager, Quoter, Permit2, and production AAPL Stock Token. It proves
  the proposed 6 ETH graduation threshold, 0.5 ETH purchase cap, atomic creator
  purchase, graduation, post-graduation swaps, hook and locked-LP settlement,
  AAPL basket conversion, holder/creator/governance-holder/treasury
  distribution, exact 50/25/20/5 conservation, and unchanged locked principal.
  The rehearsal requires production-scale route depth; a deliberately shallow
  route correctly failed the 1% price-impact guard before the fixture was
  corrected.
- Last verified 2026-07-26: root-disk headroom was restored from 2.6 GiB to
  25 GiB by removing only verified superseded immutable releases.
- Last verified 2026-07-26: the new deployment purchase-cap verifier initially
  contained a malformed nested assertion that the ordinary package gates did
  not parse. It was fixed before commit, and the root test pipeline now runs
  `node --check` across every `scripts/**/*.mjs` file so deployment and
  operations scripts cannot carry an unnoticed syntax error.
- Last verified 2026-07-26: a clean chain-46630 fork deployment and lifecycle
  rehearsal passes from the exact project deployer while reusing the sealed
  24-route testnet liquidity manifest. It passes 497 independent deployment
  checks, all 24 bidirectional route probes, six purchase-cap-bounded bonding
  buys through graduation, post-graduation buy and sell, all three basket
  conversions and holder claims, token-specific creator claim,
  governance-holder reward claim, and fee-router solvency.
- Last verified 2026-07-26: the clean rehearsal found and fixed three
  deployment/smoke harness defects before public deployment. The deployment
  script encoded the curve tuple with the fee and maximum-purchase fields
  reversed. The smoke script assumed graduation could occur in one buy and
  hardcoded a basket conversion larger than each route cap. It now performs
  bounded graduation buys, uses explicit gas headroom for stateful hook swaps,
  caps conversions by `routeStatus.maximumNativeInput`, and decodes the full
  schema-v9 fee-account tuple when checking creator rewards.
- Last verified 2026-07-26: the schema-v9 public campaign inventory now
  includes the frozen shared Universal Router in every fresh deployment
  manifest, four direct router swap modes, full-range and concentrated
  third-party liquidity, native and launch-token hook settlement, and the
  later-cycle settlement generated by fee conversion itself. Universal Router
  plan encoding is unit tested and a direct exact-input swap passed against the
  actual shared chain-46630 router on the isolated fork. The campaign value
  model funds these new actions and every planned bonding purchase stays at or
  below `maximumCurvePurchase`. A complete exact-SHA 100-wallet rehearsal is
  the next gate.
## Active Handoff

- 2026-07-26 security-remediation work is active on
  `codex/security-remediation` in `/home/hendo420/Robyn-schema9`, based on
  `09f4d80bde00931c9f88521b50692fe11bd8bb7b`. The public schema-v9 deployment
  remains unchanged and the endurance service is inactive. Fresh source now
  includes a phase-aware v4 hook, principal-safe locker, accounting-only V4 fee
  router, immutable token sink, and seven-day transfer-aware launch-token and
  DAO reward streams. The complete Foundry suite passes 165 tests, including
  the 512-wallet, 32-launch, 25,000-action campaign. Mainnet-fork tests still
  skip without their RPC environment and are not accepted as rehearsal
  evidence. Deployment tooling is being upgraded to manifest schema 10; no
  remediated testnet deployment has occurred.
- Fresh capped schema-v9 deployment `e435b78`, the 100-wallet public campaign,
  exact accounting reconciliation, empty-database rebuild, King projection,
  and release `19053b1` browser acceptance are passing. Server-side testnet
  traffic uses the synchronized LAN RPC at `192.168.50.117:8547`. The endurance
  runner now accepts only the official or approved LAN RPC and targets the
  schema-v9 campaign. Its live funding preflight found `0.007255454777915471
  ETH` available and a `0.002142263852084529 ETH` shortfall after the required
  workload and `0.0015 ETH` reserve. Next: finish recovery/backup evidence,
  obtain at least `0.0023 ETH` more faucet funding, then run the uninterrupted
  eight-hour gate.
- Last verified 2026-07-26: the creator-profile avatar and token-artwork upload
  badges no longer render a font-dependent plus glyph. Both now use the same
  geometrically centered CSS cross, keeping the plus centered in its circle
  across fonts, browsers, and responsive sizes. Web tests, lint, and strict
  typecheck pass.

- Last verified 2026-07-26: the compact launch-wizard source now starts every
  testnet basket empty, makes the square artwork tile itself the file chooser,
  removes the separate artwork chooser and `Use artwork` action, and prepares
  selected artwork automatically during the final atomic launch action. Step
  one is shorter through reduced gaps, padding, input height, artwork size, and
  a two-row description. Web format, lint, strict typecheck, and all 57 tests
  pass. The public testnet serves the compact flow with 494 deployment checks,
  zero ingestion/projection lag, and healthy keeper/artifact workers. Browser
  acceptance confirmed zero internal or horizontal overflow at 1440x900 and
  1280x800, normal contained scrolling at 390x844, a real file chooser from the
  artwork tile, no `Use artwork` control, and a fresh `0/3` reward basket.
- Last verified 2026-07-26: the creator profile avatar tile is now the upload
  control, with a visible plus badge and keyboard focus treatment. The separate
  file chooser row and `Use avatar` button are removed. Selecting an image
  exposes crop zoom, and `Save profile` now sanitizes, uploads, and applies the
  selected avatar before saving the remaining profile fields.
- Last verified 2026-07-26: the decorative pine-tree canopy SVG was removed
  from Discover and deleted from the shared web source together with its
  dedicated styles, policy helper, and obsolete unit test. Source-wide search
  confirms no `ForestCanopy` or `forest-canopy` references remain. Web format,
  lint, typecheck, and all 53 tests pass.
- Last verified 2026-07-26: schema-v9 is live at
  `https://testnet.sherwoodforest.trade` from current exact `origin/main`. The
  implementation checkpoint was `6385004`; the schema-v9 deployment began at
  block `93591157`; all 494 deployment checks pass. The creation/profile release
  is live: optional artwork, hidden internal wallet-proof/sanitization steps,
  DEX-style routed-asset picker with custom-address inspection, icon-only basket
  controls, immutable website/X links, atomic creator initial purchase,
  dedicated creator profile editor, exact sell-balance fill, and no manual
  onchain-refresh buttons. A real `0.00005 ETH` atomic launch created Atomic
  Grove (`GROVE`) at `0x32CE5096C51D011fEd47465f3649b93A65708AF7`;
  creator profile/media/link binding, indexed buy, sell, and token-specific
  creator claim passed. All six testnet PM2 processes have zero restarts, both
  index pipelines are caught up, no Prometheus alert is firing, and the live
  release verifier remains green. In-app-browser desktop and 390x844 acceptance
  found no console warnings/errors or horizontal overflow; the mobile launch
  dialog fits in 808px without internal scrolling.
- Fresh schema-v9 contracts were deployed to Robinhood Testnet from exact commit `3b0f9075b9703b2820adf062b31d8e602515a054` at block `93591157`. The canonical coordinator is `0xfd435c4ED809e9F38AaF2B793d55f8Cd46b0E7ac`, fee-and-oracle hook is `0xd25eD28717DFbdBfEB5B5B39B695F226FeFfd044`, fee router is `0x7EeD773eb5b09d6CB4d44319E6996a145aA7B3c8`, and genesis token is `0xD87008596Ac0Df205E487D0Ef1d18A520Fd8fA5E`. All 494 independent deployment checks passed. Fresh measured deployment cost with 25% headroom was 0.000759102 ETH; actual post-deployment wallet balance was 0.004957005 ETH. Schema-v8 deployment `abe90dc` is archived. The schema-v9 database migration, event rebuild, exact web/API release promotion, and browser acceptance remain pending; `testnet.sherwoodforest.trade` still serves the schema-v8 release until those pass.
- Token creation UX and atomic creator purchase work is implemented on this schema-v9 branch but not yet live. The launch modal no longer exposes separate wallet-proof, artwork-sanitization, wallet-refresh, or faucet controls. Artwork is optional, reward assets use the catalog/custom-address picker with icon controls, creators may add immutable website/X links, and the payable coordinator can atomically launch plus buy for the creator. Portfolio now has a dedicated profile editor with avatar/name/bio/links, token pages use creator identity and project links, sell balance fills the exact sell amount, and manual onchain-refresh buttons are removed. Migration `0009_token_launch_links.sql` is additive. The source checkpoint passed 132 Foundry tests, all repository tests, lint, format, typecheck, clean devnet build, and protected testnet build. Fresh schema-v9 deployment, migration/reindex, and browser acceptance remain required before promotion.
- King of the Forest is implemented on `codex/testnet-subdomain-nav` as a rebuildable, one-time discovery achievement. The manifest policy activates at testnet block `93576793`, requires 5,000 bps bonding progress plus 10 distinct lifetime traders, and only awards on fresh post-activation activity. The newest canonical award reigns; former winners retain their badge and history. Schema migration `0008_king_of_forest.sql`, projector/API/status work, homepage spotlight, Markets history, token progress, card badges, admin health, tests, and documentation are complete in the working tree. An isolated schema-v8 database rebuilt through block `93579188`, reconstructed 69 distinct trader rows across five launches, populated pool IDs for all 15 launches, produced the expected zero retroactive awards, and idled in 1.3 to 2.2 ms cycles. Promotion and live browser acceptance remain pending.
- Exact public testnet release
  `dbe03449463bab302d94f711535677399eb6fca4` is live at
  `https://testnet.sherwoodforest.trade`. Market-cap presentation now defaults
  to USD across the ticker, homepage, Markets cards, and token detail. The
  server fetches Coinbase's unauthenticated ETH-USD spot reference with a
  60-second Next cache and fails closed to `USD unavailable`; contracts,
  wallets, trading, fees, and accounting remain native ETH. Token-page market
  cap changes to ETH on pointer hover or keyboard focus. Its chart defaults to
  USD and switches price, volume, axes, tooltips, and market cap between USD
  and ETH. Token basket cards now use the current-chain catalog and immutable
  basket addresses to show trusted artwork, onchain or curated name/symbol,
  exact weight, a verification-aware description, and a shortened explorer
  link. Pending conversion, purchased/deposited, converted-native, contract
  provenance, and raw-log panels were removed from token detail. All 52 web
  tests, repository typechecks/tests, 123 Foundry tests, the immutable testnet
  builder, and all 490 promotion checks passed. In-app-browser acceptance at
  1440x900 and 390x844 proved the USD/ETH interactions, three asset images and
  links, absent removed copy, zero overflow, and zero console warnings/errors.
  Twelve superseded immutable web build directories were removed after path
  validation; current and previous rollback releases, databases, chain state,
  IPFS/MinIO data, campaign evidence, and deployment history were preserved.
  Token pages now render the status-aware token artwork without exposing the
  immutable metadata CID, IPFS address, or verification label. Release
  `dc48fe2` passed the immutable builder, all 490 promotion checks, and live
  in-app-browser verification with artwork present, no IPFS copy, and no
  horizontal overflow.
  The compact basket percentage chips now reveal asset previews on pointer
  hover, keyboard focus, and tap. Preview data is derived from the same
  current-chain catalog and immutable basket address as the detailed holder
  reward cards: trusted artwork or identicon, symbol, name, weight, category,
  verification class, description, and explorer-linked address. Mobile uses a
  fixed bottom card so every preview remains inside the viewport. Release
  `b1e05ea` passed 54 web tests, lint, typecheck, the immutable builder, all 490
  promotion checks, and live desktop/mobile browser acceptance with no
  horizontal overflow.
  The continuously moving market ticker now shows each launch's sanitized
  artwork or fallback image, symbol, labeled USD market cap, and indexed 24-hour
  percentage. It remains 40px tall, gapless, and reduced-motion aware. Release
  `dbe0344` passed 54 web tests, lint, typecheck, the immutable builder, all 490
  promotion checks, and live desktop/mobile browser acceptance with 26px
  artwork, continuous animation, and no horizontal page overflow.
- Exact public homepage release
  `ab5d7825bf504605826c5dcaf18104426080e230` is live at
  `https://testnet.sherwoodforest.trade`. The homepage no longer renders the
  canopy vector or the `Permissionless roots` network tagline. Its former
  lifetime and decorative counters are replaced by exact indexed 24-hour
  active-market count, trade count, ETH volume, and volume leader. Small ETH
  totals preserve six decimal places, preventing real activity from rendering
  as zero. In-app-browser acceptance confirmed `0.000895 ETH`, no horizontal
  overflow, and absence of the removed copy and canopy. Public pages no longer
  expose schema
  generations, analytics-formula versions, Uniswap generation labels, or RDAO
  branding. All seven em dashes were removed from the whitepaper, discovery
  controls, launch wizard, market cards, ticker, and trade panel. The
  source-wide `public-copy-style.test.ts` regression test rejects the character
  anywhere in the web source, public assets, or apex holding page. Desktop and
  390x844 in-app-browser acceptance found zero rendered em dashes, overflow,
  warnings, or errors across Home, Markets, Whitepaper, Portfolio, DAO, token
  detail, and the open launch modal. The shared web source resolves an explicit
  build-time
  `devnet`, `testnet`, or `mainnet` profile; a mainnet render was browser-proven
  to contain no testnet wording or Faucet link. Mainnet remains inactive and
  isolated by hostname, ports, PM2 names, PostgreSQL database, Redis database,
  queue, manifest, release root, and secrets. The first candidate artifact
  omitted Next's `prerender-manifest.json`; promotion failed closed and restored
  release `6a97a61`. Builders and promoters now reject incomplete Next runtime
  manifests before cutover. The rebuilt artifact passed all 490 promotion
  checks.
- The live Sherwood brand mark is an ImageGen-produced forest crest with a
  thick oak-arrow, three gold reward coins, and a Robin Hood feather. The
  transparent master is packaged as `sherwood-crest.png` and
  `sherwood-crest.webp`; matching 512px app, 180px Apple, and multi-size ICO
  assets live under `apps/web/src/app`. The versioned crest filename and `v=2`
  favicon metadata prevent stale browsers and Next image optimization caches
  from retaining the previous mark. Live in-app-browser verification loaded the
  512px crest, found no old mark reference, and found no horizontal overflow.
- Public presentation no longer exposes internal schema, analytics-formula, or
  Uniswap generation labels. The web build now has explicit `devnet`,
  `testnet`, and `mainnet` profiles. Chain ID, RPC, explorer, hostname, faucet,
  disclosures, metadata, and wallet-switch requests resolve from one validated
  public environment. Testnet and future mainnet use isolated PM2 names, ports,
  PostgreSQL databases, Redis databases, queues, manifests, secrets, release
  roots, origins, and hostnames. `scripts/build-mainnet-candidate.sh` is
  deliberately non-promoting and refuses chain, hostname, testnet-marker, or
  mock-asset contamination. The apex holding page remains until a separately
  authorized mainnet activation.
- `/whitepaper` is the public Sherwood Compact: a detailed, visually led
  explanation of atomic launch, bonding, graduation, immutable baskets,
  50/25/20/5 fee routing, holder/creator/DAO-member claims, DAO governance,
  ERC-1046/IPFS identity, security boundaries, environment-specific economics,
  and current testnet/mainnet status. The original generated hero uses the
  public-domain Robin Hood and Merry Men archetype without copying any film or
  franchise design. `Whitepaper` is a primary navigation item.
- The accepted Robinhood mainnet bonding policy is 6 ETH net collateral,
  800 million tokens sold on the curve, 200 million tokens reserved for locked
  liquidity, a 0.5 ETH maximum individual curve buy, and a 27.5 ETH terminal
  FDV. The 1% bonding fee means at least 6.060606060606060607 ETH of gross buy
  demand before offsetting sells. The immutable policy lives in
  `config/protocol/robinhood-mainnet-curve.json` and is checked by
  `pnpm validate:mainnet-curve`. This does not change chain-46630 testnet and
  does not authorize mainnet deployment.
- Schema-v9 guaranteed post-graduation fee work is active on branch `codex/schema9-guaranteed-fee` from exact `841fccd342ce823c5f3905e282f7551469b36bb6`. The schema-v8 endurance run was stopped and preserved as incomplete/superseded at `/var/lib/robyn/testnet-endurance/schema8-c203d00-endurance-20260725/preserved-schema9-fee-hook-20260726T001254Z` after 16942.713 healthy seconds. The fresh v4 hook uses permission bits `0x1044`, retains the oracle, and charges an immutable 1% custom-accounting fee on every graduated-pool swap in addition to the 1% LP fee. The fee router tracks bonding, hook, and locked-LP sources separately under the unchanged 50/25/20/5 allocation. Targeted v4 contracts pass 16 tests; keeper typecheck/lint and 18 tests pass; API/indexer/web types pass. Public schema v8 remains live and untouched until schema-v9 gates pass.
- A live MetaMask SAT3 buy exposed that the testnet trade panel still quoted and
  submitted graduated launches to their exhausted bonding market. Selector
  `0x2c5211c6` is `InvalidAmount()`, and the former graduated quick amounts also
  exceeded the route's intentional `0.00025 ETH` testnet cap. The repair routes
  graduated v4 quotes, approvals, buys, and sells through the already-deployed
  `RobynV4AssetRouter`, reads the cap onchain, uses cap-aware quick amounts,
  applies a fresh 1% slippage floor and ten-minute deadline, and decodes common
  router errors. Implementation commit `f351a16` passed the full immutable
  testnet build and all 490 promotion checks. An `eth_call` from the affected
  wallet successfully simulated the exact `0.0001 ETH` SAT3 router buy without
  changing chain state. Post-promotion in-app-browser acceptance with the
  connected MetaMask wallet proved a live 14.73M SAT3 buy quote, the explicit
  over-cap message, and a nonzero sell quote. Carry this repair into schema v9.
- Sherwood Forest's product voice and visual system intentionally use a
  restrained `plant → grow → harvest` metaphor. The homepage, Markets hero,
  Portfolio hero, and guided creation modal use forest language while retaining
  explicit token, market, basket, and claim terminology. Rooted green surfaces
  provide the forest identity without obscuring financial information. The
  code-native canopy remains available for compact Markets presentation but is
  intentionally absent from the homepage. The homepage featured basket
  description is derived from the actual featured launch rather than hardcoded
  assets.
- Markets no longer exposes basket-size filtering. Discovery supports canonical
  `1h`, `6h`, `24h`, `7d`, and all-time windows; cards, volume sorting, and
  Trending tie-breaks use the selected window's timestamped trade metrics.
  The API continues accepting the legacy `basketSize` parameter for backward
  compatibility, but the public Markets interface no longer sends it.
- Portfolio positions are wallet-specific. A launch appears in the holdings
  grid only when the viewed wallet currently holds its launch token or has a
  currently claimable basket reward. Global vault pending conversion and
  already-claimed history are not wallet positions. Tokens canonically created
  by the wallet remain visible in the separate Created tokens section. This
  policy is shared by devnet and testnet views and has focused regression
  coverage in `apps/web/src/lib/portfolio-position-policy.test.ts`.
- Server-side Robinhood Testnet traffic is now routed through the synchronized
  private LAN RPC at `http://192.168.50.117:8547`. Browser wallet traffic
  intentionally remains on Robinhood's public HTTPS RPC because a browser
  cannot safely or reliably reach the LAN-only origin. API, ingester,
  projector, keeper, promotion verification, and operator scripts use
  `ROBYN_TESTNET_SERVER_RPC_URL`; the protected browser bundle continues using
  `ROBYN_TESTNET_RPC_URL`. Commit `80254d5` introduced and verified this
  separation.
- A live private-RPC smoke journey created canonical launch 15
  (`0xac0cB4EFd08B20E02aF8BF103b2Bf88e6F44cf2B`), completed two buys,
  one approval, one sell, all three basket conversions and holder claims, a
  token-specific creator claim, and an RDAO reward claim. Raw evidence is
  protected at
  `/home/hendo420/.local/state/robyn-private-rpc-smoke/smoke-1785032598176.json`.
  The ingester was repaired in `00674b7` to discover new token and market
  addresses inside the same canonical range and backfill their logs. A
  one-character Sold-topic allowlist typo found by the live journey was also
  corrected; the API analytics suite covers buy/sell derivation.
- The focused testnet-hostname/navigation release is live from `codex/testnet-subdomain-nav`. Cloudflare routes `testnet.sherwoodforest.trade` to loopback port `3081` and apex plus `www` to the isolated holding origin on `3082`. The holding page is copied from the verified release into `/var/www/sherwoodforest-coming-soon` because Nginx intentionally cannot traverse immutable release directories. The promoter refreshes that root-owned copy. The ticker has no label/pause behavior, dynamically repeats short market sets. The ticker remains compact and continuously animated even when the OS requests reduced motion; reduced-motion handling remains enabled elsewhere. `Create token` is a route-preserving navigation trigger and `Faucet` is a testnet-only primary navigation link.
- The testnet API PM2 environment binds both `ROBYN_AUTH_ORIGINS` and `API_CORS_ORIGIN` to `https://testnet.sherwoodforest.trade`; the PM2 validator fails if either returns to an apex, preview, or wildcard origin. Authentication cookies remain host-only.
- Exact public schema-v8 release `aa2fe0bae28a9db4b346b0bb8b7858927e9af6c5` passed all 490 deployment checks. Its presentation, domain, CORS, and homepage-copy changes are included on the schema-v9 branch.
- Homepage featured markets are no longer newest-first. `rankActiveMarkets` uses an ordinal weighted activity score across 24-hour volume (35%), market cap (30%), unique 24-hour traders (20%), and 24-hour trade count (15%), with deterministic tie-breaks and unindexed markets last. Homepage cards show both 24-hour traders and trades, and the section heading is `Top tokens`; the misleading static TSLA/AMD/AMZN basket example is replaced by an asset-agnostic `How rewards work` flow.
- The homepage operational strip and testnet disclaimer footer are removed. A deliberately unlinked read-only operator dashboard now lives at `/admin/health`; it auto-refreshes every 15 seconds and exposes only non-sensitive web release, RPC chain/head/latency, ingester/projector lag/cycles/retries, keeper/artifact heartbeat, and indexed launch/log health.
- Portfolio access is now wallet-gated in the header. The protected browser-UAT path is a read-only, session-only opt-in bound to the public deployment deployer address; it never supplies a signer or enables writes. `/portfolio` remains the connected wallet's unified profile/dashboard, while `/users/[address]` reuses the holdings, creator profile, created-token, and fee views as a public read-only user page. Creator names and addresses link to that route.
- The schema-v8 endurance service is intentionally stopped for the incremental
  indexer release. Its durable state, samples, reviews, and transaction journal
  are checksummed under
  `/var/lib/robyn/testnet-endurance/schema8-c203d00-endurance-20260725/preserved-indexer-refactor-20260725T183451Z`.
  Preservation state: `9002.981` healthy seconds, 1,110 samples, 16 write
  cycles, eight reviews, 110 confirmed transactions, two endurance launches,
  and no workload failure. Resume this same journal after exact promotion;
  never replay a confirmed transaction.
- The current indexer working tree replaces the monolithic testnet poll with a
  200-block canonical ingester and a separate event-driven launch projector.
  `robyn-indexer-testnet` atomically commits required block metadata, canonical
  logs, and the verified range-end `chain-indexer` checkpoint.
  `robyn-projector-testnet` consumes coordinator events from `raw_logs`,
  validates only new launches, reconciles metadata in PostgreSQL, and advances
  `launch-projector` only after the full batch succeeds. API status, PM2,
  monitoring, release verification, and endurance policy now track both
  pipelines and separate ingestion/projection lag.
- An isolated database rebuilt from deployment block `93182752` to the live
  Robinhood public-testnet head in about 490 seconds, reconstructed all 11
  launches, and reproduced immutable launch and campaign-binding digests.
  It recovered four historical fee logs that the old indexer had omitted; the
  official public RPC transaction receipts independently contain all four, and
  the new database had zero logs absent from the old database. Overlapping
  canonical block hashes have zero differences. Evidence is under
  `/var/lib/robyn/testnet-indexer-shadow/schema8-incremental-20260725`.
- Shadow validation caught and fixed a bigint heartbeat serialization defect
  before promotion. The regression is covered by the indexer policy suite.
  Eleven focused pipeline tests cover bounded ranges, required range-end
  metadata, stale-head/reorg decisions, independent checkpoint recovery,
  projector-ahead reset/replay, projector failure without checkpoint
  advancement, delayed metadata ordering, idempotent launch events, bounded
  retry backoff, JSON-safe heartbeats, and the p95 lag policy. Exact-source
  scale samples with 11, 100, and 1,000 existing launches measured projector
  p95 cycle times of 1.62 ms, 1.68 ms, and 1.53 ms.
- The final exact-source public-RPC shadow ran from
  `2026-07-25T19:12:47Z` through `19:43:51Z` and passed. Its 53 samples had
  ingestion p95/max lag of 43/49 blocks, projection p95/max lag of 32/41
  blocks, zero unhealthy samples, monotonic checkpoints, zero duplicate logs,
  and zero ingester or projector error events. Transient public-RPC retries
  recovered while both checkpoints remained correct. Four receipt-verified
  historical fee logs omitted by the old indexer were backfilled into the
  active database; it still has zero duplicate transaction/log identities.
  Checksummed evidence is under
  `/var/lib/robyn/testnet-indexer-shadow/schema8-incremental-20260725`.
- The first two-clean-archive reproducibility run for `38896f8` found a genuine
  application-bundle mismatch: Webpack swapped two compact numeric server
  module IDs between otherwise equivalent builds. The web build now uses
  stable named module identities in `apps/web/next.config.ts`. The complete
  rerun for `05b6a60` passed two clean archives: application bundles, contract
  semantics, operations, dependency graph, licenses, CycloneDX SBOM, and the
  second served artifact all matched. Evidence is under
  `/var/backups/robyn/reproducibility/indexer-05b6a60-20260725`.
- The first `652c630` promotion failed closed before acceptance because the
  projector required the ingester's global checkpoint to remain unchanged
  during its initial 11-launch replay. The public chain advanced during that
  replay, so the projector could starve even though its captured range remained
  canonical. The repaired checkpoint guard locks and verifies the captured
  canonical range-end block instead; later ingestion progress is allowed, while
  a missing or changed captured block still clears projection state and fails
  closed. Twelve focused tests pass. A concurrent shadow startup projected all
  11 launches in 9.8 seconds while ingestion advanced, then kept both
  checkpoints synchronized with zero errors. The incomplete candidate was
  rolled back to accepted release `3cc4812` while the corrected release is
  rebuilt.
- Corrected release `56be9c5` passed reproducibility, protected release gates,
  its 490-check promoter, and the first live projector replay. Post-promotion
  observation then found a legacy transient user-systemd unit,
  `robyn-schema8-abe90dc-indexer.service`, still running the old combined
  indexer against the active database in parallel with PM2. It repeatedly reset
  canonical state while the new processes repaired it. The obsolete unit and
  PID were stopped; it had no install target and is now absent. The sole active
  testnet writers are the PM2 ingester and projector, both checkpoints
  stabilized at the same head with all 11 launches and zero lag. Future
  promotion checks must enumerate all processes with
  `PGDATABASE=robyn_testnet_schema8_abe90dc`, not PM2 alone.
- The repaired endurance run reached `8402.8` healthy seconds, 99 confirmed
  transactions, and two endurance launches before its second graduation paused
  safely on 2026-07-25. No buy was submitted: the actor held enough for the
  terminal curve value plus the runner's hardcoded `20000000000000 wei` gas
  reserve, but not the RPC's current EIP-1559 maximum-fee reservation. Evidence
  is preserved under
  `/var/lib/robyn/testnet-endurance/schema8-c203d00-endurance-20260725/preserved-failure-20260725T173849Z`.
  The source repair estimates the exact buy transaction using the funded
  project identity so `eth_estimateGas` does not itself reject the intentionally
  underfunded actor, derives a dynamic maximum-fee reserve with two bounded 25%
  safety margins, and incorporates the funding target into the idempotent
  funding label so the earlier confirmed top-up cannot suppress the correction.
  The focused ten-test policy suite, syntax checks, lint, strict typechecking,
  and diff checks pass. Exact release `d3e104c` was pushed, built, promoted,
  and passed all 490 verifier checks. The old top-up remained journaled, a new
  target-specific top-up and the missing graduation confirmed without replay,
  the next mixed write cycle completed, and the runner resumed at `8432.808`
  accumulated healthy seconds with 105 confirmed transactions, no workload
  failure, and no firing alerts. Cleaning only superseded immutable release
  artifacts while retaining current `d3e104c` and previous `e4be1aa` increased
  root headroom from 10.8 GB to 28 GB.
- The schema-v8 endurance runner was stopped on 2026-07-25 after the first
  endurance launch failed to graduate. It accumulated only 1,200.414 healthy
  seconds and 45 confirmed transactions. The raw journal, samples, reviews,
  and checksums are preserved under
  `/var/lib/robyn/testnet-endurance/schema8-c203d00-endurance-20260725/preserved-failure-20260725T143608Z`.
  Root cause: the runner hardcoded a `0.0005 ETH` graduation buy, while the
  live remaining curve required exactly `0.000846801346801348 ETH`; the
  confirmed insufficient buy's fixed journal label then made every retry a
  no-op. Passing infrastructure samples also reopened the clock while the
  workload failure remained unresolved, producing 517 false segment records.
  The source repair calculates terminal input from live reserves, funds the
  graduation actor without breaching the `0.0015 ETH` reserve, uses
  reserve-specific idempotent labels, keeps workload failures paused until a
  successful retry, prevents finalization while paused, and removes unreliable
  public-RPC batching. Focused policy tests, formatting, lint, strict
  typechecking, and syntax checks pass. Commit, exact build/promotion, repaired
  journal migration, and live resume verification remain in progress.
- Schema-v8 promotion and public-testnet endurance are in progress
  (2026-07-25). The verified active deployment is campaign
  `schema8-abe90dc`: manifest SHA-256
  `a9da6d57e29637e48e80295d44ef6fb83d1eb5cec3cf17b60280826223506bef`,
  deployment block `93182752`, nine indexed launches, 2,156 completed campaign
  transactions, and zero verifier failures. `sherwoodforest.trade` was
  atomically promoted to schema-v8 application release
  `9e44819a2ae5940db3cdcc2d6e40c60f028fa938`; the promoter passed
  490 verification checks, and the public status reports chain `46630` and nine
  launches. The predecessor manifest is archived in
  `deployments/archive/46630-v4-schema7-166e201/deployment.json`.
- The testnet browser uses Robinhood's official public HTTPS RPC for wallet
  compatibility. Server-side application, indexer, keeper, verifier, campaign,
  and endurance traffic uses the private LAN RPC at `192.168.50.117:8547`.
  Index and receipt reads use bounded ranges plus bounded retry/backoff; signed
  transactions are never transport-rebroadcast.
- The user waived new backup creation, isolated restore, and restore drills for
  this release. Acceptance requires Codex in-app-browser coverage and eight
  accumulated healthy public-testnet hours. Failures pause the clock; repaired
  segments resume from durable transaction journals. This must be reported as
  segmented endurance, never as an uninterrupted soak. No recurring Codex
  automation or enabled timer is permitted.
- The first endurance start on exact release `c203d00` completed funding
  preflight and 37 confirmed setup transactions, then failed before counting
  any healthy runtime because the runner passed a reward-asset address to
  `withdrawableRewardOf(address,uint256)` instead of the canonical asset index.
  The one-shot service was stopped and the evidence segment preserved. The
  runner now derives validated bigint reward indexes and has a focused
  regression test. Lint, strict types, and all five endurance-policy tests pass.
  Resume only after this fix is committed, pushed, built, promoted, and the
  durable journal identity is migrated to the new exact release.
- The first repaired promotion exposed a bootstrap-only verifier assumption:
  it required the deployer to retain 100% of RDAO after the endurance preflight
  had legitimately transferred RDAO to test voters. Runtime verification now
  proves the immutable one-billion total supply and the manifest's 100%
  bootstrap allocation instead of forbidding later token transfers. The live
  post-distribution deployment passes all 490 verifier checks.
- The first same-deployment endurance resume correctly preserved all 37
  confirmed transactions but also retained the previous release's PM2 process
  baseline, so deliberate promotion PIDs/cwds were reported as continuity
  failures. Same-deployment release reconciliation now clears only the PM2
  baseline so the next passing sample records the new exact release, while
  keeping transaction, failure, launch, and healthy-time journals intact.
- The first sample on release `1a41ed0` completed the previously failing write
  cycle and advanced the durable journal, then falsely reported web continuity
  failure because the runner compared every PM2 cwd to the release root even
  though Next correctly runs from `apps/web`. Continuity now compares each
  process to its own captured baseline cwd, status, and restart count. A focused
  regression covers both the web subdirectory and a real restart mismatch.
- The root-disk promotion gate was cleared on 2026-07-25 by deleting only
  22.95 GB of abandoned, regenerable Anvil staging data under
  `/home/hendo420/.foundry/anvil/tmp` and the apt cache. Persistent chain,
  database, IPFS/MinIO, manifests, immutable releases, campaign evidence, and
  release history were preserved. Root headroom increased from 8.3 GiB/14% to
  about 31 GiB/52%.
- In-app-browser acceptance on schema v8 found and corrected
  release-blocking display defects: bytes32 v4 route reasons rendered as binary
  text, DAO timing text remained hardcoded to production values, native-v4
  trade previews used a false linear estimate, small ETH values rounded to zero,
  and testnet disclosures described all assets as mocks. Release `f299a058`
  contains those fixes. Final route acceptance then found two additional
  blockers: repeated DAO list/detail scans could exhaust the public RPC and
  return a 429-backed 500, and three unavailable Robinhood CDN logos rendered
  as broken images in Create. Releases `498f7fb`, `4dc400f`, and final candidate
  `9e44819` add bounded viem retry/backoff, five-minute discovery/DAO caches, a
  ten-minute asset cache, single-flight DAO projections, local identicon
  artwork fallback, sequential public-RPC transport, manifest-backed curated
  metadata, bounded live-route probes, and transient-read fallback to verified
  manifest routes. Atomic launch simulation and execution still revalidate
  every route onchain. The exact builder reran the complete release gate and
  the promoter passed 490 checks. Final Codex in-app-browser acceptance passed
  at 1440x900, 834x1112, and 390x844 with no overflow, broken images, new
  console warnings/errors, or Cloudflare failure pages. Search,
  near-graduation sorting, chart modes, watchlist persistence, all 24 picker
  assets, the multi-wallet modal, keyboard focus, DAO views, and proposal detail
  all passed.
- Exact release `498f7fbdcbf641581a492f6b0d15f0466ee184ca` was built,
  promoted, and passed 490 deployment checks on 2026-07-25. Public browser
  acceptance then reproduced Cloudflare 504 responses because the API's seven
  RPC retries, 15-second request timeout, three-second discovery cache, and
  twenty-second asset cache caused optional public-RPC enrichment to occupy a
  request for about 128 seconds during rate limiting. The current working tree
  bounds API reads to two retries, a 500 ms retry delay, and a five-second
  transport timeout; discovery and DAO projections cache for five minutes and
  the 24-asset catalog caches for ten minutes. Optional discovery metrics still
  fail open to indexed data rather than blocking the page. Full format, lint,
  strict types, application/service tests, Anvil smoke, and all 123 Foundry
  tests pass. This RPC-pressure fix requires commit/push, exact rebuild,
  promotion, and fresh public browser acceptance before endurance.
- The first bounded-latency release `4dc400fe` removed Cloudflare's 128-second
  wait but exposed that the public RPC does not reliably support viem HTTP
  JSON-RPC batching: curated asset reads returned incomplete batch responses,
  and the catalog cached all 24 routes as unavailable. The current working tree
  removes transport batching, reads immutable curated metadata from the
  deployment manifest, limits live route probes to four concurrent calls,
  retains full onchain introspection for manual addresses, and uses a verified
  manifest route only while a live curated route check is transiently
  unavailable. Atomic launch simulation and execution still revalidate every
  route onchain. API typecheck and all 52 API tests pass, including the
  transient-route regression. Exact release `9e44819` is now built, promoted,
  independently verified, and browser accepted.
- The first immutable testnet application build at `201dc19` failed closed
  before promotion because the root Turbo build did not forward the network
  environment into Next.js and the bundle scanner found devnet session-key
  modules. The release builder now compiles non-web services separately and
  invokes the web package directly with explicit testnet variables. Schema v7
  remained public throughout; the corrected builder must pass before cutover.
- The corrected protected bundle passed, then immutable artifact finalization
  exposed that removing write permission from the staging directory itself
  prevented its rename on this VM. The builder now removes write access from
  every descendant, atomically renames the staging root, and removes write
  access from the final root only after the rename. Schema v7 again remained
  live and no partial release directory was retained.
- Route-pressure and keeper recovery passed (2026-07-24): exact pushed commit
  `6bf210a84cd843ff8f6ee9a5dc373e3e56e64ec6` passed a fresh chain-46630 fork
  deployment with 490 verifier checks and zero failures. Its resumable campaign
  completed 2,156 transactions and 2,056 product writes across 100 wallets,
  eight launches, three graduations, all 24 assets, governance, claims, and
  sweep; a second `all` run repeated no confirmed transaction. The rebuilt
  isolated index contains nine launches, 3,181 raw logs, and 1,572 chain blocks.
  The real keeper then drained `104645780230963 wei` of residual basket fees to
  zero through 27 jobs, each completed on its first attempt, with no failed,
  retrying, or dead-letter work. A post-keeper verifier again passed all 490
  checks. Five faucet routes retain frozen 198-tick reference enforcement and a
  `10000000000 wei` cap; the 19 controlled synthetic routes disable a meaningless
  fixed external reference while retaining the 1% per-transaction impact guard,
  `1000000000000 wei` batches, and adaptive halving. Evidence and checksums are
  under `/tmp/schema8-6bf210a-exact-rehearsal`. This memory update rolls the Git
  SHA, so the final exact-SHA release rehearsal and live preflight remain
  required before public deployment; schema v7 remains live.
- Schema-v8 discovery campaign completed and superseded (2026-07-24): exact
  commit `44c91b1dcd2964606b5baf84cc8526ac4aa88606` completed the full live
  chain-46630 campaign with 2,156 confirmed transactions and 2,056 product
  writes across 100 wallets, eight launches, three graduations, all 24 basket
  routes, governance, claims, and residual sweeps. It remains an inactive
  candidate; schema v7 is still public. The run exposed and reproduced four
  release-blocking engineering defects: testnet simulations used a plain
  address instead of the local signing account, observation-stamped conversion
  job IDs amplified BullMQ failures, harvest races were not treated as consumed
  no-ops, and native sweeps used a static rather than live fixed-point gas
  reserve. Source fixes pass formatting, lint, strict types, the full application
  and 123-contract suite, security audit, and optimized build. Pre-migration
  queue evidence and the 997 superseded legacy job audits are preserved under
  the candidate state root. A fresh exact-SHA rehearsal and deployment remain
  required.

- Shared faucet-route pressure correction (2026-07-24): the campaign's first
  three launches both graduated and used the shallow shared faucet-stock pools,
  which moved AMD, AMZN, NFLX, and PLTR beyond the frozen 198-tick reference
  guard. Bounded verifier swaps restored all five routes and checksummed
  receipts are preserved under the candidate state root. The final campaign
  plan now places all five faucet-stock routes only in the final two
  non-graduated launches, while the first six launches use the 19 controlled
  routes and all 24 assets remain covered exactly once. Fresh deployments cap
  faucet-route conversion input at `10000000000 wei`; the current immutable
  deployment retains its old cap and must not be promoted or restarted as the
  final keeper candidate.
- Shared-v4 live route verification completed (2026-07-24): exact release
  `baab23518e7cfa317a99e24d6b346071b9cc06cc` passed a fresh 490-check
  chain-46630 deployment rehearsal, the complete 100-wallet campaign with
  2,156 successful transactions and 2,056 product writes, idempotent resume,
  live-priced deployment measurement, and two-clean-archive reproducibility.
  A release-gate recheck then correctly rejected the venue manifest because its
  bounded live swaps were still marked pending. A disposable verifier at
  `0x8E02E29F2Fe1a6fbF25F6B9aCDDd53600C8dC818` executed a 1-gwei native-to-stock
  and exact acquired-balance stock-to-native round trip through each shared TSLA,
  AMD, AMZN, NFLX, and PLTR pool. Every receipt succeeded and every stock balance
  returned exactly to its starting value. Protected evidence is under
  `/home/hendo420/.local/state/robyn-testnet-deployments/v4-venue-live-swaps-baab235`.
  The versioned venue manifest now records the probe and route receipts and is
  release-ready. This manifest and memory update roll the release SHA, so a
  fresh exact-commit rehearsal, campaign, reproducibility check, gas measurement,
  and public schema-v8 deployment remain required. Schema v7 remains public.
  Last verified on chain 46630 on 2026-07-24.

- Dependency audit rollover (2026-07-24): after exact `f67fa90` passed its
  fresh 490-check deployment and complete 2,156-transaction campaign rehearsal,
  GitHub advisory `GHSA-mh99-v99m-4gvg` newly classified all installed
  `brace-expansion <=5.0.7` paths as high severity. The root
  `pnpm-workspace.yaml` now overrides the transitive package to patched `5.0.8`.
  The frozen install, lint, strict types, zero-high/zero-critical dependency
  audit, and complete security audit pass. This dependency-only SHA rollover
  still requires a fresh exact-commit deployment rehearsal because the v4 hook
  deployment domain commits to the Git SHA.

- Live campaign keystore correction (2026-07-24): the corrected nonce allocator
  completed a fresh exact-SHA rehearsal and a fully verified public schema-v8
  deployment at commit `8c5fc663d4d8c8864047545e80430eafe984c1a8` without
  replacing schema v7. Its isolated index rebuilt the genesis launch and the
  live campaign preflight passed, but funding stopped before its first
  transaction because Foundry prefixes `decrypt-keystore` output with prose.
  `scripts/lib/campaign-keystore.mjs` now requires and extracts exactly one
  32-byte hex key, and the runner supplies the keystore password through the
  child environment instead of a command-line argument. Parser rejection tests,
  lint, strict types, and a real encrypted-keystore address check pass. Because
  the campaign runner changed, the verified `8c5fc66` deployment remains an
  inactive candidate and a fresh exact-commit rehearsal/deployment is required.

- Schema-v8 public deployment nonce correction (2026-07-24): exact commit
  `aef5afd14ff87101fb3dbe2096d6260179392df1` passed the complete fresh
  chain-46630 rehearsal (490 verifier checks, 2,156 successful transactions,
  2,056 product writes, every campaign phase, no sweep dust, and idempotent
  resume) plus reproducible builds and current venue verification. The first
  public deployment attempt then stopped before producing or activating a
  manifest when the load-balanced public RPC supplied stale nonce `273` after
  that nonce had already confirmed. Nonces `229` through `273` are successful
  but form an abandoned, unindexed partial stack; schema v7 remains live.
  `scripts/deploy-testnet-v4-protocol.sh` now samples latest and pending nonce,
  allocates one monotonic nonce locally, passes it explicitly to every create
  and send, and avoids losing allocator state through the CREATE2 hook command
  substitution. `scripts/lib/transaction-nonce.sh` and its regression test
  freeze the sequence. Full lint, strict types, application/Anvil/Foundry tests,
  the nonce regression, and the security audit pass. A fresh exact-commit fork
  rehearsal is required before retrying public deployment.

- Secondary faucet wallet transfer completed (2026-07-24): the encrypted wallet
  at `/home/hendo420/.config/robyn/wallets/robinhood-testnet-faucet-2`
  (`0xeCD975C493959b7E9157433a86097ba55014D3eA`) received `0.01 ETH` plus five
  each of the faucet-issued TSLA, AMD, AMZN, NFLX, and PLTR contracts. All five
  token balances and `0.00999659638 ETH` were transferred to the canonical
  deployer `0xecc5d6d032ADc9ca9E0F4042128067b8366da17A`; the source retains only
  `82230000000 wei` of unavoidable gas dust. The five token transaction receipts
  are `0x9ec9294b81de73cc66d077a6aac29b31ad6526d83cdcfbab6ad38ec22a3acfba`,
  `0x7f1dcb50db823ddd5b30610321ed767fbb00a82ba08814e781d251f3e916e302`,
  `0x7248476b839188d948b7035558c10426cb97da0fc72c529e7a81c483a5ee80ab`,
  `0xecef01be4ad70f245991f481016f77a6794764642866ea8f4f05abc300091b36`,
  and `0xb1270be6e55ccd201f26dbea2f79663ae393648c3654183ed08d6d271c011f80`;
  the ETH receipt is
  `0x184d0e828a83a1e073d04e61522954d7ed1d7fd217c2eaac0459a5d4ab122ddd`.
  The destination now holds `0.025214184158782403 ETH` and 15 of each faucet
  stock. No secret or recovery material is stored in Git or this memory file.
  Last verified on chain 46630 on 2026-07-24.

- Public schema-v8 funding gate is now clear (2026-07-24): `main` was
  fast-forwarded and pushed to validated commit
  `2858bc8dd00d89e03bc9c3138b2d3461edcfdc07`. A fresh deployment and complete
  100-wallet campaign at that exact SHA again passed all 490 verifier checks,
  2,156 successful transactions, 2,056 product writes, all 24 conversions,
  governance, claims, sweep, and reserve gates. Live-priced rehearsal receipts
  estimate schema-v8 deployment at `743832099255000 wei`; deployment plus the
  fixed campaign and reserve requires `16537769625879000 wei`. The encrypted
  project wallet now has `25214184158782403 wei`. Against the last complete
  deployment-plus-campaign requirement of `16537769625879000 wei`, this leaves
  `8676414532903403 wei` (`0.008676414532903403 ETH`) of margin while preserving
  the fixed reserve. Current execution gas is `10000000 wei` and the Nitro L1
  base-fee estimate is `19842679 wei`. Funding is sufficient to resume work,
  but the exact-release validation, fresh deployment estimates, and live
  preflight must still pass before broadcast. Schema v7 remains live and no
  schema-v8 public transaction has been sent.

- Schema-v7 pre-cutover recovery passed (2026-07-24): the active schema-v7
  deployment manifest, served-release manifest, `robyn_testnet_v4` database,
  and API snapshots were checksummed, encrypted, and uploaded to the private
  `robyn-testnet-schema-archives` GitHub release. The encrypted archive at
  `/var/backups/robyn/testnet-schema7-archive-166e201-20260724T205158Z.tar.zst.age`
  passed its checksum, decrypted through the separately protected recovery
  identity, and restored into isolated database
  `robyn_schema7_restore_166e201` with all 16 tables and the canonical launch.

- Reproducibility passed (2026-07-24): exact pushed commit `2858bc8` built from
  two clean Git archives with separate fresh pnpm stores. Application bundles,
  contract ABI/creation/runtime/storage semantics, operational inputs,
  dependency graph, license inventory, CycloneDX SBOM, and second-artifact
  serving matched. All checksums under
  `/var/backups/robyn/reproducibility/schema8-2858bc8-final` verify.

- Schema-v8 predeployment gates advanced (2026-07-24): full repository
  formatting, lint, strict typecheck, 96 application/service tests, Anvil smoke,
  and all 123 Foundry tests passed. The active native-v4 security audit now
  reports zero Git-history secrets, zero high/critical dependency advisories,
  zero unresolved critical/high findings, and zero unresolved medium findings.
  Thirty-seven medium detector results across four explicitly reviewed classes
  are documented in `docs/protocol-security-review.md`; any new medium class
  fails `scripts/security-audit.sh`. High false positives use only line-scoped
  source annotations, not global detector suppression.

- Exact-fork data-plane reconstruction passed (2026-07-24): an isolated
  `robyn_schema8_reconcile` PostgreSQL database indexed the complete exact-fork
  campaign state into nine native-v4 atomic launches, 2,470 raw logs and 1,215
  chain-block rows through block 93,104,050. An isolated API, artifact service,
  and keeper reached healthy status and returned all nine launches. Deleting
  only this isolated chain projection and rebuilding solely from logs reproduced
  the exact canonical launch hash `0187cb658f31d500d0acf0e995935bed` and identical
  row counts. Evidence is under `/tmp/schema8-c4a38b2-gates/reconcile`.

- Action-coverage regeneration (2026-07-24): the generated active schema-v8
  inventory now covers 18 contracts, 131 public/external contract functions,
  35 API endpoints, seven UI routes and three workers, including the new
  `protectedQuoteFloor` function. Its verifier remains intentionally red while
  14 browser/operational journeys are pending; no pending journey was waived.

- Exact schema-v8 campaign rehearsal passed (2026-07-24): pushed commit
  `6ba989f61947aea2933751e5b712ca1e6552fc86` was deployed on a fresh isolated
  chain-46630 fork and passed all 490 deployment checks. The 100-wallet
  campaign completed eight atomic launches, 900 buys, 200 transfers, 150
  approvals, 150 sells, three graduations, five distinct bonding states, all
  24 basket conversions, successful/defeated/cancelled governance, 20 holder
  claims, eight token-specific creator claims, ten RDAO claims, and a complete
  residual sweep. Final status recorded 2,156 successful transactions, 2,056
  product writes, no sweep dust, a preserved reserve, and a second `all` run
  that did not repeat any confirmed transaction. Checksummed raw evidence is
  under `/tmp/schema8-6ba989f-exact-rehearsal`. This validates campaign
  execution but is not authorization for public-testnet broadcast; full
  predeployment gates, exact fork index/API reconciliation, reproducibility,
  backup, funding preflight, and clean exact `origin/main` remain required.

- Verifier invocation correction (2026-07-24):
  `scripts/verify-testnet-v4-deployment.mjs` takes the deployment manifest as a
  positional JSON argument. Setting `ROBYN_TESTNET_V4_PROTOCOL_MANIFEST` alone
  does not select it and can accidentally verify the default archived manifest.
  The exact rehearsal was rerun correctly with the schema-v8 manifest path and
  passed all 490 checks.

- Conversion-runner ABI correction (2026-07-24): exact rehearsal
  `04cd86c` completed the full trading phase with 1,517 confirmed transactions,
  including 900 buys, 200 transfers, 150 approvals, 150 sells, three
  graduations, five distinct bonding states and bidirectional direct-v4 swaps.
  The first conversion attempt failed before broadcast because the campaign
  encoded `collectFees` with four inputs although the locker ABI has two
  inputs and two return values. The next dry estimate proved those two inputs
  are minimum acceptable amounts, so uint128 maxima correctly reverted with
  `MinimumAmountInsufficient` before broadcast. The runner now passes `(0, 0)`
  to collect every nonnegative amount owed and a focused test freezes this
  semantic. The preserved rehearsal state remains safe for conversion
  debugging; a fresh exact-SHA rehearsal is still required after the correction
  is pushed.

- Conversion-keeper funding correction (2026-07-24): the preserved `04cd86c`
  rehearsal successfully confirmed locker fee collection and native routing,
  then stopped before launch-token conversion because actor 70 had only
  `0.00000658 ETH` left and Anvil's pending-state estimate could not fund the
  required execution ceiling. A traced call proved the conversion and
  50/25/20/5 routing path itself succeeds. Locker harvest and conversion now
  reuse the corresponding deliberately funded terminal actors 96-98, whose
  graduation top-ups include ample remaining gas without increasing the
  preflight-approved total or adding top-up transactions.

- Adaptive basket-batch correction (2026-07-24): after all three graduated
  locker harvest, native routing and launch-token conversion paths passed, the
  first basket conversion correctly reverted before broadcast because its
  configured maximum batch had drifted just beyond the fixed 1% price-impact
  ceiling. The campaign now quotes and simulates the exact vault call, halves
  the batch after each guarded rejection, records every rejected size, and
  broadcasts only the first batch that passes the contract's current route,
  reference-price, liquidity, impact and minimum-output checks.

- Release-blocking protected-route correction (2026-07-24): adaptive batches
  proved every nonzero faucet-stock conversion could remain impossible because
  `RobynV4AssetRouter` compared the fee-inclusive v4 quote with a fee-exclusive
  spot ideal and applied the complete 1% allowance to both pool fee and price
  impact. Version 1.2.0 now removes the configured pool fee from the ideal
  output before applying the separate 1% impact ceiling, rejects invalid fee
  values, and exposes a deterministic quote-floor calculation for boundary
  tests. This contract change invalidates the preserved schema-v8 rehearsal;
  fresh contracts and a complete exact-SHA campaign are required.

- Oracle-maturity campaign correction (2026-07-24): fresh exact commit
  `e7bf6e0` deployed schema v8, passed all 490 independent checks and again
  completed 1,517 trading transactions. The first launch-token fee conversion
  then failed before broadcast with `InsufficientHistory` because the runner
  did not honor the locker's five-minute TWAP requirement. Conversions now
  persist a chain-time target 301 seconds after entry, resume toward the same
  target without extending it, wait normally on live testnet, and advance time
  only on an explicitly marked loopback rehearsal.

- Basket-keeper funding correction (2026-07-24): after oracle maturity and all
  locker paths passed, exact rehearsal `e7bf6e0` converted its first two basket
  legs before actor 80 exhausted the budget needed for a third proxy-token
  conversion estimate. A full trace proved AMZN swap, transfer, reward deposit
  and allowance cleanup succeed. The 24 permissionless basket conversions now
  rotate evenly across actors 96-98, eight each, reusing their reviewed
  graduation/keeper top-ups without increasing total funding or transaction
  count.

- Sweep-cost preflight correction (2026-07-24): the rehearsal completed all
  conversions, governance states, 20 holder claims, eight creator claims and
  ten RDAO claims with 1,638 product transactions. Sweep then recovered 35
  token and eight RDAO balances before actor 8 lacked gas for another token
  transfer. The former 1,650-transaction preflight omitted the worst-case
  recovery surface of up to eight launch tokens, RDAO and native ETH across
  100 actors. Preflight now prices 2,600 transactions and partitions a
  1.6-million-gas sweep budget with 25% headroom to every actor. A live run must
  request more faucet funding rather than reducing recovery coverage.

- Rehearsal disk-headroom correction (2026-07-24): the next exact campaign
  stopped fail-closed during an atomic state write when the root filesystem
  reached 100%. The source was 27 GB of inactive Foundry fork-cache directories
  from terminated rehearsals; no running process had them open, the persistent
  devnet uses `/var/lib/robyn/anvil/state.json`, and only the verified inactive
  `~/.foundry/anvil/tmp/anvil-state-*` directories were removed. Root usage
  returned to 55% with 27 GB free. Campaign preflight now records available
  bytes and requires at least 5 GiB before any funding transaction.

- Native-sweep fee correction (2026-07-24): exact rehearsal `d4ce214`
  completed 408 launch-token and ten RDAO recovery transfers. Its first native
  sweep stopped before broadcast because the value reserve used Anvil's
  decayed current base fee while `recordTransaction` correctly submitted with
  the preflight-frozen 0.01-gwei price. Native sweep value now reserves the
  21,000-gas transfer plus Nitro L1 data using the same frozen prices and 25%
  headroom, eliminating the internal fee-price mismatch.

- Timestamp-sensitive gas correction (2026-07-24): exact fork `a902415`
  completed 1,282 product transactions through all buys, transfers, approvals,
  three graduations, and 32 sells before a graduated sell exhausted viem's
  near-exact gas limit. Estimation updated the current hook observation in
  place, while the mined next-timestamp transaction wrote a new observation
  and cost more gas. The transaction reverted completely. Campaign sends now
  estimate explicitly and apply 25% gas-limit headroom while retaining the
  preflight-frozen gas price; the cap cannot increase actual gas charged.

- Weighted-tree correction (2026-07-24): exact fork `8110894` completed 809
  buys before an ordinary high-value actor exhausted an equal shared wallet
  budget. No partial transaction survived. The binary funding tree now accepts
  100 distinct budgets and delivers each actor's exact planned payable value,
  shared gas budget, creator gas where applicable, and graduation gas for
  actors 96-98. The weighting is embedded in the original 99 tree edges, so it
  adds no top-up transactions and its root amount exactly conserves all wallet
  budgets plus one transfer cost per edge.

- Deterministic graduation-funding correction (2026-07-24): the exact
  `dd13c70` fork completed 824 buys before the next buy correctly failed for
  insufficient graduation-execution gas. The protocol did not enter a partial
  graduated state. The fixed campaign now keeps early graduated-launch buys
  below terminal inventory, assigns the final three 0.0003-ETH buys to actors
  96-98, and weights those wallets for terminal value plus 15M graduation gas
  with 25% headroom. Creator and graduation top-ups remain a redistribution of
  the preflight-approved total, not extra unpriced funding.

- Deterministic campaign-fee correction (2026-07-24): the gas-aligned fork
  showed viem independently suggesting a 1-gwei priority fee above the
  campaign's reviewed 0.01-gwei fee cap. No funding transaction was sent.
  Every campaign transaction now uses the exact gas price frozen by its
  passing preflight; a later price change therefore fails closed and requires
  a new preflight instead of silently overspending the reviewed budget.

- Weighted campaign-funding correction (2026-07-24): the first exact
  `0761233` fork campaign failed closed before launch 1 because equal actor
  funding did not account for the atomic-launch gas concentrated on creators.
  No launch transaction was broadcast. Campaign pricing now includes 1,650
  transactions so the 100-wallet distribution is not omitted, and the same
  conserved campaign budget is weighted with 25%-headroom creator top-ups
  sized for 15M gas plus Nitro L1 data. A fresh exact-commit rehearsal must
  validate this correction before live authorization.

- Campaign execution-engine checkpoint (2026-07-24): the schema-v8 one-shot
  runner now implements resumable trading, three exact graduations, five
  distinct bonding states, bidirectional direct-v4 swaps, locked-position fee
  harvesting, all 24 basket conversions, shortened governance, holder/creator/
  RDAO claims, the 1,510-product-write floor, residual sweeping, and ordered
  `all` execution. Submitted hashes are durably journaled before receipt waits.
  Funding projection now includes every planned payable action rather than
  only graduation value. Seven campaign unit tests plus repository format,
  lint, strict typecheck, syntax, and diff checks pass. A fresh exact-commit
  chain-46630 rehearsal is the next gate; no live transaction was broadcast.

- Schema-v8 reproducibility and campaign-foundation checkpoint (2026-07-24):
  exact pushed commit `9803bb129d84815dee74f7acdc4d9fc8ca21eb1f`
  reproduced from two clean Git archives with separate fresh pnpm stores.
  Application bundles, contract semantics, operations, dependency graph,
  licenses, CycloneDX SBOM, and a temporarily served second artifact matched;
  every evidence checksum under
  `/var/backups/robyn/reproducibility/schema8-9803bb1` verifies. The new
  campaign foundation derives 100 deterministic wallets from an AES-256-GCM
  encrypted VM-only root, exposes only addresses in evidence, conserves funds
  through a binary distribution tree, covers all 24 routes in eight
  three-asset launches, and estimates execution plus Nitro L1 data cost with
  25% headroom and the immutable `0.0015 ETH` reserve. Its six focused tests
  pass. Transaction execution, governance, sweeping, and live deployment are
  still pending; no live transaction was broadcast.
- Campaign operator CLI checkpoint (2026-07-24): the one-shot CLI at
  `scripts/testnet-assurance-campaign.mjs` now initializes protected campaign
  state, validates schema-v8/chain-46630/exact-release/runtime-code gates,
  prices 1,500 writes using execution gas plus Nitro L1 data and 25% headroom,
  enforces the combined-wallet reserve, funds 100 actors through an
  idempotently journaled binary tree, and reconciles public status. A temporary
  rehearsal proved mode-0700 state storage, mode-0600 encrypted root/state/
  evidence, exactly 100 public actor addresses, and absence of private-key,
  ciphertext, or passphrase fields from evidence. Launch/trade/governance/
  sweep commands remain intentionally unavailable until implemented and
  rehearsed; no live transaction was broadcast.
- Campaign rehearsal correction (2026-07-24): the first isolated CLI preflight
  reached the exact contract stack but an old Anvil fork could not retrieve the
  Nitro `0x6c` fee-estimator trie node. The CLI now accepts an explicit L1
  base-fee only with both `--rehearsal` and a loopback RPC; every live or remote
  invocation rejects the override and must read the onchain estimator. This
  preserves live fail-closed pricing while allowing deterministic fork
  rehearsal. The next attempt proved that 100 simultaneous native-balance
  requests can saturate a fork/public RPC, so preflight and status now use
  bounded concurrency of four. No public-testnet state changed.
- Campaign funding rehearsal checkpoint (2026-07-24): a fresh chain-46630 fork
  reused the already sealed schema-v7 24-asset liquidity locker and deployed a
  clean exact schema-v8 stack. The 100-wallet binary funding rehearsal then
  confirmed 100 transactions, preserved the reserve, and checksummed public
  evidence. Anvil reported a 1 gwei local execution price versus the live
  chain's observed 10,000,000 wei, which inflated the first campaign estimate
  to about `0.476 ETH`. Rehearsals now accept a loopback-only execution-gas
  override alongside the existing L1 override and persist both reviewed prices
  into funding state; live runs cannot override either price. At the sampled
  live execution price, the fixed campaign is expected to fit the funded
  wallets, subject to a fresh preflight before broadcast. No public-testnet
  state changed.
- Campaign atomic-launch rehearsal checkpoint (2026-07-24): the operator now
  supports eight resumable atomic launches. Live mode performs creator SIWE,
  sanitized image upload, campaign-tagged immutable IPFS metadata preparation,
  coordinator receipt decoding, index visibility wait, and one-time metadata
  binding; only a loopback rehearsal may use a fixed metadata URI. A fresh
  schema-v8 fork created eight unique tokens and covered all 24 routes exactly
  once. Re-running the phase sent zero duplicate transactions. Public evidence
  now includes all launch identities and baskets; it records 108 successful
  funding/launch transactions. Trading, graduation, conversions, claims,
  governance, write-count completion, and sweeping remain pending. No
  public-testnet state changed.
- Schema-v8 internal-audit checkpoint (2026-07-24): manual review found and
  fixed a release-blocking economic gap in permissionless basket conversion.
  All 24 basket routes now freeze a deployment reference tick, fail closed
  beyond 198 ticks of spot deviation, reject more than 1% estimated price
  impact, and reject caller minimums below 99% of the current quote.
  Launch-token routes remain floating-price and do not use the fixed-reference
  guard. The dependency tree now resolves only `uuid` 11.1.1, eliminating the
  prior moderate advisory. The complete 120-test Foundry suite, 512-wallet
  25,000-action campaign, 256-run/depth-128 native-v4 invariants, application
  suite, optimized builds, protected bundle scan, zero-advisory dependency
  audit, zero-finding Git-history secret scan, and fresh 490-check chain-46630
  fork deployment pass. The internal review is documented in
  `docs/assurance/schema8-internal-contract-audit-2026-07-24.md`; it is not an
  independent professional audit. No live transaction was broadcast.
- Assurance campaign identity checkpoint (2026-07-24): Robyn-verified
  ERC-1046 metadata can now commit a validated campaign ID, exact release SHA,
  and automated-test marker. These fields project additively through schema,
  indexer, launch APIs, token cards, token detail, and an operator-token-only
  status endpoint. Public metadata preparation cannot set campaign fields
  without the protected operator token. Isolated migration and exact-fork
  index rebuild tests pass; no production/testnet database migration or live
  chain transaction has been performed.
- Assurance schema-v8 checkpoint (2026-07-24): the fresh release adds the
  10-minute/30-minute/10-minute testnet governance profile, a generated
  native-v4 action inventory, and a deterministic 512-wallet/32-launch/25,000
  action campaign. An exact-project-wallet chain-46630 fork deployment passes
  393 independent checks. The oracle hook is now release-domain-separated to
  prevent deterministic collisions with archived releases, and deployment
  manifests hash fetched runtime bytes rather than relying on `eth_getProof`
  behavior in forked Anvil. Repository format, lint, strict types, application
  tests, Anvil smoke, and all 102 Foundry tests pass. No live transaction was
  broadcast.
- DAO availability repair (2026-07-24): the public DAO page initially failed
  because an explicitly empty `NEXT_PUBLIC_DATA_API_URL` bypassed the intended
  `/api` fallback, while `/dao/activity` scanned backward in 250-block RPC
  windows and timed out when governance activity was old. Testnet DAO and
  connected Portfolio clients now normalize absent, blank, and trailing-slash
  API configuration; DAO Activity performs one address-filtered query from the
  deployment block through `latest` and returns the newest 100 logs. Focused
  web/API regression tests cover both defects.
- Current task (2026-07-24): transition the public testnet candidate to
  `sherwoodforest.trade`, rebrand the application as Sherwood Forest with a
  green visual system and new mark/favicon, and complete the live v4 cutover.
  Tunnel token material is protected outside Git and must never be copied into
  this file or repository.
- Named-tunnel checkpoint (2026-07-24): Cloudflare tunnel
  `1c61bc58-6412-43c5-bb52-d64cfb96c9ff` is installed as the enabled
  `cloudflared.service` with healthy QUIC connections. Cloudflare published
  both `sherwoodforest.trade` and `www.sherwoodforest.trade` to
  `http://127.0.0.1:3081` and created their proxied DNS records. Both HTTPS
  hostnames return the schema-v7 Robinhood Testnet v4 application. The old
  ephemeral Quick Tunnel unit is stopped and disabled.
- Sherwood Forest public-release checkpoint (2026-07-24): the pushed v4
  application uses the green Sherwood Forest visual system, generated
  tree/arrow/coin mark, matching favicon, testnet-first messaging and the
  custom-domain WalletConnect metadata. Reown project
  `ff5c6e7499443bc840541207e30e3401` allowlists the root and `www` origins;
  Reown reports that allowlist changes may take up to six hours to propagate.
  Never store the tunnel service token or any wallet credentials in Git or
  memory.
- V4 indexer recovery checkpoint (2026-07-24): the public-RPC bootstrap
  bottleneck was the indexer reading every block and every chain log
  individually from deployment height. It now scans only manifest contract
  addresses in bounded ranges and fetches metadata only for blocks containing
  relevant logs plus the head, with bounded concurrency. A clean live rebuild
  of `robyn_testnet_v4` indexed the schema-v7 genesis token
  `0x423e546cc1ff61218844a73312eb703c2543db0c` as
  `native-v4-dao-atomic` and checkpointed block `92888760` in 34 seconds.
- Current task (2026-07-24): implement the Mainnet-Fidelity Robinhood Testnet v4
  release on branch `codex/robinhood-v4-mainnet-fidelity`. The exact starting
  commit is `b3ab91fc95d318a3bbce0b85b0e19b8ba1fb0170`. The v3 application and
  deployment remain live and must not be cut over until every v4 gate passes.
- V4 contract checkpoint (2026-07-24): fresh native-ETH launch factory,
  coordinator, market factory, bonding market, graduation adapter, oracle-only
  hook, immutable position locker, basket vault, protocol fee router and asset
  router are implemented. Eight focused end-to-end tests pass for atomic launch,
  pool-squatting rejection, exact 50/25/20/5 fee conservation, graduation,
  locked principal, post-graduation trading, five-minute TWAP history, stale
  observations, spot/TWAP deviation and bounded fee conversion. The complete
  Foundry suite also passes. No v4 testnet transaction has been broadcast.
- Shared v4 venue checkpoint (2026-07-24): chain 46630 exposes PoolManager
  `0x8366a39cc670b4001a1121b8f6a443a643e40951`, PositionManager
  `0x58daec3116aae6D93017bAAea7749052E8a04fA7`, Quoter
  `0x8dc178efb8111bb0973dd9d722ebeff267c98f94`, Universal Router
  `0x8876789976decbfcbbbe364623c63652db8c0904`, and canonical Permit2.
  PoolManager and Quoter runtime hashes match chain 4663; the other three do
  not. PositionManager references descriptor `0x963944...8dC06` and WETH
  `0x0Bd7...AD73`, neither of which has code on testnet. Treat the venue as
  `shared-unlisted-robinhood-testnet-uniswap-v4-mirror`, never official
  Uniswap, and fail closed if frozen hashes or wiring change.
- Shared v4 manifest checkpoint (2026-07-24): the frozen venue manifest is
  `deployments/46630-uniswap-v4-shared.json`. The read-only verifier
  `scripts/verify-testnet-uniswap-v4.sh` proves chain ID, shared-contract
  hashes and blocks, PositionManager wiring, missing descriptor/WETH code,
  exact faucet-stock pool identities, bidirectional quotes, and the absence of
  chain 46630 from Uniswap's official registry. Strict verification remains
  intentionally blocked on Robyn StateView deployment, bounded live swap
  evidence, and final release readiness. A tamper regression proves a changed
  runtime hash fails closed.
- StateView deployment checkpoint (2026-07-24): the estimate-first script
  `scripts/deploy-testnet-v4-state-view.sh` uses the pinned official
  `@uniswap/v4-periphery` 1.0.3 artifact and binds it to the shared PoolManager.
  The live chain-46630 estimate is 877,322 gas; its 25%-headroom execution plus
  conservative L1-data allowance requires 12,130,867,259,840 wei versus the
  reviewed deployer's observed 6,920,854,708,782,403 wei. No transaction was
  broadcast. Broadcast additionally requires a clean exact `origin/main`,
  encrypted project keystore, explicit chain-46630 confirmation, and post-send
  runtime/wiring verification. Candidate evidence is written outside Git at
  `/home/hendo420/robyn-evidence/46630-v4-state-view-candidate.json`.
- Oracle hook deployment correction (2026-07-24): deployment rehearsal found
  that deriving `initializer` from `msg.sender` would assign control to the
  canonical CREATE2 deployer proxy and make registrar binding impossible.
  `RobynV4OracleHook` now takes an explicit nonzero initializer committed into
  its CREATE2 init code. The focused v4 suite passes 9/9 and the complete
  Foundry suite passes after the correction.
- Asset-route bootstrap correction (2026-07-24): live route configuration must
  occur before the immutable timelock becomes the router governor. The asset
  router now permits its initializer to configure routes only until the launch
  registrar is bound; afterward only governance may configure them. A focused
  regression proves initializer access closes, governance remains functional,
  the v4 suite passes 10/10, and the complete Foundry suite passes.
- V4 deployment-rehearsal checkpoint (2026-07-24): the first chain-46630 fork
  rehearsal correctly failed because `RobynV4MarketFactory` embedded 44,675
  bytes of child creation code and exceeded EIP-170. Creation is now split
  across one-time-bound adapter, locker, and market deployers. Runtime sizes are
  7,888, 10,793, 17,862, and 13,460 bytes for the factory and three helpers,
  all below EIP-170; every v4 init code is below EIP-3860. The complete clean
  fork deployment now succeeds through StateView, five faucet routes,
  deterministic `0x1040` oracle hook, DAO/timelock role lock-down, all fresh
  factories, and a receipt-decoded genesis launch. The independent verifier
  passes 106/106 state, transaction, hash, role, mapping, pool, metadata, and
  reward-exclusion checks. Tampered runtime hashes fail closed. Evidence is in
  `/tmp/robyn-v4-fork-rehearsal/` and no live testnet transaction was sent.
- V4 full-bundle and financial-smoke checkpoint (2026-07-24): the deployment
  manifest now freezes 21 setup/binding transactions in addition to 14 contract
  creations and the genesis launch. An exact-commit chain-46630 fork rehearsal
  passes 156 independent pre-smoke checks, all five faucet-stock routes swap in
  both directions, the genesis launch bonds and graduates, its v4 position NFT
  is owned by the immutable locker, post-graduation buy/sell works, all three
  basket legs convert and pay holder rewards, creator/RDAO claims succeed, and
  the fee router remains solvent. The complete 35-transaction bundle used
  49,147,663 gas. At the sampled live gas and L1 base fee, the conservative
  25%-headroom requirement was 673,765,911,376,520 wei versus the encrypted
  deployer's 6,920,854,708,782,403 wei. Evidence is checksummed under
  `/tmp/robyn-v4-release-gates-ca68d27/`. This is fork evidence only; no live v4
  transaction has been broadcast.
- V4 application/indexer checkpoint (2026-07-24): the schema-v7 rehearsal
  manifest now exposes the five verified faucet assets and native-v4 contract
  aliases, the indexer reconstructs `AtomicV4LaunchCreated`, and the API/web
  expose ETH market state, PoolManager, pool ID, hook, immutable position and
  the unlisted-venue disclosure. An isolated `PGDATABASE=robyn_v4_api_it`
  rebuild against the clean fork indexed one `native-v4-dao-atomic` launch and
  returned the exact pool ID `0x44c1...3fefd` on both detail and discovery
  responses. V4 asset-route and singleton-PoolManager swap regressions pass.
  Repository format, lint, strict types, application tests, Anvil smoke and the
  complete 85-test Foundry suite pass. The production v3 services remain
  untouched; no live v4 transaction has been broadcast.
- V4 24-asset route checkpoint (2026-07-24): the catalog now preserves five
  exact Robinhood Testnet faucet stocks, replaces their corresponding mocks,
  and retains 18 unmistakably disclosed Robyn stock/ETF mocks plus the
  controlled WETH test route. `RobynV4TestAssetLiquidityLocker` creates
  hookless native-ETH pools, owns their full-range core positions forever,
  exposes no removal/collection/rescue path, and seals after bootstrap. A
  fresh exact-project-wallet fork rehearsal produced 24 route-ready assets,
  98 configuration transactions, and a 113-transaction total package. All 24
  routes swapped successfully in both directions; graduation, post-graduation
  trading, three basket conversions, holder claims, creator claim and RDAO
  claim passed. The verifier passed 438 checks, the tamper regression failed
  closed, and the package used 62,409,172 gas with conservative required
  funding `854060708288640` wei versus wallet balance
  `6920854708782403` wei. Evidence is under
  `/tmp/robyn-v4-24-route-rehearsal-v2/`. No live v4 transaction was sent.
- V4 wallet and keeper integration checkpoint (2026-07-24): testnet trading,
  homepage actions, reward-state, Portfolio, creator rewards and DAO views now
  branch explicitly between legacy v3 and native v4. V4 buys are payable ETH,
  sells approve only the launch token, basket views read `pendingNative`, the
  fee API reads the native router tuple, and the asset picker recognizes
  faucet-stock and v4-route classifications. The keeper now collects v4
  position fees, routes collected ETH, preflights bounded launch-token fee
  sales, and converts vault legs in route-limited native batches. A live
  isolated fork run completed 62 conversions with all three pending legs at
  zero. Testing found and fixed PostgreSQL NUL-byte crashes in provider error
  audit text and Redis URL parsing that discarded database/auth/TLS isolation;
  15 keeper tests cover the new runtime configuration. The v4 manifest now
  freezes the genesis basket assets and weights so the 24-asset catalog cannot
  make the three-leg console query nonexistent legs. Repository format, lint,
  strict types, application tests, 87 Foundry tests, optimized builds and
  `git diff --check` pass. No live v4 testnet transaction was sent.
- V4 exact-stack and browser checkpoint (2026-07-24): exact pushed commit
  `d6f9cc855675ae37e1d1b189a4f4336cca5c524f` passed a fresh chain-46630
  fork deployment, 446-check independent pre-smoke verifier, all 24
  bidirectional asset-route swaps, bonding/graduation/trading, basket
  conversions and claims. The 113-transaction gas package is checksummed under
  `/tmp/robyn-v4-d6f9cc8-rehearsal/`. An isolated PostgreSQL schema, Redis DB,
  indexer, API and keeper rebuilt the launch, reported keeper health `ok`, and
  leaked no queue keys into Redis DB 0. Browser acceptance then found the
  configured data API origin was absent from testnet `connect-src`, which made
  the Create basket editor fail with “The testnet asset catalog is
  unavailable.” `apps/web/next.config.ts` now includes the configured data API
  origin, and the stale “testnet-mock reward basket” copy is generalized.
  Re-run browser acceptance after rebuilding this correction. The temporary
  Quick Tunnel is intentionally not in the Reown allowlist, so its
  WalletConnect origin warning is not a product-code regression. No live v4
  testnet transaction was sent.
- Faucet-stock checkpoint (2026-07-24): the encrypted deployer holds 5 tokens
  each of exact faucet contracts TSLA `0xC9f9...Bd4E`, AMD `0x7117...778d`,
  AMZN `0x5884...9E02`, NFLX `0x3b82...8C93`, and PLTR `0x1FBE...98d0`.
  All share runtime hash `0x2f367e6a...a27c440`, report 18 decimals, and have
  live hookless native-ETH 1%/tick-200 pools initialized at block `91000224`.
  Small bidirectional Quoter calls pass for all five. Live swap proof remains a
  pre-cutover gate and must use bounded values.
- V3 archive checkpoint (2026-07-24): the existing release was preserved under
  `deployments/archive/46630-v3-b3ab91f/`; raw database, chain, PM2 and checksum
  evidence is under
  `/home/hendo420/robyn-evidence/testnet-v3-archive-20260724T014728Z`.
- Prior v3 acceptance checkpoint (2026-07-24, superseded by the active v4
  release): the protected v3 app was
  public through the temporary Quick Tunnel
  `https://october-assumptions-cleaners-skirt.trycloudflare.com`; the exact
  origin is registered in Reown. Chain-46630 DEX and Robyn protocol broadcasts
  are complete and independently verified. RDAO initially assigns 100% to the
  encrypted deployer address. Kubo pinning is local-only by explicit preview
  decision. Never describe the Quick Tunnel or local-only IPFS topology as
  production-ready.
- Wallet checkpoint (2026-07-24): the real Reown project is configured outside
  Git and WalletConnect produces a QR code after pinning the compatible `qr`
  renderer. Browser acceptance found that the testnet CSP blocked Reown project
  configuration at `https://api.web3modal.org`; the CSP now permits that exact
  origin. The protected build was restarted and WalletConnect QR acceptance,
  Reown project configuration, catalog search, manual-address lookup and
  390x844 no-overflow checks all pass with zero browser warnings or errors.
- Live testnet checkpoint (2026-07-24): the one-shot public chain-46630 smoke
  passed from exact pushed commit `4574b4b`. It proved faucet funding, bonding
  buy, automatic graduation, locked Uniswap v3 liquidity, all three basket
  conversions, holder claim, post-graduation sell, bounded native conversion,
  token-specific creator claim, RDAO claim, and independent deployment
  verification. Checksummed evidence is under
  `/home/hendo420/robyn-evidence/testnet-live-smoke/`. The smoke uses the
  dedicated protected operator key for user actions and the encrypted deployer
  only for owner claims; no key material enters Git or evidence.
- Live acceptance found that the single-token analytics query supplied the
  checksum-cased graduated-pool address to a lowercase PostgreSQL text index,
  which omitted real post-graduation `Swap` logs even though the chain,
  indexer, and derivation logic were correct. `analyticsLogAddresses` now
  normalizes every queried address, with a regression test. Exact pushed commit
  `28458ea` was rebuilt and restarted; the public API reports two trades and the
  in-app browser shows the real post-graduation sell in both the chart and
  recent-trades table with zero browser warnings or errors.
- Current task (2026-07-23): finish and push the Robinhood Testnet, multi-wallet,
  and basket-asset release on branch `codex/robinhood-testnet-assets`. The
  controlled Anvil devnet remains the internal regression environment.
- Current checkpoint: fresh V3/V5 factories and coordinator, the hybrid
  testnet conversion route registry, the exact 24-asset catalog, defensive
  manual ERC-20 introspection, RainbowKit/wagmi add-then-switch handling,
  faucet UX, responsive basket picker, isolated testnet PM2/Nginx/tunnel
  topology and schema-v6 deployment tooling are implemented. Repository lint,
  strict types, 75 Foundry tests, application tests, Anvil smoke, official
  asset-provenance verification, deployment gas estimation and the isolated
  five-service chain-46630 rehearsal pass.
- Browser checkpoint: protected create/catalog/manual-address flows passed on
  desktop and 390x844 through the loopback testnet Nginx edge. A nested-dialog
  Escape defect was found and fixed; one Escape now closes only the asset
  picker and the mobile document remains 390 pixels wide with no overflow.
  Placeholder WalletConnect acceptance intentionally remains blocked.
- Exact pushed checkpoint:
  `e4ba4e1df44a8e49533b6b3cb0e50a8741bd0b90` passed the post-push isolated
  five-service rehearsal. Checksummed evidence is under
  `/home/hendo420/robyn-evidence/testnet-release-e4ba4e1/`.
- The user supplied the remaining bootstrap decisions on 2026-07-23. A real
  Reown project exists, the current Quick Tunnel origin is allowlisted, local
  Kubo pinning is explicitly accepted without a remote replica, and the initial
  RDAO manifest assigns 100% to the existing encrypted testnet deployer. These
  are testnet-preview exceptions, not production-readiness claims. No Robinhood
  Testnet transaction has yet been broadcast.
- Current task: finish the immutable ERC-1046/IPFS token-metadata release on
  branch `codex/ipfs-token-metadata`, promote one exact release, prove backup,
  isolated restore and reboot recovery, then start a fresh one-shot eight-hour
  soak. No Robinhood Testnet rehearsal or broadcast is authorized.
- Current checkpoint: the immutable IPFS release and its repeatable-read backup
  correction pass repository, Foundry, security, live-deployment, CID
  reconciliation, 512-wallet economic, reproducible-build, encrypted backup,
  isolated restore and reboot-recovery gates. The soak workload now performs
  real creator authentication, sanitized upload, local IPFS pinning, ERC-1046
  preparation, atomic creation, indexing, immutable binding, bonding,
  graduation, post-graduation trading and eligible claims. Freeze and promote
  this changed harness, then start the fresh one-shot eight-hour soak.
- Latest soak result: exact release
  `4e2e740a2076b577fe4758b343a7c43cf5068d51` failed closed after 130 seconds
  when `RobynConversionStale` detected 311 seconds of pending native conversion
  work. All PM2 restart counters remained zero and the alert resolved after
  termination. Root cause was amount-stamped BullMQ identifiers creating
  multiple queued/retrying batches for the same token while one single-nonce
  worker drained bounded 0.1-base conversions. The correction uses one
  reusable prioritized job per token/locker stream, removes a completed stream
  job only after its durable audit commits, and supersedes only inactive
  legacy queue entries during startup reconciliation. Repository format, lint,
  strict types, application tests, Anvil smoke and all 72 Foundry tests pass;
  exact-release build, promotion, live drain validation and a fresh soak remain
  in progress.
- Release security correction: the 2026-07-23 exact builder failed closed on
  newly published `GHSA-c96f-x56v-gq3h`; Fastify resolved `find-my-way 9.6.0`.
  The workspace now overrides the router to patched `9.7.0`. The dependency
  audit reports zero high or critical advisories and the complete regression
  plus static-security gate passes. Last verified 2026-07-23.
- Candidate `95806afd8f3385080969934064c6a4afb3295af3` is invalid. Promotion
  exposed ten BullMQ legacy jobs whose active locks survived PM2's hard process
  replacement. Startup correctly avoided removing active financial work but
  restart-looped before a worker could reclaim the stalled locks; rollback to
  `4e2e740a2076b577fe4758b343a7c43cf5068d51` succeeded. The replacement
  defers active legacy jobs to BullMQ recovery while superseding only inactive
  legacy jobs. Release verification now requires zero PM2 restart counters and
  promotion/rollback repeat verification after a five-second stability window.
  Build and live migration validation remain in progress.
- Exact release `af2ad83081a3814d654a43e59b2d1c5e7af8d588` promoted with
  zero PM2 restarts. It superseded 30 inactive legacy jobs, safely deferred and
  reclaimed active locks, and began processing stable prioritized jobs with no
  alerts. Pre-soak review found the monitoring age was derived from a recent
  25-row sample and reusable audit rows retained their first-ever creation
  time. The correction exposes the database-wide oldest pending timestamp and
  resets a stable row's work-start time only when a completed/superseded stream
  is genuinely requeued; retry age remains continuous. A replacement exact
  release and live age/drain proof remain in progress.
- Exact release `8788843ef0c5e3bf994e9d330fc89a3783b72c0f` promoted with
  zero PM2 restarts, no alerts, a bounded stable-ID queue and database-wide
  pending-age monitoring. Its first soak failed closed after 37 seconds when
  `/dao/activity` requested every DAO log since deployment and the growing
  Anvil response exceeded viem's 10 MiB response limit. The endpoint now scans
  backward in bounded 250-block windows until it collects the newest 100
  matching logs, preventing response size from growing with chain history. A
  replacement exact release
  `6493520c66965d631541170feadf3b81fcafa66b` served 100 newest events in
  168 ms against the accumulated 67,000-plus-log chain with all six PM2
  restart counters at zero. Nine obsolete, reconstructible exact-release
  directories were removed after resolving and preserving the active and
  rollback targets, increasing root-disk headroom from 14.2% to 36%. Their
  checksummed soak evidence remains outside the release directories. A final
  memory-only release commit and fresh soak remain in progress. Last verified
  2026-07-23.
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
- Keeper correction: protocol-native, protocol-launch and harvest work now use
  one stable prioritized BullMQ job per financial stream. Completed stream jobs
  are reusable only after their PostgreSQL audit commits; failed protocol jobs
  keep the automatic safe-retry path. Startup reconciliation refuses active
  legacy jobs and supersedes only inactive amount-stamped queue entries while
  retaining their append-only events. Terminal convert-leg and harvest jobs
  without an automatic retry path remain dead letters, and stale-conversion
  monitoring remains fail-closed.
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
  30-second samples, 100 stable read actors, bounded five-minute onchain
  trade/eligible-claim cycles and one full creator launch lifecycle every four
  write cycles. Every second generated launch graduates and receives a
  post-graduation trade. The default is capped at 23 new launches. It must not
  advance chain time. Preserve its checksummed evidence, then remove
  `robyn-soak.service`; no recurring schedule remains.
- The first full eight-hour attempt on `49e8013...` was stopped after 3h41m
  and is invalid. It completed 33 workload cycles and 165 transactions but the
  keeper crossed its undersized 256 MiB PM2 cap 11 times. The runner also
  recorded 104 alert samples instead of terminating on the first assertion.
  Checksummed failure evidence remains under
  `/var/lib/robyn/soak/49e8013300f2c92f2efdf3f3ad7394c7fd8b5d70/`.
- The correction raises only the devnet keeper cap to 384 MiB, matching its
  measured 267-269 MiB loaded RSS with bounded headroom. The soak runner now
  compares every process restart counter to its per-process baseline, marks
  the first sample assertion fatal, breaks immediately, and exits nonzero for
  all failed or interrupted runs.
- Exact release `9f054c89bab7756b6e87f9047ea3f235f90c51e1`
  proved the restart fix under a 25-cycle/100-transaction compressed workload:
  the keeper remained below its new cap and all restart counters stayed zero.
  That regression then failed closed on a real monitoring defect: an
  automatically retried protocol conversion was labeled `dead_letter` for four
  seconds before succeeding, which fired two critical alert series. The
  failure-state policy and its tests were corrected before restarting the
  release process; no eight-hour soak was started from that candidate.
- Exact release `3ddc0cef14ee6bb14eddc388685abbf632fcad50`
  then failed closed after 22 workload transactions because creator/DAO claims
  and the keeper can legitimately use the same controlled-devnet unlocked
  account. A concurrent keeper transaction produced `nonce too low`. The soak
  workload now retries only explicit pre-broadcast nonce-contention errors up
  to five times, records `workloadNonceRetryCount`, and still fails immediately
  on reverts, timeouts, ambiguous submission failures, alerts or restarts.
- The next 63-transaction dense regression showed that the monitoring rule
  separately treated every BullMQ `failed`-set entry as a critical terminal
  failure even when durable `job_audit` correctly said `retrying`. The terminal
  alert now uses durable `dead_letter` state; BullMQ queue counts remain
  observable, and safely retrying work escalates through
  `RobynConversionStale` if it cannot progress.
- After both corrections, a two-minute dense regression completed 18 write
  cycles, 70 real transactions and 190 actor requests with zero alerts, errors,
  restarts or accounting failures. Endpoint p95 values stayed below 500 ms,
  total RSS growth was 82,341,888 bytes, and the keeper ended at 262,660,096
  bytes RSS under its 384 MiB cap. Checksummed evidence is under
  `/home/hendo420/robyn-evidence/soak-monitoring-regression-c446afd/`.
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
- Root in-app-browser inspection of the held recovery found that direct web
  port access bypassed the production same-origin `/api/` edge, so bound
  sanitized artwork returned 404 even though the restored API served a valid
  1024x1024 WebP. Recovery now starts an isolated native Nginx edge on port
  13000 and requires active-media delivery through that browser origin.
- Final recovery rerun passed 14 tables, eight artifacts, isolated chain/API/
  keeper/contract/browser-HTTP/media checks and `liveStateTouched=false`.
  In-app-browser discovery and token navigation through port 13000 showed
  complete 1024x1024 sanitized artwork, no broken images or horizontal
  overflow, and no warning/error entries from the restored origin.
- Twelve superseded immutable release directories were removed after verifying
  the active `71ac0fb...` and rollback `e4ccb8b...` targets were excluded.
  Free root-disk headroom increased from 12 GiB to 19 GiB; all removed releases
  remain reproducible from pushed Git commits.
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

### 2026-07-26 - King of the Forest implementation checkpoint

- Context: Add a one-time discovery crown for meaningful market activity without changing contracts or economics.
- Decision: Freeze policy in the deployment manifest at 50% bonding progress, 10 distinct lifetime traders, and activation block 93576793. Historical activity rebuilds progress and trader counts, but only a new canonical post-activation trade can award a token.
- Files: `packages/db/migrations/0008_king_of_forest.sql`, `apps/indexer/src/king-of-forest.ts`, `apps/indexer/src/server.ts`, `apps/api/src/server.ts`, `apps/web/src/components/king-of-forest-spotlight.tsx`, token/discovery/admin views, `docs/king-of-the-forest.md`.
- Commands/tests: DB/indexer/API/web strict typechecks; 18 indexer tests; 54 API tests; 54 web tests; isolated PostgreSQL migration and full canonical projector rebuild.
- Result: Rebuild through block 93579188 produced 69 unique-trader rows across five launches, pool IDs for all 15 launches, zero retroactive awards as required, and 1.3 to 2.2 ms idle projection cycles. Captured-block mismatch now clears launch and King projections/checkpoints together.
- Follow-up: Commit/push, build immutable release, migrate/promote testnet, run live responsive in-app-browser acceptance, then carry the checkpoint into the guaranteed-fee branch.

## Current State

### 2026-07-27 - Schema-10 smart-contract audit checkpoint

- Context: the user requested a full security audit of the smart contracts as
  they stand after the security-remediation release.
- Result: internal AI-assisted audit report added at
  `docs/assurance/schema10-security-audit-2026-07-27.md`. Fresh
  `scripts/security-audit.sh` passed on commit
  `e94da5afa3a56555de1519c602b887e760cbaa3a`; Gitleaks reported no leaks,
  dependency audit found no high/critical known vulnerability, Foundry default
  tests passed, and Slither had zero unresolved high or medium findings after
  active-scope triage. `FOUNDRY_PROFILE=assurance forge test --root
  packages/contracts -vv` passed 159 tests, 0 failures, 1 environment-gated
  fork skip, including 256-run/depth-128 invariants and the 512-wallet,
  32-launch, 25,000-action simulation. Live release verification through LAN
  RPC `192.168.50.117:8547` passed 531 checks against
  `/opt/robyn/testnet-releases/03e568a-security-remediation`.
- Finding: no known critical, high, medium, or low Solidity finding remains in
  the reviewed source. Both halves of `SF10-01` are closed through
  direct-transfer rejection and permissionless forced-ETH sweep to immutable
  timelock destinations.
- Follow-up: mainnet remains NO-GO until fresh contracts containing both
  SF10-01 fixes are deployed,
  the remediated public-testnet lifecycle campaign and empty-DB rebuild pass,
  browser and real-wallet acceptance pass, recovery/backup/restore and
  reproducibility gates pass, an uninterrupted eight-hour endurance gate passes,
  and an independent professional audit reviews the final exact commit.

### 2026-07-26 - Security-remediated schema-10 deployment and campaign funding gate

- Context: the high and medium security findings against schema-v9 required
  fresh immutable contracts and pools. The stopped schema-v9 endurance run is
  not evidence for the remediated stack.
- Decision: campaign and endurance tooling must reject schema-v9 manifests
  rather than silently using archived deployment state. An application-only
  repair may follow the immutable deployment commit only when it is a verified
  descendant and both commits are recorded in campaign evidence.
- Result: schema-10 contracts from `e754037bd40c5caee426e31b0886514da9c9ed12`
  are deployed on testnet and independently verified through both LAN and
  public RPCs. Exact release `03e568ac987ce4cdce42c6d99d4cdd6c10e463ae`
  is live at `https://testnet.sherwoodforest.trade`; all six testnet PM2
  processes use `robyn_testnet_schema10_e754037`, LAN RPC
  `192.168.50.117:8547`, and the release verifier passes 531 checks with zero
  ingestion/projection lag. The initialized encrypted 100-wallet campaign is
  `schema10-security-remediation-03e568a`.
- Blocker: its fixed no-reduced-coverage preflight requires
  `0.01725697598448 ETH` including headroom and reserve, while the project
  wallet has `0.010525774830852215 ETH`. Request at least
  `0.006731201153627785 ETH` additional testnet funding before any campaign
  transaction. No campaign wallets have been funded and no campaign action was
  sent.
- Follow-up: after funding, rerun preflight, fund the 100 actors, then complete
  the lifecycle campaign, recovery gates, browser/wallet acceptance, and a new
  uninterrupted endurance run.

### 2026-07-26 - Schema-v9 promotion, browser acceptance, and endurance preflight

- Context: the capped schema-v9 public campaign completed and the final release
  needed an independent index rebuild, exact promotion, browser acceptance, and
  a funded eight-hour endurance gate.
- Decision: use the synchronized LAN RPC for server-side testnet workloads while
  retaining the official RPC as an explicitly approved fallback. Keep the hard
  `0.0015 ETH` reserve and do not reduce endurance coverage to fit funding.
- Files: `scripts/testnet-endurance.mjs`,
  `scripts/testnet-endurance-policy.mjs`, installer and policy tests.
- Commands/tests: empty-database chain rebuild, 515 deployment checks, desktop,
  tablet and mobile in-app-browser acceptance, policy tests, and live encrypted
  100-wallet funding preflight.
- Result: release `19053b1` is live with nine launches, three King awards, zero
  index lag at promotion, and clean browser routes. The LAN RPC matches the
  public head. Funding is short by `0.002142263852084529 ETH`.
- Follow-up: complete recovery and backup/restore, add at least `0.0023 ETH`,
### 2026-07-26 - Bonding purchase cap remediation

- Context: the production curve configuration described a 0.5 ETH maximum
  individual curve purchase, but code review proved the existing immutable
  `maximumNativeSwap` applies only to graduated v4 trading.
- Decision: add a distinct immutable `maximumCurvePurchase` to the curve and
  factory configuration, enforce it in `quoteBuy` and `_buyBonding`, reject a
  cap above the graduation threshold, record it in deployment manifests, and
  independently retain `maximumNativeSwap` for graduated routes.
- Files: `RobynV4BondingCurveMarket.sol`, `RobynV4MarketFactory.sol`, v4 tests,
  testnet deployment/verifier tooling, mainnet curve configuration/validator,
  and the protocol security review.
- Commands/tests: focused cap regression and mainnet curve validation pass.
  The earlier complete assurance run passed 144 tests, but the full suite must
  run again after this bytecode change.
- Result: source enforces the intended mainnet limit. Existing testnet bytecode
  remains unchanged and is no longer the candidate for the full public
  campaign.
- Follow-up: rerun every contract/build/security gate, complete the chain-4663
  fork rehearsal, deploy fresh testnet contracts, rebuild the index, and only

### 2026-07-26 - Compact opt-in launch setup

- Context: new token drafts preselected three reward assets and the artwork
  flow required separate chooser and apply controls, making the first wizard
  step unnecessarily tall.
- Decision: start testnet baskets at zero selected assets, let the routed asset
  picker establish weights as creators add assets, use the artwork tile as the
  accessible file input, and prepare optional artwork automatically during the
  final launch action.
- Files: `guided-launch-wizard.tsx`, `network-launchpad.testnet.tsx`, compact
  wizard styles, and `guided-launch-wizard.test.ts`.
- Commands/tests: Prettier, ESLint, strict web typecheck, and all 57 web tests.
- Result: source validation and immutable release gates pass. Public acceptance
  confirmed the standard desktop and laptop modal needs no internal scroll,
  mobile has no horizontal overflow, the artwork tile opens the chooser, and
  reward roots start empty.

### 2026-07-26 - Creation, profile, atomic purchase, and live wallet acceptance

- Context: creators needed a compact launch flow with automatic authentication,
  routed custom assets, an atomic initial buy, public links, and a real profile.
- Decision: keep SIWE and media sanitization automatic behind user actions,
  make artwork optional, commit website/X into immutable launch metadata, and
  execute the creator's optional purchase inside the coordinator transaction.
- Files: guided launch wizard, asset picker, network launchpad, creator profile
  editor/portfolio, trade panel, metadata APIs/migration 0009, launch token page,
  coordinator, bonding market, contract tests, and live acceptance evidence.
- Commands/tests: 141 Foundry tests; full format, lint, strict types, API/web
  tests; clean devnet and protected testnet builds; chain-46630 rehearsal; 494
  deployment checks; real public atomic launch, sell, creator claim; in-app
  browser desktop and 390x844 checks.
- Result: exact release `6385004` is live and healthy with two canonical
  schema-v9 launches. Atomic Grove proves fallback artwork, immutable links,
  creator avatar/name, atomic purchase, indexed trading, and isolated per-token
  creator fee claiming on public testnet.
- Follow-up: remote IPFS replication, independent audit/penetration testing,
  and real Robinhood Wallet acceptance remain separate future gates.

### 2026-07-24 - Automated campaign identity is immutable and indexed

- Context: public assurance launches must remain visible while being
  unmistakably labeled and tied to the exact release that created them.
- Decision: embed `robynTestCampaign` in sanitized immutable ERC-1046 JSON,
  allow it only with a protected operator token, and project the verified
  binding into additive launch fields. Unknown external metadata cannot acquire
  the Robyn automated-test badge.
- Files: migration `0007_test_campaigns.sql`,
  `apps/api/src/campaign-routes.ts`, metadata preparation/binding routes,
  indexer launch reconstruction, launch API types, market cards, and token
  detail.
- Commands/tests: isolated clean migration through 0007; exact chain-46630
  fork index reconstruction; API campaign authorization and canonical metadata
  tests; repository format, lint, strict types, app tests, Anvil smoke, and all
  102 Foundry tests.
- Result: the isolated indexer reproduced
  `schema8-assurance:<release-sha>:true`; unauthorized operator status requests
  return 404, and campaign fields increase the generated API inventory to 35.
- Follow-up: commit and push, build the encrypted 100-wallet public campaign
  runner, and keep all live cutover/deployment work blocked on the remaining
  audit, funding, reproducibility, and acceptance gates.

### 2026-07-24 - Schema-v8 assurance contracts and fork rehearsal pass

- Context: the full-system assurance release requires shortened testnet
  governance, a current action inventory, a large native-v4 economic campaign,
  and a clean fresh-stack rehearsal before public-chain replacement.
- Decision: domain-separate the CREATE2 oracle hook by exact release and hash
  fetched runtime bytecode directly when writing manifests. This prevents an
  archived hook from occupying the fresh release address and avoids Anvil
  fork-backend `eth_getProof` inconsistencies for reused contracts.
- Files: `packages/contracts/src/dao/RobynTestnetGovernor.sol`,
  `packages/contracts/src/uniswap/RobynV4OracleHook.sol`,
  `packages/contracts/test/RobynTestnetGovernor.t.sol`,
  `packages/contracts/test/RobynV4HundredsUsersSimulation.t.sol`,
  `scripts/deploy-testnet-v4-protocol.sh`,
  `scripts/verify-testnet-v4-deployment.mjs`,
  `scripts/generate-system-action-coverage.mjs`, and
  `config/system-action-coverage.json`.
- Commands/tests: exact-wallet chain-46630 fork deployment and 393-check
  verifier; repository format, lint, strict types, app tests, Anvil smoke, and
  the complete 102-test Foundry suite.
- Result: all checks pass. The large campaign uses 512 actors, 32 atomic
  launches, all 24 assets, 25,000 state-changing trades partitioned over 20
  fixed seeds, three graduations, claims, and shortened governance. No live
  chain transaction was sent.
- Follow-up: commit and push this checkpoint, add campaign identity/API/UI,
  run the deeper audit and high-depth invariant gates, then prepare a fresh
  live deployment only after the complete release gate passes.

### 2026-07-24 - Native-v4 protocol deployed to Robinhood Testnet

- Context: exact commit `63f2e05909a9f82cdb3d9a7bf0a3876a8f74e404`
  passed the 446-check deployment verifier, 24-route financial smoke, full
  regression, 25%-headroom gas gate and two-build reproducibility gate.
- Decision: broadcast the fresh native-ETH v4 package while leaving the
  accepted v3 application serving until post-deployment cutover acceptance.
- Files: `deployments/46630-v4.json`; checksummed evidence under
  `/home/hendo420/robyn-evidence/testnet-v4-live-63f2e05/`.
- Commands/tests: 16 contract creations and 98 configuration transactions;
  live independent verifier 446/446; shared-venue verifier 78/78 in pending
  release mode.
- Result: the verified schema-v7 deployment starts at block `92882804`; the
  genesis token is `0x423e546cC1Ff61218844a73312Eb703c2543dB0C`.
  The encrypted deployer retained `5217587778782403` wei after deployment.
- Follow-up: perform bounded live route and end-to-end smoke, mark the venue
  release-ready only with preserved evidence, rebuild isolated v4 indexes,
  cut over the protected app, and complete in-app-browser acceptance.

### 2026-07-24 - Live v4 StateView deployment recovered and verified

- Context: the first authorized chain-46630 StateView broadcast mined
  successfully but the deployment script rejected checksum-cased
  `poolManager()` output after the transaction.
- Decision: never rebroadcast the already-mined creation. Normalize EVM
  addresses before wiring comparisons and freeze the recovered deployment in
  the shared-v4 venue manifest.
- Files: `scripts/deploy-testnet-v4-state-view.sh`,
  `deployments/46630-uniswap-v4-shared.json`.
- Commands/tests: recovered deployer nonce 116 from block `92878941`; verified
  transaction input against the pinned creation bytecode and constructor,
  verified runtime code, runtime hash and PoolManager wiring.
- Result: StateView `0x8c5db7b072e586ea4ea3ade80d5bac9a34e90fa5`
  is live at transaction
  `0xe67c4bb139e9ca72b470ad698f23974017158c411b45ad062d0f034c909f0175`.
  Runtime hash is
  `0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6`;
  its immutable PoolManager is the reviewed shared mirror at
  `0x8366a39cc670b4001a1121b8f6a443a643e40951`.
- Follow-up: run strict venue verification and final exact-commit rehearsal,
  then broadcast the fresh native-v4 Robyn protocol only after every remaining
  gate passes.

### 2026-07-24 - V4 financial smoke identity correction

- Context: the final exact-commit rehearsal passed all 446 independent
  deployment checks, then its creator-claim step reverted `Unauthorized`.
- Decision: the smoke actor defaults to the deployment manifest's canonical
  deployer rather than Anvil's unrelated first account. An explicit
  `ROBYN_TESTNET_V4_SMOKE_ACCOUNT` override remains available.
- Files: `scripts/smoke-testnet-v4-protocol.sh`.
- Commands/tests: clean chain-46630 fork deployment and independent verifier.
- Result: the failure proved creator authorization was enforced correctly and
  exposed a test-harness identity mismatch, not a protocol-accounting defect.
- Follow-up: rerun the complete financial smoke and gas measurement from a
  fresh fork before live protocol broadcast.

### 2026-07-24 - V4 live deployer guard correction

- Context: the first real protocol invocation failed before broadcast because
  its reviewed-address literal contained an extra `5`.
- Decision: define the reviewed deployer once in the protocol script and
  compare normalized addresses against that exact value, matching the
  StateView phase.
- Files: `scripts/deploy-testnet-v4-protocol.sh`.
- Commands/tests: encrypted keystore address preflight on chain 46630.
- Result: the fail-closed guard prevented all sends; no protocol transaction
  occurred under the incorrect check.
- Follow-up: rerun the exact-commit gates required by the changed release
  script, then perform the authorized broadcast.

### 2026-07-24 - Native-ETH Uniswap v4 contract checkpoint

- Context: the user approved replacing active v3/tmUSD testnet architecture
  with a fresh native-ETH v4 release while preserving v3 until cutover.
- Decision: use the shared unlisted chain-46630 v4 mirror only when its frozen
  provenance passes. Robyn launch pools initialize atomically with the
  observation-only hook and graduate into an immutable full-range position.
- Files: `packages/contracts/src/uniswap/RobynNative*.sol`,
  `packages/contracts/src/uniswap/RobynV4*.sol`,
  `packages/contracts/test/RobynV4NativeProtocol.t.sol`,
  `deployments/archive/46630-v3-b3ab91f/`.
- Commands/tests: focused `RobynV4NativeProtocolTest` 8/8 pass; complete
  `forge test --root packages/contracts -q` passes.
- Result: atomic launch, native trading, graduation, locked-liquidity
  invariants, fee routing, oracle safety and bounded launch-token fee sales are
  implemented locally. Graduation ETH that cannot enter the exact
  terminal-price full-range position is returned and routed through the
  immutable fee policy; token rounding dust stays permanently immobilized.
- Follow-up: freeze and verify the venue manifest, deploy/verify StateView,
  finish deployment scripts and invariants, integrate faucet-first catalog,
  indexer/API and UI, then perform gated testnet deployment and browser
  acceptance. No v4 broadcast has occurred.

### 2026-07-23 - Robyn protocol deployed to Robinhood Testnet

- Context: The committed DEX manifest and exact `origin/main` release passed a
  fresh full-bundle estimate with 25% headroom.
- Decision: Broadcast the schema-v6 Robyn package using the encrypted deployer
  and the user-approved local-pin and sole-owner DAO bootstrap modes.
- Files: `deployments/46630.json`, `deployments/46630-uniswap-v3.json`.
- Commands/tests: 108 phase-two transactions completed; the independent
  verifier proved contract code and wiring, the 24 route-ready mock assets,
  immutable ERC-1046 metadata, coordinator-seeded launch, sealed exclusions,
  DEX configuration, DAO allocation and 50/25/20/5 fee policy.
- Result: The package was verified at block 92821105. The deployer nonce is 113
  and its remaining balance is about 0.0079218514 ETH. The testnet genesis token
  is `0x2e8536feb01e9081f3cec1f933e4a44dca2a20a4`; the atomic coordinator is
  `0x7bfF926aeef64932327720Fafe19091AB47E7FB2`. Checksummed evidence is under
  `/home/hendo420/robyn-evidence/testnet-release-effed83/`.
- Runtime correction: The first live index showed zero launches because the
  manifest used the network head read after launch, block 92820872, while the
  canonical coordinator event was at block 92820861. The generator now records
  the launch receipt block and the independent verifier requires the coordinator
  event to be discoverable from `deploymentBlock`. Rebuild the isolated index
  from the corrected manifest.
- Wallet correction: Public in-app-browser acceptance opened the multi-wallet
  modal, but selecting WalletConnect crashed because `cuer 0.0.3` passes
  `border: 0` while newly resolved `qr 0.6.0` rejects zero. Pin transitive
  `qr 0.5.5`, rebuild the protected bundle and rerun the WalletConnect flow.
- Follow-up: Restart the isolated testnet data plane against the corrected
  block, verify the public Quick Tunnel and complete browser/onchain acceptance.
  Do not describe local-only IPFS as redundant.

### 2026-07-23 - Robinhood Testnet DEX phase deployed

- Context: Exact `origin/main` passed the live gas and external-input gates and
  the official Uniswap chain-46630 registry still returned 404.
- Decision: Deploy the pinned, explicitly test-only
  `robyn-controlled-uniswap-v3-testnet` suite before the Robyn protocol.
- Files: `deployments/46630-uniswap-v3.json`.
- Commands/tests: Five encrypted-keystore transactions deployed WETH9, factory,
  position manager, QuoterV2 and SwapRouter02. The independent manifest verifier
  proved chain 46630, bytecode/runtime hashes, constructor wiring and fee tiers.
- Result: Phase one completed at deployment block 92819428. The manifest and
  checksummed evidence are preserved under
  `/home/hendo420/robyn-evidence/testnet-release-effed83/`.
- Follow-up: Commit the immutable DEX manifest, rerun exact-release readiness,
  then broadcast and independently verify the Robyn protocol phase.

### 2026-07-23 - Testnet bootstrap inputs resolved

- Context: The user asked Codex to obtain WalletConnect configuration and
  approved an ephemeral `trycloudflare.com` hostname, local-only IPFS pinning,
  and a sole-owner DAO bootstrap.
- Decision: Use the existing encrypted deployer as the sole initial RDAO
  recipient. Quick Tunnel and local-only pinning require explicit release flags
  and remain disclosed, temporary testnet-preview exceptions.
- Files: `scripts/check-testnet-external-inputs.sh`,
  `scripts/validate-rdao-allocation.sh`, `scripts/deploy-testnet.sh`,
  `scripts/run-testnet-tunnel.sh`,
  `infrastructure/systemd/robyn-testnet-tunnel.service`.
- Commands/tests: Reown project creation and exact Quick Tunnel allowlisting
  passed through the in-app browser. The protected allocation manifest passed
  with `allocationCount=1` and `soleOwnerBootstrap=true`; the external-input
  gate passed in exception mode and failed closed when the Quick Tunnel flag
  was omitted. The independent deployment verifier initially caught stale
  remote-pin and multi-recipient assumptions; after correction, the complete
  chain-46630 DEX, 24-asset, launch, graduation, conversion and claim rehearsal
  passed in local-pin mode. User-story traceability covers 208/208 requirements.
- Result: Protected runtime configuration exists outside Git under
  `/home/hendo420/.config/robyn/testnet/`; the Quick Tunnel is persistent under
  systemd. The public origin returns 502 until the isolated testnet application
  services are deployed and started.
- Follow-up: Validate and push the exact release, deploy the DEX and Robyn
  contracts to chain 46630, start the isolated testnet services, then complete
  onchain and in-app-browser acceptance.

### 2026-07-23 - Robinhood Testnet asset release candidate

- Context: The user authorized Robinhood Testnet deployment after every
  specified gate and required external input passes.
- Decision: Keep devnet isolated on chain 31337 and deploy a separate
  chain-46630 stack. Use 23 clearly labeled 18-decimal Robyn stock/ETF mock
  assets plus the test DEX WETH, with chain plus address as canonical identity.
  Manual assets remain inspectable but selectable only when the route registry
  reports a funded and safe conversion route.
- Files: `config/assets/robinhood-testnet-curated.json`,
  `packages/contracts/src/testnet/TestnetAssetConversionRouter.sol`,
  `packages/contracts/src/RobynDaoLaunchCoordinatorV5.sol`,
  `apps/api/src/asset-catalog.ts`,
  `apps/web/src/components/basket-asset-picker.tsx`,
  `scripts/deploy-testnet.sh`,
  `scripts/check-testnet-external-inputs.sh`,
  `infrastructure/pm2/ecosystem.testnet.config.cjs`, and
  `infrastructure/nginx/robyn-testnet.conf`.
- Commands/tests: `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`,
  `pnpm run test`, `python3 scripts/validate-user-stories.py`,
  `scripts/check-robinhood-testnet-asset-provenance.sh`,
  `scripts/measure-robinhood-testnet-deployment-gas.sh`, and
  `scripts/rehearse-testnet-stack.sh`.
- Result: 175 stories cover 194/194 requirements; all application and 75
  Foundry tests pass; the 112-transaction estimate is about
  0.001182601277067904 ETH including the conservative L1-data upper bound;
  the 0.01 ETH deployer balance exceeds 25% headroom; the isolated rehearsal
  completed atomic launch, pre/post-graduation trading, three basket
  conversions, holder/creator/RDAO claims and clean rollback. Last verified
  2026-07-23.
- Follow-up: provide the four external inputs, rerun the exact-commit protected
  build and stable-origin wallet acceptance, then authorize the two-phase DEX
  and protocol broadcast. Do not deploy mainnet.

### 2026-07-23 - Creator-image native memory correction

- Context: Cache expiry correction alone did not prevent an API restart in the
  compressed multi-launch regression. Node diagnostic reports at 418 MiB RSS
  showed only 42 MiB live JavaScript, 5 MiB external memory and no detached
  contexts. RSS increased with each sanitized creator upload.
- Cause: Sharp/libvips retained native cache and allocator high-water memory for
  unique image inputs. The default cache cannot produce useful hits in this
  content-addressed upload pipeline.
- Decision: Disable Sharp's process-wide operation cache, bound Sharp worker
  concurrency to one, and run both devnet and testnet APIs with
  `MALLOC_ARENA_MAX=2` and `MALLOC_TRIM_THRESHOLD_=65536`. Keep the existing
  384 MiB PM2 watchdog and 256 MiB old-space limit. Analytics queries now also
  select only the seven event topics used by the canonical projection.
- Files: `apps/api/src/creator-media.ts`, `apps/api/src/sharp.d.ts`,
  `apps/api/test/creator-media.test.ts`, `apps/api/src/server.ts`,
  `infrastructure/pm2/ecosystem.config.cjs`,
  `infrastructure/pm2/ecosystem.testnet.config.cjs`,
  `scripts/validate-pm2-config.mjs`.
- Verification: 38 API tests, strict typecheck and PM2 validation pass. Exact
  release `b02eae201aa224636a6019713740b28a8cbc12c2` completed eight launches,
  four graduations and 173 workload transactions with zero restarts; API RSS
  ended at 328,855,552 bytes.
- Follow-up: Prove endpoint p95 at the normal soak cadence, then start a fresh
  uninterrupted eight-hour soak from the final exact release.

### 2026-07-23 - Realistic-soak API memory correction

- Context: The first realistic eight-hour soak failed after 3,710 seconds when
  `robyn-api` RSS reached 415,289,344 bytes against its 402,653,184-byte PM2
  ceiling. API RSS rose from 180 MiB to 396 MiB as three launches were added.
- Cause: `SingleFlightTtlCache` removed an expired value only when that same key
  was requested again. Each newly indexed launch changed the discovery key, so
  expired generations retained complete decoded-log analytics projections.
- Decision: Prune every expired cache entry before each access, reduce the
  discovery analytics cache from 16 to four entries, and set a reviewed
  256-MiB V8 old-space limit inside the existing 384-MiB API process budget so
  garbage collection occurs before the external PM2 kill threshold.
- Files: `apps/api/src/single-flight-cache.ts`,
  `apps/api/test/single-flight-cache.test.ts`, `apps/api/src/server.ts`,
  `infrastructure/pm2/ecosystem.config.cjs`,
  `infrastructure/pm2/ecosystem.testnet.config.cjs`,
  `scripts/validate-pm2-config.mjs`.
- Tests: 37 API tests pass, including two new cache-generation regressions;
  strict API typecheck, PM2 configuration validation, formatting and diff
  checks pass.
- Evidence: The invalid soak summary and checksums remain under
  `/var/lib/robyn/soak/5844cf333757e6313e7db0a8cd615fd9f5f94389/`.
- Follow-up: Run full gates, commit and push, build/promote a replacement exact
  release, run a dense multi-launch memory regression, and only then restart
  the full eight-hour soak.

### 2026-07-23 - Realistic-use soak workload

- Context: The product owner rejected a read-heavy soak and required simulated
  real creation, trading and related user behavior during the eight-hour run.
- Decision: Keep 100 stable read personas and five-minute normal trade/claim
  cycles, then add a full creator lifecycle every four write cycles. Rotate six
  funded creators, locally pin sanitized artwork and metadata, derive the token
  only from its atomic receipt, wait for indexing, bind immutable metadata and
  add the new market to subsequent traffic. Graduate every second created
  launch and immediately prove post-graduation selling.
- Files: `scripts/soak-release.mjs`, `scripts/soak-policy.mjs`,
  `scripts/soak-policy.test.mjs`, `docs/release-operations.md`,
  `docs/local-release-assurance.md`.
- Commands/tests: Seven Node policy tests and Prettier pass. A 22-second live
  rehearsal performed 27 transactions, one authenticated/pinned/atomic launch,
  one graduation, one post-graduation sell, one profile update, five ordinary
  write cycles and 60 actor reads with zero errors, alerts or restarts.
- Result: The default eight-hour workload is bounded to at most 23 new
  launches, stays below wallet upload-rate limits, records transaction hashes
  and CIDs, and fails closed on any incomplete lifecycle. The first rehearsal
  caught quoted Foundry string decoding before binding; the decoder was fixed
  and the resulting preparation was independently bound to its canonical token.
- Follow-up: Commit and push, build and promote the exact changed release,
  verify the served artifact, then explicitly start the fresh eight-hour soak.

### 2026-07-23 - Immutable IPFS token metadata release in progress

- Context: The product owner authorized stopping the active eight-hour soak to
  implement immutable ERC-1046 metadata and IPFS-hosted token artwork.
- Decision: Preserve the interrupted run as
  `incomplete-superseded-by-ipfs-release`; deploy fresh local protocol
  contracts because token CREATE2 inputs and coordinator events change.
- Infrastructure: Official checksum-verified Kubo 0.42.0 runs natively as
  `robyn-ipfs.service`. Its RPC and gateway bind only to loopback, its gateway
  has `NoFetch=true`, and swarm port 4001 remains available.
- Branch: `codex/ipfs-token-metadata`.
- Evidence: The superseded soak is checksummed under
  `/home/hendo420/robyn-evidence/ipfs-release-superseded-soak-20260723T153100Z/`.
- Security: Remote pin credentials belong only in `/etc/robyn/ipfs.env`; none
  are present in Git or memory. Local devnet may disclose remote pins as
  pending, while protected testnet requires a configured remote pin provider.
- Result: Six controlled launches now expose immutable ERC-1046 `tokenURI()`
  values. Browser acceptance found and fixed Nginx request/proxy buffer
  ownership drift; `install-lan-edge.sh` now restores both directories for the
  configured worker. The accepted browser launch is bound to metadata CID
  `bafkreif2hh2qb2rm37fw2yxjzoqr2hiq6pv4tzcvy4yuulqys7mf6m5bie`.
- Validation: The final implementation passed format, lint, strict typecheck,
  application tests, Anvil smoke, 72 Foundry tests, optimized builds, gitleaks,
  dependency audit, Slither high-severity gate, live deployment verification,
  25-pin reconciliation, the 512-wallet/32-launch/25,000-action economic
  campaign and two-clean-archive reproducibility comparison.
- Recovery: The first IPFS-era restore found that `pg_dump` and its table-count
  manifest used different live snapshots. `backup-state.sh` now exports one
  repeatable-read PostgreSQL snapshot for both and refuses to back up a commit
  other than the exact served release. Backup
  `robyn-state-20260723T163851Z.tar.zst.age` restored 16 tables, 27 artifacts
  and 25 application CIDv1 pins with chain/API/keeper/browser smoke and
  `liveStateTouched=false`. The live keeper was paused only while proving the
  unchanged-live-state assertion, then restored and persisted with zero PM2
  restarts.
- Reboot: Native Anvil, PostgreSQL, Redis, MinIO, Kubo, Nginx, Prometheus,
  Alertmanager, local alert receiver and all six exact-release PM2 processes
  recovered. Kubo 0.42.0 retained its pins and post-reboot in-app-browser
  rendering of the accepted token remained verified.
- Monitoring: Controlled devnet does not label queued remote pins stale when
  `/etc/robyn/ipfs.env` has no Pinning Service endpoint/token. Local failures
  and remote `failed` objects still alert; queued/pinning remote objects become
  stale when a provider is configured. The live metric returned zero and all
  17 Prometheus rules were healthy before the final soak candidate.
- Checkpoint: The schema-v5 contracts/data plane/UI are implemented and the
  controlled devnet was reset and reseeded with five token-specific immutable
  metadata documents. All five live token bindings are `robyn-sanitized`, and
  their PNG, WebP, and metadata objects are locally pinned. Remote status is
  intentionally `queued` because no external pin credentials are configured.
- Bugs fixed during reseeding: Nginx request-body temp ownership is now
  installed explicitly for the configured worker user; the CID-only gateway
  location is valid quoted PCRE; and the artifact service permits canonical
  `image/png` objects in addition to WebP.
- Follow-up: Pin and freeze the token list, complete recovery/documentation
  closure, run browser and full release acceptance, promote an immutable
  candidate, then start a fresh one-shot eight-hour soak.

### 2026-07-23 - First full-soak failure and fail-closed correction

- Context: The exact-release soak remained active after the keeper restarted
  and Prometheus fired. It accumulated 104 errors rather than stopping.
- Decision: Preserve the failed evidence, stop the invalid run, raise the
  measured keeper memory cap from 256 MiB to 384 MiB, and make the first sample
  assertion terminal. Compare restart counters per process rather than only in
  the final aggregate.
- Files: `infrastructure/pm2/ecosystem.config.cjs`,
  `scripts/soak-policy.mjs`, `scripts/soak-policy.test.mjs`,
  `scripts/soak-release.mjs`, `scripts/build-release.sh`.
- Commands/tests: Three Node policy tests; PM2 configuration validation; a
  controlled live keeper restart made the short runner exit 1 after one error
  in 14.5 seconds and produced valid checksums.
- Result: Fail-closed behavior is proven. A high-intensity short workload
  regression under the new release and memory cap remains required before
  restarting the full eight-hour clock.
- Follow-up: Run complete release gates, promote the exact pushed artifact,
  execute the compressed workload regression, then start a fresh one-shot soak.

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
  fixed operator ownership for the clean source checkout. Visual browser
  inspection then exposed missing same-origin media routing. The isolated edge
  and WebP assertion were added, and the final CLI plus in-app-browser recovery
  rerun passed without touching live state.
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

- 2026-07-26: compact opt-in launch flow checkpoint
  `a490107411ddd9a3363da3ca110a6c9d139df1ad` passed all 57 web tests, strict
  typecheck, lint, the immutable testnet builder, and all 494 deployment checks.
  Browser acceptance confirmed the wizard layout and content heights match at
  1440x900 and 1280x800, horizontal overflow is zero at all checked viewports,
  the artwork tile emits a single-file chooser, `Use artwork` is absent, and
  reward roots initialize at `0/3` with Continue disabled until a valid basket
  is deliberately selected.

- 2026-07-26: exact public release
  `6385004380c63ea5445d7668f286d2e000882d1f` passed all 494 deployment checks
  after a real payable atomic creation transaction. Atomic Grove received
  `99,090,081.892629663330300272 GROVE` in the launch receipt path. Follow-up
  approval and sale transaction `0x8fb15111076dc3c78459c61efc36235a5b483b979c825991e973dc51e558d8e5`
  sold half the remaining creator balance; claim transaction
  `0x192f57f7d40c50455e8856bdd4a00dfe075281f53682fce366eb20b3cb14cb3c`
  reduced token-specific claimable creator ETH to zero with lifetime accrued
  equal to lifetime claimed. Public APIs report two launches, zero ingestion
  and projection lag after reconciliation, healthy keeper/artifacts, zero PM2
  restarts, and no firing alerts. In-app-browser acceptance confirmed the
  shortened artwork surface, routed catalog, custom-address tab, icon controls,
  atomic initial purchase copy, website/X links, hydrated creator name/profile,
  responsive 390x844 dialog, and zero browser warnings/errors.

- 2026-07-26: ETH-native/USD-display release
  `82e1dc4e3f7d2280217593c21bf250537907feeb` passed formatting, lint, all
  package typechecks and tests, Anvil smoke, 123 Foundry tests, protected
  testnet bundle construction, and the 490-check promotion verifier. Coinbase
  ETH-USD spot returned a valid unauthenticated reference from the VM.
  In-app-browser desktop and mobile acceptance confirmed USD market caps on
  ticker/cards/detail; focus and pointer hover changed token market cap to ETH;
  the chart changed price and market cap between USD and ETH; the basket showed
  three 64x64 undistorted images, three explorer-linked addresses, names,
  symbols, weights, and descriptions; removed accounting/provenance sections
  were absent; overflow and browser warning/error counts were zero.

- 2026-07-24: schema-v8 route-safety and internal-audit checkpoint passed the
  120-test Foundry suite, the deterministic 512-wallet/32-launch/25,000-action
  campaign, and native-v4 stateful invariants at 256 runs and depth 128 with
  32,768 calls per invariant. A fresh exact-project-wallet chain-46630 fork
  deployment passed 490 checks and froze reference protection for all 24
  basket routes. Application format, lint, strict types, unit tests, optimized
  build, protected testnet bundle scan, `pnpm audit` with zero advisories, and
  `gitleaks` with zero findings passed. No live transaction was sent.

- 2026-07-24: immutable assurance-campaign metadata, migration, API, indexer,
  UI badge, and protected status endpoint passed isolated migration and
  chain-46630 fork index-rebuild integration. Format, lint, strict types, 48
  API tests, 17 web tests, the complete app suite, Anvil smoke, and all 102
  Foundry tests passed.

- 2026-07-24: schema-v8 assurance checkpoint passed a fresh exact-project-wallet
  chain-46630 fork deployment with 393 independent manifest, runtime, role,
  route, governance, pool, and launch checks. Repository format, lint, strict
  types, application tests, Anvil smoke, all 102 Foundry tests, and the
  generated native-v4 action-coverage gate passed.

- 2026-07-24: DAO availability regression tests passed: web format, lint,
  strict types and 17 tests; API strict types and 46 tests. The live
  chain-46630 `/api/dao/activity` request fell from more than 20 seconds and a
  timeout to HTTP 200 with 17 indexed protocol/governance logs after one
  address-filtered RPC range query.

- 2026-07-24: Sherwood Forest custom-domain acceptance passed on
  `https://sherwoodforest.trade`. Root, Markets, the canonical v4 token,
  Create, DAO and Portfolio rendered the exact protected build with no
  horizontal overflow at desktop or 390x844. The mobile guided creator flow
  reached the three-asset TSLA/AMD/AMZN basket editor at 100%, Cloudflare
  reported the named tunnel healthy, both root and `www` API status returned
  HTTP 200 on chain 46630, and the WalletConnect selector exposed Robinhood,
  MetaMask, Rabby, Coinbase, Rainbow, Trust, Ledger and browser-wallet paths.

- 2026-07-23: Immutable IPFS browser acceptance created and independently
  verified `$IPFSA` at `0x2a482c145e1b64ef58257cd93574bac7f41b4b0a`.
  Its constructor-set `tokenURI()` matches the receipt-bound API record and
  local Kubo block, whose canonical 302-byte JSON contains ERC-1046 interop,
  name, symbol, decimals, description and pinned PNG/WebP CIDs. Remote pin
  remains queued because no provider credential is configured, which is
  permitted only for controlled devnet.

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

### 2026-07-25 - Launch Wizard Became Global

- Context: The homepage still repeated the complete "Create a token holders want
  to earn with" launchpad section, and launch actions navigated to a dedicated
  `/create` route before opening the wizard.
- Decision: Mount one modal-only launchpad inside the root wallet provider and
  open it through a shared browser event. Header, homepage, and creator-profile
  launch actions now open the wizard over the current route without navigation.
- Files: `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`,
  `apps/web/src/components/launch-token-trigger.tsx`, `site-header.tsx`,
  `guided-launch-wizard.tsx`, creator portfolio, both network launchpads, and
  `apps/web/next.config.ts`.
- Commands/tests: Prettier, web Vitest (23 tests), strict TypeScript, ESLint,
  and `git diff --check` pass before exact release build and browser acceptance.
- Result: The repeated homepage launch section and Create navigation item are
  removed. `/create` has no page and redirects to `/` for old bookmarks.
- Follow-up: Verify the modal opens without URL changes on home, Markets,
  Portfolio, and a token page after exact promotion, then resume endurance from
  the preserved transaction journal without replay.

### 2026-07-25 - Create Route Is Modal Only

- Context: The dedicated `/create` route repeated launchpad marketing, launch
  counts, guided-step explanation, a fallback Start launch panel, transaction
  status, and a network disclaimer behind the guided launch dialog.
- Decision: Keep the reusable homepage launchpad presentation unchanged, but
  render `/create` in `modalOnly` mode so the header Launch a token action opens
  the guided dialog directly and closing it reveals no duplicate launch section.
- Files: `apps/web/src/app/create/page.tsx`,
  `apps/web/src/components/guided-launch-wizard.tsx`, both network launchpad
  implementations, and the virtual module declaration.
- Commands/tests: web Vitest (23 tests), strict TypeScript, ESLint, Prettier,
  and `git diff --check` pass before immutable release build and browser UAT.
- Result: The requested background content is absent from `/create`; the guided
  launch modal and homepage launchpad remain available.
- Follow-up: Promote the exact pushed release, verify the public route through
  the Codex in-app browser, and resume the preserved endurance journal.

### 2026-07-25 - Removed public testnet smoke console

- Context: The homepage still exposed an old genesis-token smoke console that duplicated the header wallet control and canonical token, Portfolio, and DAO workflows.
- Decision: Keep the console available only in controlled devnet; remove it from the Robinhood Testnet homepage.
- Files: `apps/web/src/app/page.tsx`.
- Result: Public users use the global wallet control and normal launchpad surfaces instead of hardcoded buy, convert, claim, and sell test actions.
- Follow-up: Continue the existing checksummed endurance journal without replay after exact promotion.

### 2026-07-25 - RDAO-gated governance access

- Context: The public header and direct DAO routes exposed governance surfaces to disconnected and nonmember visitors.
- Decision: Hide DAO navigation unless the connected wallet has a positive canonical RDAO `balanceOf`; direct DAO and proposal routes fail closed behind the same onchain membership check.
- Files: `apps/web/src/components/dao-access.tsx`, network-selected DAO access modules, `site-header.tsx`, DAO routes, and `dao-access-policy.ts`.
- Commands/tests: 23 web unit tests, strict typecheck, lint, optimized devnet build, protected testnet bundle scan, full immutable release gates, 490-check promotion verifier, and Codex in-app-browser desktop/mobile acceptance.
- Result: Disconnected wallets see no DAO navigation or member controls. Membership-check failures also remain closed. Feature implementation commit: `64f587784d2b4b4cb621b1152d765e84c5113ddd`.
- Follow-up: Continue the existing checksummed eight-hour endurance journal without replay.


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

### 2026-07-25 - Wallet-gated Portfolio and public user profiles

- Context: Portfolio should appear only for a connected wallet, while browser acceptance still needs a safe way to inspect a populated portfolio without an extension wallet.
- Decision: Gate the Portfolio nav on real wagmi/devnet wallet state. Permit one session-only read-only UAT identity matching the configured public deployment address, linking to `/users/[address]`; it is not a connection and has no signer.
- Files: `apps/web/src/components/network-portfolio-access.*.tsx`, `apps/web/src/lib/portfolio-access-policy.ts`, `apps/web/src/app/users/[address]/page.tsx`, portfolio/creator components, header and creator links.
- Commands/tests: web Vitest 26/26, strict typecheck, ESLint, Prettier, and `git diff --check` passed before release build.
- Result: Connected users retain the unified `/portfolio` dashboard. Other users can inspect public profile, holdings, created tokens, and public reward/fee state through `/users/[address]`, but cannot edit or claim.
- Verification: Exact release promotion passed 490 checks. In-app-browser UAT passed normal disconnected nav hiding, the session-only read-only UAT entry, public creator/holdings rendering, creator links, disabled private controls, zero console errors, and zero horizontal overflow at desktop, tablet, and 390 by 844 mobile.
- Follow-up: Promote the final documentation commit and resume the preserved endurance journal without replay.

### 2026-07-25 - Unlinked operator health dashboard

- Context: Operational component status and the testnet disclaimer cluttered the public homepage; the user wanted those removed and a separate unlinked health view for administration.
- Decision: Remove the homepage system strip and bottom testnet notice. Add public read-only `/admin/health` plus its refresh feed at `/admin/health/status`; do not link either in site navigation and do not expose credentials, privileged RPC methods, wallet actions, Prometheus internals, or operator controls.
- Files: `apps/web/src/app/page.tsx`, `apps/web/src/app/admin/health/page.tsx`, `apps/web/src/app/admin/health/status/route.ts`, `apps/web/src/components/admin-health-dashboard.tsx`, `apps/web/src/lib/admin-health.ts`, and dashboard styles/tests.
- Commands/tests: Web Vitest 28/28, strict typecheck, ESLint, Prettier, and diff checks pass before release build.
- Result: The dashboard refreshes every 15 seconds and reports release identity, RPC chain/head/latency, ingestion and projection blocks/lags/cycles, RPC retry/degradation state, keeper/artifact heartbeats, and indexed launch/log counts.
- Verification correction: The first promotion exposed that public `/api/*` is reserved for the backend API. The refresh feed moved under `/admin/health/status`; the 404 candidate was not accepted.
- Verification correction: The next candidate exposed that the web PM2 process did not receive `ROBYN_RELEASE_SHA`; explicit release identity wiring was added so the operator page can prove the served commit.
- Browser correction: Server-local `toLocaleString()` output caused a React hydration mismatch in the browser. Dashboard timestamps now render as deterministic UTC; the mismatched candidate was not accepted.
- Follow-up: Build, promote, run in-app-browser acceptance on homepage and `/admin/health`, then resume the preserved endurance journal without replay.

### 2026-07-25 - Homepage active-market ranking

- Context: The user wants the main page to feature tokens with real action, high market caps, substantial volume, and many traders instead of arbitrary/newest launches.
- Decision: Rank all indexed markets through a deterministic weighted ordinal score: 35% 24-hour volume, 30% current market cap, 20% unique 24-hour traders, and 15% 24-hour trade count. Keep unindexed markets last and use volume, cap, then newest launch as tie-breakers.
- Files: `apps/web/src/lib/market-ranking.ts`, its unit tests, homepage selection/copy, `MarketCard`, and compact four-column market stats.
- Commands/tests: Web Vitest 30/30, strict typecheck, ESLint, Prettier, and diff checks pass before release build.
- Result: The homepage hero and first four cards derive from the same transparent multi-signal activity ranking, and cards display market cap, 24-hour volume, unique traders, and trade count.
- Follow-up: Build/promote the exact release, run in-app-browser desktop/mobile acceptance, and resume the preserved endurance journal without replay.

### 2026-07-26 - Exact schema-v9 100-wallet fork campaign passed

- Context: The schema-v9 mainnet-readiness gate required the final campaign tooling to prove the additional hook fee, direct v4 trading, third-party liquidity dilution, settlement, claims, and governance before a fresh public-testnet deployment.
- Decision: Rehearse the exact pushed commit on an isolated Robinhood Testnet chain-46630 Anvil fork. Public-testnet fee values may be supplied only through the runner's existing loopback-and-rehearsal-only overrides because Nitro's L1 fee precompile is not implemented by Anvil.
- Release: `5e9b7a3fec4ead070abcbbc5c2133b0880607d3c`.
- Result: The fresh deployment passed its verifier, then 100 deterministic actors completed eight atomic launches and 2,178 confirmed transactions, including 2,078 product writes. The run covered three graduations, all 24 basket routes, exact-input and exact-output Universal Router swaps in both directions, full-range and concentrated third-party liquidity, native and launch-token hook settlement, conversion-generated fee settlement, governance, holder claims, token-specific creator claims, DAO-holder claims, and residual sweeping.
- Accounting evidence: The runner preserved the project reserve, left only recorded per-actor gas dust, and recorded hook settlement for all three graduated launches. The campaign exceeded the fixed 1,500-write requirement without replaying confirmed transactions.
- Evidence: `/home/hendo420/robyn-evidence/schema9-mainnet-readiness-d76244a/rehearsal/campaign-all-5e9b7a3-resumed2.log` and `/tmp/schema9-campaign-5e9b7a3/state/`.
- Follow-up: Seal checksums, run the fresh public-testnet funding/deployment preflight, deploy the capped schema-v9 candidate only if reserve and headroom gates pass, then complete public campaign, index/browser/recovery acceptance, and the uninterrupted eight-hour gate.

### 2026-07-26 - Schema-v9 release tooling corrections

- Context: Exact-candidate reproducibility and endurance review found release-tool assumptions that predated the schema-v9 worktree and capped bonding markets.
- Reproducibility fix: `scripts/verify-reproducible-builds.sh` now resolves the repository containing the script instead of hardcoding `/home/hendo420/Robyn`. The hardcoded path had successfully compared the older presentation worktree and therefore was not valid schema-v9 evidence.
- Endurance fixes: Graduation top-ups are bounded by each market's immutable `maximumCurvePurchase`; graduated launches trade through the v4 asset router instead of calling the closed bonding market; the workload periodically harvests locked LP fees, settles native hook fees, converts launch-token hook fees when safety checks permit, and settles conversion-generated native fees.
- Final-gate policy: Endurance completion now fails closed unless it records four endurance launches, two graduations, post-graduation buys and sells, an LP harvest, both hook settlement paths, holder/creator/governance-holder claims, and governance execution.
- Commands/tests: Shell syntax, Prettier, 12 endurance-policy tests, 15 campaign tests, and diff checks pass.
- Follow-up: Commit and push these corrections, rerun exact-candidate reproducibility, then run the corrected eight-hour workload only after the fresh public schema-v9 deployment and campaign pass.

### 2026-07-26 - Deployment verifier missing-address guard

- Context: Running the schema-v9 verifier against the archived predecessor manifest crashed by issuing `eth_getCode` with a null Universal Router address.
- Decision: Validate every required schema-v9 contract address before any RPC call and return structured failed-check evidence when an address is absent.
- Result: A deterministic regression test proves malformed manifests fail with explicit missing-contract labels, no stderr crash, and no RPC request. The archived uncapped deployment remains intentionally ineligible for promotion; it cannot satisfy the new `maximumCurvePurchase` read.
- Files: `scripts/verify-testnet-v4-deployment.mjs`, `scripts/test/testnet-v4-deployment-verifier.test.mjs`, and root test wiring.
- Follow-up: A fresh schema-v9 deployment manifest must contain the Universal Router and immutable curve cap and pass the complete verifier before cutover.

### 2026-07-27 - Final assurance deployment and isolated index rebuild

- Context: Final internal testnet assurance froze source commit `e6dd172e3f77dcbf8be2c7197d007b66295ad504`; the manifest commit is `97d8db896f2d41c5ca72ddd05a68b4c8819c338f`.
- Result: Internal audit, 256-run/depth-128 invariants, 512-wallet/25,000-action simulation, no-broadcast Robinhood mainnet fork rehearsal, two clean reproducible builds, exact release build, live chain-46630 deployment, and LAN/public-RPC deployment verification passed. The active new coordinator is `0x63BBC689a217BD6bF3a13EE0f07123FF734E177E`; deployment block is `93808580`.
- Index rebuild: Fresh database `robyn_testnet_final_e6dd172` was migrated and rebuilt only from canonical logs through isolated ingester/projector processes. It projected the single genesis launch at block `93808760`, matched the manifest and onchain launch count, and reached zero ingestion/projection lag with no restarts. An isolated API, artifact service, and keeper are healthy on ports 3112/3211 and Redis DB 3; the public schema predecessor remains active.
- Release: Immutable staged artifact `/opt/robyn/testnet-releases/97d8db8-final-assurance` passes its release gates and complete checksum verification. It has not been publicly promoted.
- Blocker: Fixed campaign `final-assurance-e6dd172` has 100 encrypted actors but its fail-closed preflight requires `0.01682413048944 ETH` including reserve and headroom. Controlled available balance was `0.009913879590852215 ETH`, leaving about `0.006910251 ETH` short. Do not reduce campaign coverage or the `0.0015 ETH` reserve; obtain faucet funding before `fund` or `all`.
- Follow-up: Complete the 1,510-write campaign, reconciliation, browser and real-wallet acceptance, recovery/restore, public promotion, and fresh ten-hour accumulated-healthy endurance gate.

### 2026-07-27 - Final assurance encrypted backup and isolated restore

- Context: The fresh security-remediated candidate required a recovery proof before public promotion and endurance.
- Result: Encrypted backup `/var/backups/robyn/sherwood-testnet-final-20260727T062704Z.tar.zst.age` and its checksum passed an isolated restore. The restored PostgreSQL fingerprint exactly matched `robyn_testnet_final_e6dd172`; 77 MinIO artifacts and 10 CID mappings were verified; an empty Kubo repository reproduced the recorded CIDs; and isolated artifact/API services on alternate ports reported chain `46630` with nine launches without reading live data directories.
- Evidence: `/home/hendo420/.local/state/robyn-testnet-campaigns/final-assurance-e458382/backup-restore-summary.json`.
- Follow-up: Build and promote the exact pushed documentation commit, complete automated browser and real-wallet acceptance, then start the ten-hour endurance gate.

## Open Follow-ups

- Configure a vendor-neutral IPFS Pinning Service endpoint/token in the
  protected testnet API environment.
- Complete independent browser-persona UAT when subagent runtimes expose the
  Codex in-app browser, or obtain an explicit product-owner waiver. Root-agent
  serialized UAT is complete but is not independent.
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

### 2026-07-25 - Dedicated LAN Robinhood RPC node bootstrap

- Context: The user explicitly authorized separate LAN host `192.168.50.117` for chain data, superseding the earlier single-VM preference for this capacity-bound service.
- Decision: Use the supported pinned Nitro Docker image only on the node host; Robyn application services remain native on `192.168.50.250`. Keep RPC and metrics LAN-only and allowlisted exclusively to the Robyn VM. Prioritize testnet and leave mainnet disabled until storage and memory expand.
- Configuration: Ubuntu 24.04, 16 vCPUs, about 30 GiB usable RAM, 8 GiB swap, and a 500 GB virtual NVMe disk. LVM/root was expanded from 100 GiB to a 498 GiB LV and 490 GiB filesystem. Nitro image digest is `sha256:ebc985e3b105980734630744981e1542001c22d74cba57509fe0d5ed8bb84c14`.
- Current state: The checksum-gated systemd snapshot job is downloading the official 2026-07-15 testnet pruned snapshot (`180589076480` bytes, SHA-256 `9234e53eedd3c7a1e12b122f7ba747576d6c2685c9d0b9fdd625c20ab3c73077`). Nitro waits for successful verification and extraction. Private RPC is `192.168.50.117:8547`; no Cloudflare or public route exists.
- Capacity: This host can start one pruned node. It cannot safely run testnet plus mainnet simultaneously, and the roughly 2.87 TiB testnet archive cannot fit. Add at least 2 TB NVMe and preferably 64 GB RAM before enabling mainnet.
- Follow-up: Do not cut backend consumers over until `eth_syncing=false`, independent head and historical-log probes pass, Prometheus is clean, and reboot recovery is verified. See `docs/robinhood-rpc-node.md`.

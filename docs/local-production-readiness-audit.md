# Local production-readiness audit

Status: Exact candidate 8def270 is promoted, browser-proven and in its fresh uninterrupted soak; post-soak closure gates remain incomplete
Candidate commit: 8def270b1856c2bcfcd69d429a8d88def4ab15a8
Release path: /opt/robyn/releases/8def270b1856c2bcfcd69d429a8d88def4ab15a8
Audit date: 2026-07-21

## Completion rule

This audit is intentionally stricter than a feature checklist. A requirement is proven only when an authoritative exact-candidate artifact, runtime result, browser artifact or reproducible lower-level gate covers its full scope. Active and post-soak items prevent goal completion.
## Candidate evidence boundary

The product/runtime diff from invalidated candidate d90e218 to 8def270 is empty across `apps/`, `packages/`, `deployments/` and `infrastructure/pm2/`. The six changed files are confined to release construction/verification and their documentation/memory. The complete d90 browser matrix is retained under `artifacts/browser-uat/2026-07-21-d90e218` as product-source-equivalent coverage, but its aborted soak is never reused.

The replacement candidate independently repeated the signed buy, weighted pending-fee, three-leg conversion, claim-all, sell and portfolio-reload journey through the in-app browser. Its exact-SHA DOM, structured record and eight successful receipts at blocks 166-173 live under `artifacts/browser-uat/2026-07-21-8def270`.

A second fresh browser-only wallet then obtained development gas and mock cash and permissionlessly launched the `SOAK` 40/40/20 basket as registry entry 6. Seven fund/launch receipts at blocks 174-180 succeeded; anonymous discovery and canonical detail independently reconciled the immutable basket and exact contracts at indexed/live block 180 with zero browser warning/error logs.

The fresh 8def soak must start from zero after exact-candidate launch and backup checkpoints. Prior elapsed time never counts toward it.


Status meanings:

- PROVEN: direct evidence covers the requirement on the exact candidate or an immutable state/configuration shared by that candidate.
- PROVEN-DESIGN: exact-candidate lower-level evidence covers behavior that is wallet-owned or has no Robyn UI control.
- ACTIVE: the required observation is running and cannot be shortened.
- PENDING: a mandatory gate has not started and prevents completion.
- POST-SOAK: the action must occur after the uninterrupted run so it does not invalidate that run.
- EXTERNAL-LATER: not required to prove the controlled-LAN release or readiness to broadcast, but mandatory before the named public or real-value operating mode.

## Requirement evidence

| Requirement | Status | Authoritative evidence |
|---|---|---|
| VM-only execution and no Docker | PROVEN | AGENTS.md, docs/vm-runtime-and-operations.md, native systemd topology and active VM services |
| Exact pushed source and immutable runtime | PROVEN | release-manifest.json identifies 8def270; /opt/robyn/current resolves to it; promotion record 20260721T112124Z identifies six apps; two exact-tree validations prove 45,503 regular files with zero writable paths, shared dependency hardlinks or external symlinks |
| Reproducible build and dependency state | PROVEN | release-files.sha256, source archive hash, lock/dependency/migration hashes, packageImportMethod=copy, read-only tree and a post-promotion shared-store mutation-isolation regression |
| Formatting, lint, PM2 policy, typecheck, tests and production build | PROVEN | release manifest gate list and release-evidence/release-gates.log |
| PRD and user-story traceability | PROVEN | release-gated scripts/validate-user-stories.py covers 182 of 182 requirements with 154 stories |
| Native accounting conservation | PROVEN | Foundry unit, fuzz and four stateful invariant campaigns; verify-devnet-deployment.sh; soak initial and final protocol verifiers |
| Reentrancy and adversarial token/router behavior | PROVEN | malicious callback tests and docs/protocol-security-review.md |
| No unresolved critical or high security finding | PROVEN | exact release static-security-audit.json: zero history secrets, zero high/critical dependency advisories and zero unresolved high contract findings |
| Any reachable LAN user can obtain dev gas and mock cash | PROVEN | exact 8def fresh browser wallet received 10 DEV and 10,000 mUSD; fund receipt at block 174 succeeded before permissionless launch |
| Invalid basket total and invalid metadata rejected before a transaction | PROVEN | invalid-weights.dom.txt and invalid-metadata.dom.txt; launch count remained five after the deliberate whitespace replay |
| Permissionless one-asset launch | PROVEN | one-asset-launch DOM/screenshot, launch 5 ONE at block 156 and six successful launch receipts |
| Permissionless three-asset launch | PROVEN | exact 8def fresh browser wallet created SOAK registry entry 6 with immutable 40/40/20 weights; six launch receipts at blocks 175-180 succeeded and discovery/detail reconciled its token, market, vault and creator at indexed/live block 180 |
| Duplicate asset rejection | PROVEN-DESIGN | the fixed three-slot UI cannot select duplicate assets; exact-candidate factory tests reject duplicate addresses |
| Buy and sell from two distinct wallets | PROVEN | source-equivalent broad journeys used 0x23954C7F... and 0x71690958...; exact 8def repeated buy/sell with the restored second wallet and reconciled 1,780,000 ROBYN at block 173 |
| Fee generation and weighted pending state | PROVEN | source-equivalent pending-fees DOM/screenshot plus exact 8def browser observation of 4.4/4.4/2.2 mUSD before conversion |
| Bounded keeper conversion and manual race recovery | PROVEN | exact 8def browser-observed keeper/manual race recovery plus successful conversion receipts at blocks 168-170 |
| Partial failure, stale quote and minimum-output protection | PROVEN-DESIGN | exact-candidate contract tests and bounded keeper retry/dead-letter tests; protected testnet conversion router gates |
| Multi-asset claim and repeated-claim safety | PROVEN | exact 8def claim-all receipt at block 171 and reconciled mNVDA/mSPY/mETH history plus exact-candidate accumulator tests |
| Token-transfer reward history | PROVEN-DESIGN | exact-candidate transfer-aware accumulator tests; transfers occur through normal ERC-20 wallet controls rather than a Robyn transfer UI |
| Anonymous discovery and canonical token detail | PROVEN | desktop and mobile discovery evidence plus canonical-detail-desktop.jpg, canonical-detail.dom.txt and canonical-detail-browser-evidence.json; the exact genesis detail reconciles indexed/live block 165, realized basket state, contract provenance, native-v1 accounting and 20 of 50 recent events with zero browser warning/error logs |
| Signed portfolio and history after reload | PROVEN | exact 8def replacement-portfolio.dom.txt reconciles 1,780,000 ROBYN and three claimed assets at indexed block 173; source-equivalent desktop/mobile evidence covers responsive states |
| Accurate non-backed and mock-asset disclosures | PROVEN | browser snapshots show controlled-development and nonredeemable reward-basket disclosures |
| Desktop, tablet and mobile responsiveness | PROVEN | desktop transactional screenshots plus responsive-browser-evidence.json at 768 by 1024 and 390 by 844; zero overflow and zero warning/error logs |
| Keyboard, reduced-motion and non-color-only states | PROVEN-DESIGN | accessibility-browser-evidence.json verifies the semantic skip target, served focus styles, reduced-motion media rule, seven textual status labels and zero warning/error logs; the recorded in-app-browser key-injection limitation is not concealed |
| PostgreSQL, Redis and MinIO durability | PROVEN | native services, migrations, deterministic index rebuild, Redis fail-closed quota test and MinIO hash/restart test; exact 8def block-180 backup `robyn-state-20260721T113919Z` restored nine PostgreSQL tables, one content-addressed artifact and isolated Anvil state/factory with `liveStateTouched=false`; the encrypted off-VM asset size and SHA-256 matched |
| Reorg-aware indexing and freshness-labeled API | PROVEN | deterministic destructive rebuild, checkpoint validation, bounded discovery API and live indexed state |
| Service persistence and recovery | PROVEN | PM2/systemd resurrection, controlled service failure tests and prior VM cold-start evidence |
| Exact-candidate uninterrupted 24-hour stability | ACTIVE | fresh 8def run started 2026-07-21T11:42:42.706Z after exact browser launch and restorable off-VM backup; first three samples identify the exact release, block 180, six zero-restart processes, zero firing alerts and healthy resources/latencies; completion still requires the full 86,400 seconds |
| Exact-candidate post-soak VM reboot and recovery | POST-SOAK | reboot only after the soak completes; then require zero failed units, exact release paths, zero unexpected PM2 restarts and reconciled chain/data state |
| Post-reboot browser regression | POST-SOAK | repeat fund or restored-wallet, buy, conversion/claim, sell, discovery and portfolio checks through the in-app browser |
| Post-reboot encrypted off-VM backup | POST-SOAK | create, verify and upload a backup whose manifest gitSha is 8def270 after final browser state |
| Candidate tag and final pushed evidence | POST-SOAK | append soak/reboot/browser/backup evidence, verify checksums, push evidence branch and push the candidate tag |
| Protected Robinhood Testnet build | PROVEN | build excludes dev wallet/faucet/fixture markers and requires injected wallet on chain 46630 |
| Full chain-46630 transaction rehearsal | PROVEN | exact release testnet-journey.json passed faucet, buy, three conversions, claim and sell with conserved accounting |
| Isolated testnet-shaped five-service rehearsal | PROVEN | exact release testnet-stack.json passed web/API/indexer/keeper/artifacts, scoped key file, teardown and preserved devnet health |
| Testnet deployment, verification, monitoring and rollback procedures | PROVEN | scripts/deploy-testnet.sh, verify-testnet-deployment.sh, build-testnet-candidate.sh, rehearse-testnet-stack.sh and docs/testnet-operations.md |
| Testnet mock/canonical asset strategy | PROVEN | project mocks are explicit TESTNET_MOCK_ONLY; canonical addresses must be rechecked and substituted only when officially published |

## Active soak acceptance

The final summary is acceptable only if all of the following are true:

1. completed duration is at least 86,400 seconds without service stop, release change, promotion or reboot;
2. every sample reports the exact git SHA and immutable release path;
3. all six PM2 processes retain restart count zero and remain rooted in the release;
4. chain and indexed block progression never moves backward;
5. initial and final onchain conservation verification pass;
6. no health, endpoint, alert or sample error exists;
7. endpoint p95 remains at or below 500 milliseconds;
8. available memory and disk never cross their configured floors; and
9. total/process RSS remains within the bounded allowance without monotonic unbounded growth.

The final raw-stream decision must also pass the independent evidence auditor rather than relying only on the soak producer's summary:

```bash
node scripts/audit-soak-evidence.mjs \
  --samples /var/lib/robyn/soak/8def270b1856c2bcfcd69d429a8d88def4ab15a8/soak-20260721T114242706Z.jsonl \
  --summary /var/lib/robyn/soak/8def270b1856c2bcfcd69d429a8d88def4ab15a8/soak-20260721T114242706Z-summary.json \
  --expected-sha 8def270b1856c2bcfcd69d429a8d88def4ab15a8 \
  --expected-release /opt/robyn/releases/8def270b1856c2bcfcd69d429a8d88def4ab15a8
```

The auditor independently rejects malformed/error samples, SHA/path/process drift, nonzero restarts or alerts, backward chain/index/launch/log state, resource-floor violations, excessive cadence gaps, excessive derived RSS growth, latency p95 breaches and inconsistencies between raw samples and the final summary. Its active-observation and synthetic final-summary paths pass; deliberate error injection is rejected.

## Closure sequence

1. Audit every soak JSONL sample and the generated final summary.
2. Preserve the raw log, summary and independent aggregate under the commit-addressed evidence directory.
3. Reboot the VM and prove exact-release service, chain, database, queue, object, edge and monitoring recovery.
4. Repeat the final signed in-app-browser regression and targeted console review.
5. Create and verify a new encrypted off-VM backup after the final browser state.
6. Update this audit and MEMORY.md with direct evidence, not conclusions alone.
7. Recompute evidence checksums, commit and push the evidence branch.
8. Tag and push the proven 8def270 runtime commit.
9. Verify remote branch and tag SHAs, then perform one final requirement-by-requirement audit before closing the goal.

The final browser package must be independently bound to the live chain before it
is accepted:

```bash
node scripts/audit-browser-evidence.mjs \
  --evidence artifacts/browser-uat/2026-07-21-8def270/post-reboot-browser-evidence.json \
  --logs artifacts/browser-uat/2026-07-21-8def270/post-reboot-browser-logs.json \
  --receipts artifacts/browser-uat/2026-07-21-8def270/post-reboot-browser-receipts.json \
  --expected-sha 8def270b1856c2bcfcd69d429a8d88def4ab15a8 \
  --minimum-receipts 8 \
  --minimum-snapshots 3 \
  --snapshot post-reboot-trade.dom.txt \
  --snapshot post-reboot-detail.dom.txt \
  --snapshot post-reboot-portfolio.dom.txt \
  > artifacts/browser-uat/2026-07-21-8def270/post-reboot-browser-independent-audit.json
```

This auditor requires the exact release SHA, explicit `Codex in-app browser`
provenance, chain 31337, an empty warning/error log, unique successful receipts
sent by the browser wallet, receipts no newer than the claimed indexed block,
three listed and nontrivial DOM snapshots, and byte-field agreement with the
corresponding live RPC receipts. It matched all seven receipts and three DOM
snapshots from the historical permissionless-launch package; final closure raises
the receipt floor to eight.

Backup evidence must be generated from the actual encrypted artifact, checksum,
private GitHub release assets and saved isolated-restore output:

```bash
node scripts/collect-backup-evidence.mjs \
  --release-sha 8def270b1856c2bcfcd69d429a8d88def4ab15a8 \
  --backup /var/backups/robyn/robyn-state-<timestamp>.tar.zst.age \
  --checksum /var/backups/robyn/robyn-state-<timestamp>.tar.zst.age.sha256 \
  --restore-output /var/tmp/robyn-final-restore-output.txt \
  --output artifacts/browser-uat/2026-07-21-8def270/post-reboot-backup-evidence.json
```

The collector downloads the exact matching private release assets, compares their
size and digest to the local encrypted artifact, authenticates the remote checksum
file and validates the isolated restore's release SHA, table/artifact counts, chain
ID and `liveStateTouched=false`. It reproduced the existing pre-soak evidence
byte-for-byte; an intentionally wrong release SHA was rejected.

The pre-reboot boot ID is preserved as `61d23088-ad4b-4430-a0ad-5eab296d9550`. After reboot, the machine gate must pass without rehearsal overrides:

```bash
sudo scripts/audit-recovery-state.sh \
  --expected-sha 8def270b1856c2bcfcd69d429a8d88def4ab15a8 \
  --previous-boot-id 61d23088-ad4b-4430-a0ad-5eab296d9550
```

The auditor verifies a changed boot ID, inactive completed soak, zero failed units, all required enabled/active native services and timers, disabled/inactive container services, exact immutable release verification, six online zero-restart exact-path PM2 apps, deployed protocol conservation, preserved chain/index/launch/log state, healthy web/API/RPC/artifact/Prometheus endpoints, two healthy scrape targets, zero alerts, exact LAN listeners, loopback-only internal listeners and the exact four subnet-scoped UFW rules. Its current-state rehearsal passes only with explicit same-boot/active-soak overrides; final mode correctly rejects the current boot, active soak and non-root execution.

The goal may be closed only after the fail-closed verifier passes with no `--allow-incomplete` override:

```bash
node scripts/verify-final-readiness.mjs \
  --repo /home/hendo420/Robyn-evidence-8def \
  --config artifacts/browser-uat/2026-07-21-8def270/closure-requirements.json \
  --audit docs/local-production-readiness-audit.md \
  --evidence-dir artifacts/browser-uat/2026-07-21-8def270
```

`closure-requirements.json` fixes the exact release SHA/path, Node/pnpm versions, copied-dependency mode, four migration hashes, eleven release gates, evidence branch, annotated tag, allowed final audit statuses and required soak, reboot, browser and backup evidence contracts. The verifier recomputes the lock, release-tree manifest and release-manifest sidecar hashes directly from the immutable artifact and requires the format, lint, PM2 policy, immutability, typecheck, test, build, traceability, security, testnet journey and isolated testnet-stack gates. It also requires at least 5,759 clean soak samples and 86,400 elapsed seconds, the full zero-restart/monotonic independent audit, ten recovered services/two timers/six PM2 apps, every post-reboot fund/buy/weighted-fee/convert/race/claim/sell/discovery/detail/portfolio browser step, at least eight successful live-matched receipts, three listed/nontrivial DOM snapshots, empty logs, and an encrypted off-VM backup restored across nine tables, one artifact and chain 31337 without touching live state. During the active soak it correctly reports all remaining blockers and exits nonzero. An isolated 37-row package passed the original 114 checks; the independent browser bundle expands the real final package to 129 checks. Final closure requires all 129 to pass, including exact remote main and annotated `v0.1.0-rc.1` tag pointing to 8def270.

## External gates after this milestone

- Actual Robinhood Testnet broadcast requires explicit user authorization, current chain/address revalidation and funded testnet ETH.
- Human alert delivery and an independent protocol/security review are required before unattended public-testnet or real-value operation.
- Real Stock Token operation additionally requires current issuer/registry/quote/oracle validation and legal review.
- TLS is required before the application is exposed outside the trusted LAN.

These gates do not weaken the controlled-LAN completion rules above and must not be represented as already satisfied.

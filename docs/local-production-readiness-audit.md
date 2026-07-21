# Local production-readiness audit

Status: Exact candidate d90e218 is proven except for the active uninterrupted soak and post-soak closure gates
Candidate commit: d90e2187afcf278cdc5d49acaf20f3c23d8ac72a
Release path: /opt/robyn/releases/d90e2187afcf278cdc5d49acaf20f3c23d8ac72a
Audit date: 2026-07-21

## Completion rule

This audit is intentionally stricter than a feature checklist. A requirement is proven only when an authoritative exact-candidate artifact, runtime result, browser artifact or reproducible lower-level gate covers its full scope. Active and post-soak items prevent goal completion.

Status meanings:

- PROVEN: direct evidence covers the requirement on the exact candidate or an immutable state/configuration shared by that candidate.
- PROVEN-DESIGN: exact-candidate lower-level evidence covers behavior that is wallet-owned or has no Robyn UI control.
- ACTIVE: the required observation is running and cannot be shortened.
- POST-SOAK: the action must occur after the uninterrupted run so it does not invalidate that run.
- EXTERNAL-LATER: not required to prove the controlled-LAN release or readiness to broadcast, but mandatory before the named public or real-value operating mode.

## Requirement evidence

| Requirement | Status | Authoritative evidence |
|---|---|---|
| VM-only execution and no Docker | PROVEN | AGENTS.md, docs/vm-runtime-and-operations.md, native systemd topology and active VM services |
| Exact pushed source and immutable runtime | PROVEN | release-manifest.json identifies d90e218; /opt/robyn/current resolves to the immutable release; promotion record 20260721T102159Z identifies six apps |
| Reproducible build and dependency state | PROVEN | release-files.sha256, source archive hash, lock/dependency/migration hashes and read-only release tree |
| Formatting, lint, PM2 policy, typecheck, tests and production build | PROVEN | release manifest gate list and release-evidence/release-gates.log |
| PRD and user-story traceability | PROVEN | release-gated scripts/validate-user-stories.py covers 182 of 182 requirements with 154 stories |
| Native accounting conservation | PROVEN | Foundry unit, fuzz and four stateful invariant campaigns; verify-devnet-deployment.sh; soak initial and final protocol verifiers |
| Reentrancy and adversarial token/router behavior | PROVEN | malicious callback tests and docs/protocol-security-review.md |
| No unresolved critical or high security finding | PROVEN | exact release static-security-audit.json: zero history secrets, zero high/critical dependency advisories and zero unresolved high contract findings |
| Any reachable LAN user can obtain dev gas and mock cash | PROVEN | exact-release signed in-app-browser faucet journey and successful receipt evidence |
| Invalid basket total and invalid metadata rejected before a transaction | PROVEN | invalid-weights.dom.txt and invalid-metadata.dom.txt; launch count remained five after the deliberate whitespace replay |
| Permissionless one-asset launch | PROVEN | one-asset-launch DOM/screenshot, launch 5 ONE at block 156 and six successful launch receipts |
| Permissionless three-asset launch | PROVEN | EVID browser state, transaction/receipt evidence and immutable 40/40/20 indexed basket |
| Duplicate asset rejection | PROVEN-DESIGN | the fixed three-slot UI cannot select duplicate assets; exact-candidate factory tests reject duplicate addresses |
| Buy and sell from two distinct wallets | PROVEN | exact-release browser journeys used 0x23954C7F... and 0x71690958...; the second wallet has six successful user receipts, three keeper receipts and a reconciled 890,000 ROBYN portfolio |
| Fee generation and weighted pending state | PROVEN | pending-fees DOM/screenshot and exact 40/40/20 vault accounting |
| Bounded keeper conversion and manual race recovery | PROVEN | three successful keeper conversion receipts plus browser-observed keeper/manual race recovery |
| Partial failure, stale quote and minimum-output protection | PROVEN-DESIGN | exact-candidate contract tests and bounded keeper retry/dead-letter tests; protected testnet conversion router gates |
| Multi-asset claim and repeated-claim safety | PROVEN | browser claim of mNVDA, mSPY and mETH plus exact-candidate accumulator tests |
| Token-transfer reward history | PROVEN-DESIGN | exact-candidate transfer-aware accumulator tests; transfers occur through normal ERC-20 wallet controls rather than a Robyn transfer UI |
| Anonymous discovery and canonical token detail | PROVEN | desktop and mobile discovery DOM/screenshots, indexed/live block labels and canonical launch links |
| Signed portfolio and history after reload | PROVEN | desktop and mobile portfolio DOM/screenshots with restored session-wallet state |
| Accurate non-backed and mock-asset disclosures | PROVEN | browser snapshots show controlled-development and nonredeemable reward-basket disclosures |
| Desktop, tablet and mobile responsiveness | PROVEN | desktop transactional screenshots plus responsive-browser-evidence.json at 768 by 1024 and 390 by 844; zero overflow and zero warning/error logs |
| Keyboard, reduced-motion and non-color-only states | PROVEN-DESIGN | accessibility-browser-evidence.json verifies the semantic skip target, served focus styles, reduced-motion media rule, seven textual status labels and zero warning/error logs; the recorded in-app-browser key-injection limitation is not concealed |
| PostgreSQL, Redis and MinIO durability | PROVEN | native services, migrations, deterministic index rebuild, Redis fail-closed quota test and MinIO hash/restart test |
| Reorg-aware indexing and freshness-labeled API | PROVEN | deterministic destructive rebuild, checkpoint validation, bounded discovery API and live indexed state |
| Service persistence and recovery | PROVEN | PM2/systemd resurrection, controlled service failure tests and prior VM cold-start evidence |
| Exact-candidate uninterrupted 24-hour stability | ACTIVE | robyn-soak.service started 2026-07-21T10:23:36Z; final summary must pass every sample and the full duration |
| Exact-candidate post-soak VM reboot and recovery | POST-SOAK | reboot only after the soak completes; then require zero failed units, exact release paths, zero unexpected PM2 restarts and reconciled chain/data state |
| Post-reboot browser regression | POST-SOAK | repeat fund or restored-wallet, buy, conversion/claim, sell, discovery and portfolio checks through the in-app browser |
| Post-reboot encrypted off-VM backup | POST-SOAK | create, verify and upload a backup whose manifest gitSha is d90e218 after final browser state |
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

## Closure sequence

1. Audit every soak JSONL sample and the generated final summary.
2. Preserve the raw log, summary and independent aggregate under the commit-addressed evidence directory.
3. Reboot the VM and prove exact-release service, chain, database, queue, object, edge and monitoring recovery.
4. Repeat the final signed in-app-browser regression and targeted console review.
5. Create and verify a new encrypted off-VM backup after the final browser state.
6. Update this audit and MEMORY.md with direct evidence, not conclusions alone.
7. Recompute evidence checksums, commit and push the evidence branch.
8. Tag and push the proven d90e218 runtime commit.
9. Verify remote branch and tag SHAs, then perform one final requirement-by-requirement audit before closing the goal.

## External gates after this milestone

- Actual Robinhood Testnet broadcast requires explicit user authorization, current chain/address revalidation and funded testnet ETH.
- Human alert delivery and an independent protocol/security review are required before unattended public-testnet or real-value operation.
- Real Stock Token operation additionally requires current issuer/registry/quote/oracle validation and legal review.
- TLS is required before the application is exposed outside the trusted LAN.

These gates do not weaken the controlled-LAN completion rules above and must not be represented as already satisfied.

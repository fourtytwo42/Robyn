# Project Memory

Durable project context lives here. Update this file whenever information should survive chat context compression or future agent handoff.

## Active Handoff

- Active Codex goal: deliver a production-ready, fully usable Robyn release on the controlled VM-hosted Anvil network and a rehearsed, testnet-safe Robinhood Chain deployment package ready for real-world testing.
- Goal completion standard: every intended launch, trade, fee-conversion, accounting, reward, claim, failure-recovery, persistence, security and operational path works and is verified; all user-facing acceptance passes through the in-app browser; no unresolved critical/high defect remains; exact release evidence is pushed; and the final exact candidate completes an uninterrupted 24-hour soak.
- Current task: promote and certify the completed launchpad visual-system and canonical token-market redesign from `feat/launchpad-visual-system`; the previous exact-candidate soak was intentionally retired because the user requested material UI changes.
- Last meaningful change: pushed token-market implementation `43deacaeb93d35bd29d54a657743a4b1f7d5bab7` and LCP follow-up `996d859d7b418e00ebd7459d1f4e25781cd10193`; every canonical launch now has a launchpad-style detail page with live market metrics, price/volume chart, buy/sell panel, immutable reward basket, holder economics, top holders, recent trades and expandable provenance. Analytics combine canonical indexed events with current onchain supply, reserves and holder balances so pre-indexer genesis state remains correct.
- Last verification: 2026-07-21 full lint/typecheck/test/devnet-build/protected-testnet-build passed, including API analytics tests, Anvil smoke, 28 Foundry tests, four 128-run invariants, 182/182 PRD traceability and zero known production dependency vulnerabilities. In-app-browser desktop and 390x844 checks passed with no overflow or runtime errors; browser-driven PIXEL buy and sell receipts reconciled to 110 mUSD volume, 1.1 mUSD fees, two trades and two holder wallets. The final browser reload exposed only a Next.js LCP priority hint for the first detailed basket image; `996d859` corrected it and passed web lint/typecheck/test/build. Windows access uses the SSH tunnel at `http://127.0.0.1:3003`; stable release `8def270b1856c2bcfcd69d429a8d88def4ab15a8` remains unchanged at `http://192.168.50.250:3000`.
- Next step: build/promote a new immutable exact release, repeat backup/recovery gates and start a fresh uninterrupted 24-hour soak.
- External gates: public testnet ETH and explicit broadcast authorization are needed for an actual Robinhood Testnet transaction; human alert delivery and independent contract review are required before real-value operation.

## Current State
- Last verified 2026-07-21: implementation commit `43deacaeb93d35bd29d54a657743a4b1f7d5bab7` plus LCP follow-up `996d859d7b418e00ebd7459d1f4e25781cd10193` add `GET /launches/:token/analytics` and a complete per-token market surface. The endpoint is bounded to 10,000 logs and fails closed beyond that point until a durable projection exists; it never invents missing metrics. Devnet trading uses the existing session wallet and testnet builds compile only injected-wallet controls.
- Last verified 2026-07-21: the isolated branch preview uses `robyn-web-preview` on VM loopback 3003 plus temporary `robyn-api-preview` on loopback 3103. Both are PM2-saved for preview continuity; the six-process stable release topology and LAN port 3000 were not mutated.
- Last verified 2026-07-21: visual redesign work is isolated on `feat/launchpad-visual-system`; exact release `8def270b1856c2bcfcd69d429a8d88def4ab15a8` remains the stable deployed runtime while the preview runs separately under PM2 as `robyn-web-preview` on loopback port 3003.
- Last verified 2026-07-21: the indexed devnet contains eight real launch records across symbols ROBYN, MYCO, EVID, ONE, SOAK and PIXEL. Home showcase cards bind to real canonical token pages and display immutable basket composition; no fictional change or volume metrics are presented. PIXEL proves the generic fallback art path for unknown permissionless symbols.
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

- Implement durable creator-uploaded token metadata only as a separately threat-modeled artifact/API feature with image decoding, content-type validation, size/dimension limits, moderation/reporting, content addressing and canonical token linkage. The current release truthfully uses curated demo mappings plus a generated fallback.
- Run a real uninterrupted 24-hour soak against the final exact immutable release candidate; short harness tests and forced-build contention do not satisfy this gate.
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

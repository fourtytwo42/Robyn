# Robyn

Robyn is a proposed Robinhood Chain launchpad where creators launch community tokens with an immutable, weighted asset basket. A token's creator-fee stream purchases the selected assets, and holders accrue claimable basket rewards.

> **Project status:** Implementation is active. The VM runs a persistent controlled Anvil devnet, restricted user RPC/faucet, browser-operated permissionless launchpad, native PostgreSQL/Redis/MinIO, a reorg-aware indexer, freshness-labeled filtered discovery API, bounded conversion keeper and content-addressed artifact service. Anonymous discovery, canonical launch detail and session-wallet portfolio pages are live alongside the launch-to-claim console. Backups, monitoring, security/load evidence, protocol hardening and testnet rehearsal remain in progress.

## Authoritative development environment

All project work runs on the dedicated Ubuntu VM:

- Host: `robyn` at `192.168.50.250`
- Repository: `/home/hendo420/Robyn`
- Process model: native VM services only; no Docker or containers
- Node applications: PM2 with `systemd` startup and saved process state
- Stateful services: native PostgreSQL, Redis and MinIO managed by `systemd`
- CI: a self-hosted GitHub Actions runner on the VM when CI is enabled
- RPC: browser users retain public/wallet RPC paths; any project-operated RPC node runs on the VM

The Windows checkout is not an execution environment. It is only a convenience mirror and SSH/control surface. See [VM runtime and operations](docs/vm-runtime-and-operations.md) for the binding service, persistence, deployment, backup and RPC rules.

## Repository map

| Path | Purpose |
|---|---|
| [`research/`](research/) | Chain, market, competitor, terms, contract-reuse, liquidity, security, and operational evidence |
| [`prd/`](prd/) | Authoritative product requirements and architecture decisions |
| [`apps/web/`](apps/web/) | Next.js launch console, anonymous discovery, launch detail, portfolio and health surfaces |
| [`apps/api/`](apps/api/) | Freshness-labeled read API and operator visibility |
| [`apps/indexer/`](apps/indexer/) | Reorg-aware canonical chain indexer |
| [`apps/keeper/`](apps/keeper/) | Bounded BullMQ conversion worker and dead-letter recovery |
| [`apps/artifacts/`](apps/artifacts/) | Loopback content-addressed artifact gateway backed by MinIO |
| [`packages/db/`](packages/db/) | Shared PostgreSQL schema and ordered migrations |
| [`packages/contracts/`](packages/contracts/) | Foundry contracts and invariant-focused tests |
| [`user-stories/`](user-stories/) | Delivery backlog and PRD traceability |
| [`scripts/`](scripts/) | Reproducible research, validation, market-snapshot, and screenshot tooling |
| [Controlled devnet operations](docs/devnet-operations.md) | Live Anvil, restricted RPC/faucet and PM2 service operation |
| [Native data-plane operations](docs/data-plane-operations.md) | PostgreSQL/Redis service, schema, migration and recovery status |
| [Native object storage](docs/object-storage-operations.md) | MinIO installation, least-privilege access and artifact verification |
| [Encrypted backup and restore](docs/backup-and-restore.md) | Scheduled off-VM state backups, recovery identity custody and clean-target rehearsal |
| [`docs/`](docs/) | VM runtime, operating procedures and delivery roadmaps |
| [Protocol core](docs/protocol-core.md) | Current contract boundaries, invariants, dependency provenance and limitations |
| [Devnet-to-testnet readiness plan](docs/devnet-to-testnet-readiness-plan.md) | Phase-by-phase implementation, verification and release plan |

The initial implementation will use the monorepo and contract stack defined in [`prd/10-technology-stack-and-repository-architecture.md`](prd/10-technology-stack-and-repository-architecture.md). Product language must describe the launch token as a fee-funded reward token, not an asset-backed or redeemable security.

## Validate the documentation

Run only on the authoritative VM:

~~~bash
cd /home/hendo420/Robyn
pnpm install --frozen-lockfile
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
~~~

`pnpm test` includes the Vitest suite, an isolated Anvil chain-ID/fresh-state smoke test, and Foundry unit/fuzz tests. It does not touch the persistent shared devnet.

~~~bash
ssh hendo420@192.168.50.250
cd /home/hendo420/Robyn
python3 scripts/validate-user-stories.py
~~~

Research date: 2026-07-20

This repository documents the feasibility of a launchpad where a creator launches a token, fixes a basket allocation at launch, and routes trading fees into assets such as Robinhood Stock Tokens, ETFs, crypto assets, and selected community tokens for the benefit of the launch-token holders.

## Bottom line

The product is technically buildable on Robinhood Chain.

Robinhood Chain mainnet is live, permissionless, and EVM-compatible. It supports normal Solidity contracts, Uniswap liquidity, RFQ and intent-based stock-token trading, Chainlink price feeds, account abstraction, and canonical Robinhood Stock Tokens. The live Robinhood registry contained 96 active stock and ETF tokens when checked on 2026-07-20.

The exact example from the chat is only partly supported:

- NVIDIA is available as canonical `NVDA`.
- S&P 500 exposure is available as canonical `SPY`.
- Block, Inc., the company behind Cash App, is not currently present as `XYZ` or its former ticker `SQ` in the live registry.

The proposal is also not an empty competitive space:

- [Vladdy](https://www.vladdy.fun/how-it-works) offers a live single-Stock-Token reward mode. Its four launches prove the wiring, but all four reward distributors still reported zero stock purchased and distributed in the fresh contract audit.
- [hood.fun](https://hood.fun/whitepaper) already has a community mode that redirects creator-fee rewards pro rata to holders.
- [Vimen](https://www.vimen.org/press), a project launched through Virtuals, already creates redeemable tokens backed by immutable baskets of Robinhood Stock Tokens.
- [Alloy](https://github.com/AlloyRH/AlloyFund) publishes an MIT-licensed single-Stock-Token implementation, but its old live factory currently reports a 0/100/0 holder/creator/protocol split and its source suite is not reproducibly green.
- [IndexPad](https://docs.indexpad.io/) has deployed a fee-funded redeemable basket launchpad, although its current model, documentation and unaudited contracts are not a safe drop-in dependency.
- [HoodETF](https://docs.hoodetf.org/), [Alloy Index](https://www.alloy.fund/about), and [BASKET Protocol](https://rindex.app/docs) now provide additional permissionless Stock Token basket factories on mainnet.
- [Bags](https://docs.bags.fm/robinhood/overview) already supports a creator fee share split among multiple fee claimers.
- [pons](https://docs.ponfamily.com/) lets the creator set a fee wallet, which may provide a fast integration path if smart-contract payout wallets are supported as expected.

No verified product found in this review combines the complete flow: permissionless community-token launch, creator-selected mixed asset basket, trading-fee conversion into that basket, and holder claims of the purchased assets.

## Product decision that must be explicit

There are two economically different products:

1. **Fee-reward token:** fees buy assets that holders can claim. The launch token is not itself redeemable for the treasury and should not be described as backed.
2. **Redeemable basket token:** each token is a direct claim on assets held in a vault. This is actually backed, but overlaps Vimen and creates a substantially heavier regulatory and operational burden.

The recommended initial product is the first model. Use language such as “basket rewards funded by trading fees,” not “backed,” unless an audited redemption mechanism actually exists.

## Recommended route

1. Prototype the accounting and purchase flow on Robinhood Chain testnet with mock assets.
2. Ship a crypto-only mainnet pilot with a curated asset allowlist.
3. Add Robinhood Stock Tokens after dependable 0x or UniswapX execution, oracle protection, accounting tests, and audit readiness. Under the current product decision, contracts remain permissionless and do not actively verify or restrict user eligibility; legal review continues in parallel.
4. Independently implement a bounded multi-asset version of the transfer-aware accounting demonstrated by Alloy and Vladdy, using pinned OpenZeppelin primitives. Keep a Bags adapter as the fastest launch-and-liquidity option if its funded contract-recipient spike passes and off-chain Merkle reward epochs are acceptable.

## Research files

- [Chain capabilities and assets](research/01-chain-and-assets.md)
- [Launchpads and competitive landscape](research/02-launchpads-and-competition.md)
- [Product feasibility and technical architecture](research/03-product-feasibility-and-architecture.md)
- [Regulatory, security, and operating risks](research/04-regulatory-security-and-risks.md)
- [Robinhood Stock Token registry snapshot](research/05-asset-registry-snapshot.md)
- [Launchpad product blueprint and build requirements](research/06-launchpad-product-blueprint.md)
- [Cross-chain launchpad product and UX study](research/07-cross-chain-launchpad-ux-study.md)
- [Launchpad subpage and product-flow UX study](research/08-launchpad-subpage-ux-study.md)
- [Launchpad terms, access, and creator-obligation comparison](research/09-launchpad-terms-comparison.md)
- [Robinhood Chain and Stock Token terms for launchpads and smart contracts](research/10-robinhood-chain-and-stock-token-terms.md)
- [Reusable contracts and infrastructure: build-versus-reuse audit](research/11-reusable-contracts-and-infrastructure.md)
- [IndexPad-like products and current competitive map](research/12-indexpad-like-products.md)
- [Live contract and integration due diligence](research/13-live-contract-and-integration-due-diligence.md)
- [Liquidity, traction, and reward economics](research/14-liquidity-traction-and-economics.md)
- [Security, legal, operations, and validation plan](research/15-security-legal-operations-validation-plan.md)

## Product requirements

The implementation-ready PRD set is indexed in [prd/README.md](prd/README.md). It includes the product decision register, master requirements, creator and holder experiences, protocol/accounting design, platform infrastructure, security and operations, delivery acceptance, analytics, the dark-first [UI/UX visual design system](prd/09-ui-ux-visual-design-system.md), and the settled [technology stack](prd/10-technology-stack-and-repository-architecture.md).

## User-story backlog

The comprehensive delivery backlog is indexed in [user-stories/README.md](user-stories/README.md). It contains 154 stories across ten epic collections, with personas, releases, priorities, dependencies, acceptance criteria, PRD mappings, and a generated [requirement traceability matrix](user-stories/TRACEABILITY.md).

## Verified development endpoints

| Network | Chain ID | Public RPC | Explorer |
|---|---:|---|---|
| Robinhood Chain | `4663` | `https://rpc.mainnet.chain.robinhood.com` | [Mainnet Blockscout](https://robinhoodchain.blockscout.com/) |
| Robinhood Chain Testnet | `46630` | `https://rpc.testnet.chain.robinhood.com` | [Testnet Blockscout](https://explorer.testnet.chain.robinhood.com/) |

The testnet RPC, chain ID, explorer, and browser CORS support were verified live on 2026-07-20. Robinhood has not published a testnet Stock Token address registry or an official public test-ETH faucet in the documentation reviewed, so the first proof should use deployed mock assets and must confirm a test-ETH funding route before deployment. Full configuration and limitations are in [Chain capabilities and assets](research/01-chain-and-assets.md#testnet-development-details).

## Supporting evidence and reproducibility

- Main-page screenshots and capture metadata: [research/screenshots/launchpads](research/screenshots/launchpads/)
- Subpage screenshots and capture metadata: [research/screenshots/launchpad-subpages](research/screenshots/launchpad-subpages/)
- Launchpad legal-link discovery snapshot: [research/launchpad-legal-links.json](research/launchpad-legal-links.json)
- JavaScript-rendered terms and disclaimer extracts: [research/dynamic-launchpad-terms.json](research/dynamic-launchpad-terms.json)
- Live contract provenance and read-only state: [research/live-contract-audit.json](research/live-contract-audit.json)
- Stock Token liquidity/oracle snapshot: [research/market-snapshot.json](research/market-snapshot.json)
- Reproducible raw competitor-event counts: [research/competitor-traction.json](research/competitor-traction.json)
- Reward fee-flow scenario model: [research/reward-economics.json](research/reward-economics.json)
- Reproducible browser capture, route discovery, legal-link inspection, and contact-sheet scripts: [scripts](scripts/)

Saved screenshots and JSON are dated evidence, not live guarantees. Re-run the relevant scripts and recheck official terms, contracts, registries, fee parameters, and liquidity before implementation or launch.

## Confidence and freshness

Robinhood Chain mainnet launched on 2026-07-01, so the ecosystem is changing daily. Facts marked as verified were checked against primary documentation, live product documentation, an official API, or deployed contract source on 2026-07-20. Product claims without public contracts or detailed documentation are labeled accordingly.

This material is technical and market research, not legal, financial, or investment advice.

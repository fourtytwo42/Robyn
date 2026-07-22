# UX, Market Intelligence, and Creator Identity Release Audit

Last verified: 2026-07-22

Status: Release accepted with user-approved soak waiver

This audit maps the approved integrated release to implemented code and current controlled-devnet evidence. `PROVEN` means the requirement passed code-level and/or live browser verification. `WAIVED` means the user explicitly accepted the identified release risk without claiming that the omitted gate passed. External Robinhood Testnet broadcast and real-value review remain later gates.

## Responsive and navigation

| Requirement | Status | Evidence |
| --- | --- | --- |
| Mobile token detail stacks without zero-width text or overflow | PROVEN | Exact-release in-app-browser matrix at 390x844 measured a 309px single-column ART22 identity/title and no horizontal overflow. Final responsive rules are source-ordered last in `apps/web/src/app/globals.css`. |
| Compact Markets hero, visible search and collapsible filters | PROVEN | Mobile Markets first card begins at 608px. Filters collapse to a 40px control and expand to the inline 423px advanced panel. |
| Applied-filter chips and clear-all | PROVEN | Search-only ART22 acceptance renders `Search: ART22`, `Clear all`, `Filters (1)`, and one result. |
| Auto-moving, scrollable, pausable ticker with reduced-motion behavior | PROVEN | `MarketTapeClient` exposes an accessible Pause control, horizontal tape links, duplicated animation rail, and reduced-motion CSS. |
| Compressed homepage hero | PROVEN | At 390x844 the featured ROBYN artwork is visible from 594-804px and the market board begins at 978px. |
| Navigation contrast and keyboard focus | PROVEN | All visible buttons and form controls in the five-route, three-viewport audit have accessible names/labels; dialog and sheet focus wrapping passed in both directions. |

## Discovery and analytics

| Requirement | Status | Evidence |
| --- | --- | --- |
| Trending, New, Near graduation, and Graduated views | PROVEN | Board links submit distinct validated sort/phase combinations and live results reflect canonical phase data. |
| Window volume and market-cap sorting, 24h Trending default | PROVEN | `GET /launches` query validation and ranking have six unit tests; Markets defaults to `sort=trending&window=24h`. |
| Sort-aware opaque cursors and legacy newest-first compatibility | PROVEN | API cursor tests cover binding/rejection while an omitted query retains newest-first response semantics. |
| Truthful 24h/7d fields and missing-history behavior | PROVEN | Seven analytics unit tests cover boundary math and null change; live cards and tape label indexed 24h values. |
| Canonical timestamped trade aggregation and ranking | PROVEN | Indexer projections and API analytics use canonical trade timestamps; controlled demo activity contains real indexed trades rather than fabricated UI movement. |
| Devnet/demo disclosure | PROVEN | Tape, page disclaimers, token headers, and cards identify the controlled development network and mock assets. |

## Token page and trading

| Requirement | Status | Evidence |
| --- | --- | --- |
| Decision area metrics and compact basket | PROVEN | ART22 live detail shows 24h change, volume, buy/sell split, lifecycle, traders, market cap, and 40/40/20 basket before trading. |
| Interactive Price/Volume chart and four ranges | PROVEN | Chart exposes semantic tabs, 1H/24H/7D/All controls, axes, buy/sell/launch/graduation markers, and canonical transaction context. |
| Pointer and keyboard tooltip navigation | PROVEN | In-app browser focused the launch point and ArrowRight moved the live tooltip to the buy trade with amount, timestamp, and hash. |
| Enriched points and graduation timestamp | PROVEN | Analytics types and endpoint include side, transaction hash, base amount, event type, block, and timestamp. |
| Sticky desktop trade and accessible mobile sheet | PROVEN | Desktop panel remains sticky; 390px Buy/Sell opens a modal sheet, locks body scroll, wraps forward/reverse focus, and restores focus to Buy. |
| Dirty mobile close confirmation | PROVEN | Entering 123 mUSD then closing produced the explicit Keep editing / Discard and close alert dialog. |
| Existing quote, fee, slippage, keeper-race, and errors preserved | PROVEN | Shared network-selected trade forms remain the only transaction implementation; full service/Anvil/Foundry gates pass. |
| Copy, share, watchlist, creator proof, and activity | PROVEN | All controls are present; chain/token watchlist state survived public-preview reload without server persistence. |

## Guided creation, artwork, and profiles

| Requirement | Status | Evidence |
| --- | --- | --- |
| `/create` opens a three-step guided modal | PROVEN | Token/artwork, basket, and review/launch steps are focus trapped and use the real devnet/testnet transaction functions. |
| Compact dismissed page | PROVEN | Dismissed creation has no legacy registry or genesis trading console; only the explainer, Start launch, status, and disclaimer remain. |
| Persistent canonical card preview and discard safety | PROVEN | Selected WebP preview uses a blob crop, survives step changes and Keep draft and close, warns before closing, and resets only on Discard draft. |
| Reused devnet/testnet wallet and receipt logic | PROVEN | Guided wizard is injected into both network consoles and calls their existing wallet, funding, signing, launch, index wait, and receipt paths. |
| Secure image validation and sanitization | PROVEN | Media tests cover type/dimension/static-image validation; server decodes and re-encodes 1024-square WebP and stores only sanitized output. |
| Content-addressed storage and status-aware fallback | PROVEN | Live upload renders through `/api/media`; quarantine acceptance switched immediately to controlled fallback and restore returned the bound art. |
| Publish, rate limit, report, audit, quarantine/restore | PROVEN | Wallet-scoped 10/hour tests pass; live report and operator quarantine/restore produced database audit rows without report-triggered hiding. |
| SIWE-style nonce/session controls | PROVEN | Five-minute single-use nonce, domain/origin/chain validation, recovery, one-hour opaque cookie, replay smoke, and secure-cookie mode are implemented. |
| Editable wallet-owned creator profiles | PROVEN | Browser Demo Creator display name, bio, HTTPS website, and sanitized avatar saved/reloaded; UI states social links are not externally verified. |
| Immutable canonical-creator art binding | PROVEN | Live smoke returns 409 for rebinding and 403 for another creator's launch. ART22 renders its one-time bound sanitized media. |
| Seeded demo identity/artwork | PROVEN | Controlled launches resolve curated media and the clearly labeled Robyn Devnet Demo profile. |

## Interfaces, persistence, and release safety

| Requirement | Status | Evidence |
| --- | --- | --- |
| Auth/profile/media/metadata/report endpoints | PROVEN | Public/session and authenticated routes are live; `verify-creator-data-plane.sh` validates the read-only release surface. |
| PostgreSQL identity/media schema | PROVEN | Migration `0005_creator_identity.sql` creates profiles, media, bindings, reports, and moderation audit with lowercase chain/address keys and SHA-256 artifacts. |
| Redis-only nonce/session and browser-only watchlists | PROVEN | No signature, private key, source upload, or watchlist column exists in PostgreSQL; live watchlist persists only in browser storage. |
| Backward-compatible shared types | PROVEN | Existing no-query clients and legacy all-time fields remain valid; full strict typecheck and service tests pass. |
| Artwork resolution order | PROVEN | Active binding, curated controlled-devnet asset, then generated fallback is implemented and browser-tested. |
| Backup/restore coverage | PROVEN | Backup dynamically dumps every public table and all MinIO objects; restore checks every table row count and every content hash, covering the new schema without a static allowlist. |
| Immutable release gate includes creator data plane | PROVEN | New gate validates five tables, anonymous session, canonical profile/metadata, and active WebP bytes; its live run passed with 2 profiles, 11 media assets, 6 bindings, 2 reports, and 4 audit rows. |
| Exact immutable release, reboot, post-reboot browser evidence, encrypted off-VM restore | PROVEN | Exact `a586789f2e852f94008fc087d8a8e0308e94a668` passed all 12 release gates and immutable packaging, cold-reboot recovery, full Codex in-app-browser regression against the stable graduated state, eight independently matched wallet receipts, post-journey deployment verification, media quarantine/restore, encrypted off-VM backup, and isolated restore of 14 tables plus eight artifacts. Evidence is under `artifacts/browser-uat/2026-07-22-a586789/`. |
| Uninterrupted 24-hour soak | WAIVED | The user explicitly instructed Codex to skip this gate on 2026-07-22. The stopped producer truthfully records `aborted: true`, `completedDuration: false`, and `passed: false`. All 20 preserved samples over 288.503 seconds bound to exact release `a586789f2e852f94008fc087d8a8e0308e94a668`, with zero errors, alerts, or restarts; this short observation is not represented as a 24-hour soak. |

## Current quality gates

- Formatting, lint, strict typecheck, all service tests, Anvil smoke, and optimized builds pass.
- Foundry passes 29 unit/fuzz/adversarial tests and four invariants at 128 runs and 8,192 calls each.
- Protected chain-46630 build excludes devnet wallet/faucet/session-key markers and retains injected-wallet markers; the controlled-devnet build was restored afterward.
- The exact-release in-app-browser console has zero warning or error entries after the interactive acceptance run.
- No unresolved critical or high implementation defect is known. The 24-hour soak was explicitly waived by the user and remains recorded as not passed; the final no-override verifier must validate the waiver disposition and all other closure evidence before completion.

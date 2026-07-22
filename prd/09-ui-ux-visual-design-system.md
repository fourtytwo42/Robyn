# UI/UX and visual design system

Status: Draft specification, palette direction settled  
Owner: Product design/frontend TBD  
Date: 2026-07-21

## Design intent

Robyn should feel like an understandable onchain capital product, not a casino-style memecoin terminal. The visual system is dark-first, restrained, precise and basket-forward. It borrows the simplicity of Bags, the market transparency of Clanker and the reward explicitness of BONKfun without copying their brand expression.

The external asset basket is the visual center of discovery cards, launch preview and token pages. Holder-facing acquisition surfaces lead with the benefit: every token has its own reward basket. Trading fees are explained as the funding mechanism after the benefit is clear, while creator surfaces make fee routing and permanent economics explicit.

## Brand mark

The canonical Robyn mark is a compact right-facing robin whose three ascending wing feathers represent the one-to-three-asset reward basket. It follows the strongest launchpad convention found in the visual study: one recognizable glyph, no lettering inside the mark and enough silhouette contrast to remain legible at favicon size.

- Primary mark colors are deep navy `#0B1020` and Robyn teal `#35D0BA`.
- The transparent mark is paired with the uppercase `ROBYN` wordmark in the site header; the accessible home-link name remains text, not image content.
- Header, favicon, application-icon and Apple-touch variants derive from the same square master and may not change geometry independently.
- The three wing feathers must remain distinct at 32 pixels. Do not add coins, price arrows, stock symbols, gradients behind the mark or unverified third-party brand elements.
- Canonical production assets live in `apps/web/public/assets/brand/` and `apps/web/src/app/{favicon.ico,icon.png,apple-icon.png}`.

## Experience principles

1. **Truth before excitement.** Realized state is more prominent than projections; risk and delay are ordinary states, not buried exceptions.
2. **The basket is the product.** Assets, weights and fee flow are recognizable at a glance.
3. **Addresses establish identity.** Names, symbols, icons and colors aid recognition but never replace the contract address.
4. **Progressive disclosure.** New users see plain language; advanced users can inspect contracts, routes, proofs and blocks without leaving the flow.
5. **Calm transaction UX.** Signing states are deliberate and factual, with no urgency animation or celebratory treatment of risky financial actions.
6. **Accessible by construction.** Color never carries meaning alone; contrast, keyboard, focus, reduced motion and screen readers are core requirements.
7. **Mobile is a complete product.** Create, trade, reward and claim flows do not become read-only on mobile.

## Color system

R1 ships dark-first. A light theme may be added later because the semantic tokens do not encode raw colors inside components.

### Foundation tokens

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#0B1020` | App background |
| `surface-1` | `#141B2D` | Navigation, cards and primary panels |
| `surface-2` | `#1D263A` | Elevated panels, menus and selected rows |
| `surface-3` | `#253149` | Hover/pressed neutral surface |
| `border-subtle` | `#2A3448` | Dividers and default borders |
| `border-strong` | `#46546D` | Focus-adjacent structure and emphasized boundaries |
| `text-primary` | `#F5F7FA` | Primary text |
| `text-secondary` | `#B3BDCC` | Supporting text |
| `text-muted` | `#98A2B3` | Metadata and disabled explanations, subject to contrast validation |

### Brand and semantic tokens

| Token | Hex | Use |
|---|---|---|
| `brand-primary` | `#35D0BA` | Primary actions, selected navigation and Robyn identity |
| `brand-primary-hover` | `#5ADBC9` | Hover/focus emphasis |
| `on-brand` | `#061713` | Text/icons on primary action |
| `brand-secondary` | `#8B7CF6` | Secondary brand accent and basket relationships |
| `info` | `#4AA8FF` | Informational state and live indexed data |
| `success` | `#2FCB89` | Confirmed transaction or completed claim |
| `warning` | `#F2B84B` | Pending cash, delayed conversion and attention states |
| `danger` | `#F04438` | Revert, invalid input and critical incident |
| `reward-purchased` | `#F2B84B` | Purchased reward value, paired with label/icon |
| `focus-ring` | `#72E6D5` | Keyboard focus ring |

The palette intentionally avoids Robinhood's signature bright green as the dominant brand. Teal differentiates Robyn while retaining a modern financial tone. Red and green are never the sole distinction between buy/sell, success/failure or gain/loss.

### Contrast policy

- Normal text targets WCAG 2.2 AA contrast of at least 4.5:1.
- Large text and essential non-text UI target at least 3:1.
- Disabled controls remain legible but are not required to appear actionable.
- Every token pairing is tested in code; the hex table is a starting contract, not an exemption from contrast testing.

## Typography

### Families

- **Interface:** self-hosted `Inter Variable`, with `system-ui`, `Segoe UI`, sans-serif fallback.
- **Addresses, hashes, exact amounts and code-like identifiers:** self-hosted `IBM Plex Mono`, with `ui-monospace`, `Consolas`, monospace fallback.
- Use tabular numbers for balances, percentages, prices, timestamps and tables.

### Scale

| Role | Size / line height | Weight |
|---|---|---|
| Display | 48 / 56 | 650 |
| Page title | 32 / 40 | 650 |
| Section title | 24 / 32 | 600 |
| Card title | 20 / 28 | 600 |
| Body large | 16 / 24 | 450 |
| Body | 14 / 21 | 450 |
| Label | 13 / 18 | 600 |
| Caption | 12 / 18 | 450 |

Body text does not drop below 14px for essential actions or financial explanations. Truncated addresses provide copy/full-value inspection.

## Layout and spacing

- Four-pixel base spacing scale: `4, 8, 12, 16, 24, 32, 48, 64`.
- Desktop content max width: 1280px with 12-column grid.
- Tablet uses 8 columns; mobile uses 4 columns.
- Core breakpoints: 640px, 960px and 1280px; layout responds to available space, not device identity.
- Minimum interactive target: 44 by 44 CSS pixels.
- Default card radius: 12px; controls: 8px; dialogs/sheets: 16px.
- Shadows are minimal. Borders and surface elevation carry hierarchy.
- Sticky trading/claim actions must not cover disclosures, errors or wallet controls.

## Information architecture and page patterns

Primary navigation:

`Discovery → Create → Token detail → Rewards/portfolio → Creator profile → Learn → Contracts/status`

### Discovery

- Basket-forward cards are the default.
- Optional dense table supports advanced sorting/comparison.
- Cards show token identity, basket badges/weights, realized reward state, liquidity/volume freshness and route state.
- The default token browser is compact and responsive: three columns on wide desktop, two on compact desktop/tablet and one on mobile.
- Token artwork uses a fixed square thumbnail with proportional `object-fit: cover`; artwork MUST NOT be stretched into a mismatched aspect ratio.
- Browser cards omit pending rewards, converted totals and block-level operational detail; they link to the token page for those metrics, holder data and market detail.
- Browser cards surface verified market cap, trading volume and holder count beside the basket. They MUST label the actual interval (`Total volume` until a true rolling projection exists) and MUST show an unavailable state instead of fabricated metrics.
- Public basket labels lead with recognizable asset symbols and names. Contract addresses remain available for identity and verification but do not replace human-readable asset labels.
- Rankings never rely on raw volume alone.

### Create

`Token → Basket → Economics → Permanent rules → Preview and launch`

- One primary task per step.
- Persistent summary shows current token, basket total and permanent-rule status.
- Desktop may use side-by-side form/preview; mobile stacks form then sticky summary/action.

### Token detail

Recommended desktop hierarchy:

1. Identity, creator, contract and risk state.
2. Market/trade panel and price context.
3. Large basket allocation/reward state panel.
4. Wallet claim state.
5. Reward timeline, verification and contracts.

Mobile keeps identity and basket summary before the trading action; trading does not obscure reward/risk context.

### Rewards and portfolio

- Token amounts are primary and fiat values secondary.
- Pending, purchased, accrued, claimable and claimed states have distinct label, icon and semantic treatment.
- Claim selection clearly shows amount, gas and finality/epoch state.

## Core components

- Application shell and responsive navigation.
- Wallet/network control.
- Address identity/copy control.
- Token and asset avatar with deterministic fallback.
- Basket badge, allocation bar and weight editor.
- Token launch card and dense comparison row.
- Metric with source/freshness annotation.
- Reward state chip and route-status banner.
- Transaction preview, progress stepper and receipt result.
- Trade panel, quote expiry and allowance step.
- Claim panel and epoch/proof detail.
- Timeline/event row.
- Data table, filters and shareable query state.
- Empty, loading, stale, partial, unavailable and error states.
- Disclosure callout, confirmation and destructive-action dialog.

Components consume semantic tokens. A page must not invent one-off status colors or financial state names.

## Asset visualization

- Use verified asset metadata and logos only when provenance is known.
- Fallback avatar uses escaped symbol initials plus deterministic neutral/accent treatment; it never implies canonical status.
- A basket with one to three assets uses ordered segments and an accompanying textual list of exact weights.
- Never use a pie/donut chart without the textual percentages.
- Crypto, Stock Token and tokenized ETF receive explicit text labels, not icon-only categorization.

## Charts and tables

- Default charts use neutral price lines; gain/loss overlays are optional and labeled.
- Chart data exposes interval, source and freshness.
- Tooltips are keyboard accessible and have a text/table alternative.
- Purchased versus pending reward value uses solid versus outlined/hatched treatment plus labels.
- Tables use tabular numbers, sticky headers where useful and responsive priority rather than horizontal information loss.

## Motion

- Motion explains state change, not excitement.
- Standard duration: 120-200ms for local transitions; transaction progress follows actual events, not decorative timers.
- Respect `prefers-reduced-motion` and provide functionally equivalent static states.
- No confetti, flashing price treatments, urgency countdowns unrelated to quote expiry or animated gain celebrations.

## Voice and content

- Direct, calm and specific.
- Lead holder-facing acquisition copy with “Every token has its own reward basket” and “Hold the token. Earn the basket.”
- Reserve fee-flow-first explanations for creator, economics and verification surfaces; fee routing supports the holder benefit rather than replacing it.
- Say a token “has” a reward basket or lets holders “earn” basket assets. Never say the token “is” the basket, is backed by it or is redeemable for it.
- Prefer “Pending $18.40 for NVDA conversion” over “Rewards loading.”
- Prefer “Claim available after epoch finalizes” over “Coming soon.”
- Describe failure cause, retained funds and next safe action.
- Avoid “guaranteed,” “safe,” “backed,” “APY,” “dividend,” “risk-free,” and direct-share language.
- Never shorten an address without a copy/full-address path.

## Design requirements

| ID | Requirement | Priority | Verification |
|---|---|---:|---|
| DESIGN-001 | R1 MUST use the documented dark-first semantic color tokens; components MUST NOT embed arbitrary status colors | MUST | Token/static-code audit |
| DESIGN-002 | Text and essential non-text controls MUST meet WCAG 2.2 AA contrast in every supported state | MUST | Automated and manual contrast audit |
| DESIGN-003 | Status, gain/loss, buy/sell and asset classes MUST NOT rely on color alone | MUST | Grayscale/screen-reader review |
| DESIGN-004 | Interface and monospace typography MUST follow the documented self-hosted family, scale and fallback rules | MUST | Visual/CSS audit |
| DESIGN-005 | Financial numbers MUST use tabular figures; addresses/hashes MUST expose full copyable values | MUST | Component tests |
| DESIGN-006 | Core journeys MUST work on 4/8/12-column responsive layouts with 44px minimum targets | MUST | Responsive/device test |
| DESIGN-007 | Discovery and token pages MUST make basket assets, weights and realized reward state more prominent than speculative projections | MUST | Design review and comprehension test |
| DESIGN-008 | Create flow MUST use the five-step hierarchy with persistent configuration summary and explicit permanent-rule review | MUST | Prototype/E2E review |
| DESIGN-009 | Reward lifecycle states MUST use the canonical names, semantic token, icon and text definition consistently | MUST | Component/content audit |
| DESIGN-010 | Transaction surfaces MUST use factual preview, progress, receipt and safe-retry states without artificial urgency | MUST | E2E/content audit |
| DESIGN-011 | Charts and tables MUST expose source/freshness and an accessible nonvisual representation | MUST | Accessibility/data review |
| DESIGN-012 | Motion MUST respect reduced-motion preference and MUST NOT gamify trading, gains or claims | MUST | Motion/accessibility audit |
| DESIGN-013 | Icons and asset avatars MUST have labels or accessible names and deterministic safe fallbacks | MUST | Component/accessibility test |
| DESIGN-014 | Loading, empty, stale, partial, unavailable and error states MUST be designed for every financial component | MUST | State inventory review |
| DESIGN-015 | Product content MUST follow the calm, precise vocabulary and prohibited-claim rules | MUST | Content/legal audit |
| DESIGN-016 | Components MUST consume semantic tokens so a later light theme can be added without changing product meaning | SHOULD | Theme architecture review |
| DESIGN-017 | A versioned component inventory and token reference MUST be maintained alongside implementation | MUST | Documentation review |
| DESIGN-018 | Release visual QA MUST cover desktop/mobile, keyboard, screen reader, 200% zoom, contrast and reduced motion | MUST | Signed QA matrix |

## Deliverables before frontend implementation

1. Token file expressed as CSS variables and design-tool variables.
2. Desktop and mobile wireframes for discovery, create, token detail, rewards/portfolio and transaction states.
3. Component inventory with every financial/degraded state.
4. Clickable prototype for creator and holder comprehension studies.
5. Accessibility annotation and content inventory.
6. Maintain the canonical logo/brand-mark source, optimized web asset and browser-icon derivatives documented above.
## Circus-Informed Market Layer (2026-07-21)

Robyn's launchpad UI SHALL combine the established dark reward-basket design system with the market density and task hierarchy observed on Circus. `research/16-circus-launchpad-ux-study.md` is the supporting reference and screenshot index.

- The global shell SHALL include a horizontally scrollable live market tape showing token symbol, canonical market cap and percentage change. It SHALL NOT substitute basket size or holdings for percentage change. Indexed environments require a defined comparison window. The controlled chain-31337 public demo MAY use deterministic non-zero display movement only behind the explicit `ROBYN_DEMO_MARKET_CHANGES=true` API flag; the response SHALL identify `priceChangeSource: "demo"`, the UI SHALL expose that status accessibly, and the API SHALL ignore the flag on all other chain IDs.
- The homepage SHALL behave as a launchpad market board: a concise holder-first hero, real platform activity metrics, image-forward market cards, and direct paths to create and trade.
- Discovery SHALL use a dense responsive grid that reaches four columns at the widest supported layout, then three, two, and one columns as space decreases.
- Discovery cards SHALL show token identity, undistorted art, market cap, volume, holders, canonical address shorthand, and readable basket symbols/weights. Operational conversion and block details remain on the token page.
- Each card SHALL visualize immutable basket composition with a segmented weight rail and, for native curve launches, a separate compact graduation rail sourced from canonical indexed reserve state. Basket composition and graduation progress answer different questions and neither replaces the other. Legacy fixed markets SHALL be labeled rather than assigned invented progress.
- Native token pages SHALL show `Bonding`, `Graduation ready` or `Graduated`, current progress, net amount raised, immutable target, remaining curve inventory and the canonical locked-liquidity receipt after graduation.
- Graduation SHALL require no separate user action. When the threshold transaction confirms, the token page SHALL change the venue label and pool/lock proof from canonical indexed state while keeping the same Buy/Sell controls in place. Those controls SHALL automatically use the bound Uniswap quote and execution path after graduation and disclose `Trading on Uniswap v3 through Robyn`.
- A graduated token page SHALL link the canonical Uniswap pool, immutable position locker and graduation transaction. It SHALL NOT claim that the controlled-devnet rehearsal pool is Uniswap or that an unverified testnet clone is canonical.
- Creation SHALL preview the fixed supply, curve allocation, graduation allocation, fee routing, target and pre-graduation transfer policy before signature.
- The canonical token page SHALL prioritize token identity, market cap, current indexed price, chart, trade action, reward basket, holder concentration, recent trades, and contract provenance in that order.
- The creation experience SHALL pair launch inputs with a clear preview of the resulting token and basket. Durable user-uploaded media remains blocked on the separately documented artifact and moderation threat model.
- Robyn SHALL retain its own navy/teal/violet/gold palette, logo, holder-first message, exact mock/testnet disclosures, and nonredeemability language. Circus's branding, metaphors, graphics, and unsupported economic claims SHALL NOT be copied.

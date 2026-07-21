# Circus Launchpad UX Study

Last verified: 2026-07-21

## Scope

This study reviews the public launchpad at [circus.trade](https://circus.trade/) as a visual and interaction reference for Robyn. The goal is not to copy Circus branding or its economic model. It is to identify launchpad conventions that make a market feel active, legible, and immediately usable, then combine those conventions with Robyn's dark-first reward-basket identity.

Public pages inspected:

- Trending board: `https://circus.trade/`
- Token market: `https://circus.trade/coin/0xcce2422ff871572052ead2c8d0831abe57f01283`
- Creation flow: `https://circus.trade/create`
- Product explanation: `https://circus.trade/how-it-works`
- Portfolio empty state: `https://circus.trade/portfolio`
- Both light and dark homepage treatments

All market values in the screenshots were live and volatile at capture time. They are evidence of layout and information hierarchy, not durable market facts.

## Screenshot Index

| Capture | What it demonstrates |
| --- | --- |
| [Homepage](screenshots/circus/01-home.png) | Market tape, hero, platform statistics, category tabs, filters, dense image grid |
| [Token detail](screenshots/circus/02-token-detail.png) | Token identity, chart-first market workspace, sticky trade panel, graduation progress, holders and contracts |
| [Create](screenshots/circus/03-create.png) | Two-column form and live card preview, image upload prominence, concise launch economics |
| [How it works](screenshots/circus/04-how-it-works.png) | Plain-language lifecycle, numbered steps, lane comparison and trust explanation |
| [Portfolio](screenshots/circus/05-portfolio.png) | Focused wallet-gated empty state and restrained page chrome |
| [Dark homepage](screenshots/circus/06-home-dark.png) | Near-black canvas, warm featured panel, subtle surface separation and bright market art |

## Patterns Worth Reusing

### 1. Market activity begins in the header

Circus places a horizontally scrolling market tape directly below the primary navigation. Each item exposes a ticker, market cap, and movement signal. This makes the product feel like a live exchange before the user reaches the main board.

Robyn adaptation: show real indexed token symbol, market cap, and reward-asset count. Do not invent price-change percentages because Robyn does not yet maintain a trustworthy time-window projection.

### 2. The homepage is a market board, not a marketing brochure

Circus keeps its hero shallow, pairs it with a compact trending module, follows with truthful platform statistics, then gives most of the viewport to token discovery. Images are large enough to establish identity, but market cap and launch progress remain visible without opening the token.

Robyn adaptation: keep the holder-first reward-basket hero, reduce its vertical footprint, add real launchpad statistics, and bring the live reward markets closer to the fold.

### 3. Cards combine identity, status, and one decision signal

Circus cards use square token art, age, market cap, launch progress, name, symbol, and contract shorthand. They avoid operational back-office data on the board.

Robyn adaptation: preserve compact square art and market cap/volume/holder metrics. Replace bonding-curve progress with a segmented reward-weight rail because immutable basket composition is Robyn's differentiator. Keep pending conversion, indexed block, contracts, and claims on the canonical token page.

### 4. The token page is a working market surface

Circus leads with token identity and market cap, then gives the chart the widest column and holds the buy/sell panel in a stable right rail. Secondary metrics, graduation state, holders, and trades support the decision without competing with the trade action.

Robyn adaptation: retain the existing canonical analytics, chart, trade panel, reward basket, top holders, recent trades, and provenance. Strengthen the market-cap/price hierarchy in the token hero and keep reward economics visible directly below trading.

### 5. Creation benefits from an immediate preview

Circus presents the creation form beside a rendered token card. The creator can see how the name, ticker, and image will appear while also reading the curve and fee rules.

Robyn adaptation: present an example launch preview beside the intro and retain the existing functional launch console. The eventual metadata-upload feature must still pass the separate moderation, decoding, type, size, and content-addressing threat model already recorded in project requirements.

### 6. Trust explanations use a lifecycle, not a wall of protocol terms

The Circus explanation page begins with three numbered lifecycle steps and only then expands into launch lanes, liquidity, fee, anti-sniper, ranking, and verification details.

Robyn adaptation: future public education should lead with `launch -> trade -> fees fund basket -> holders claim`, followed by precise nonredeemability, mock/testnet, contract, and risk disclosures.

## Patterns Not To Copy

- Do not reuse Circus's orange/cream identity, serif voice, circus metaphors, images, or marks.
- Do not imply a bonding curve, graduation target, Uniswap migration, locked LP, creator reward percentage, gas subsidy, or anti-sniper mechanism that Robyn does not implement.
- Do not add live percentage changes without a defined, indexed time window and durable projection.
- Do not call Robyn's community token backed by or redeemable for its reward basket.
- Do not obscure the controlled-devnet or testnet-mock state in the pursuit of launchpad polish.

## Robyn Hybrid Direction

The selected direction is a dark, market-dense launchpad with Robyn's existing navy, teal, violet, and gold system:

- Near-black canvas and layered navy surfaces remain the base.
- Teal indicates primary action and live/canonical state.
- Violet distinguishes secondary data and addresses.
- Gold signals reward value and special launchpad moments.
- A site-wide market tape exposes real market cap and basket breadth.
- Hero panels become shallower and more dashboard-like.
- Discovery becomes a denser four/three/two/one-column responsive board.
- Token cards keep undistorted square art and add a segmented basket-weight rail.
- Token detail emphasizes market cap and per-token price before the chart/trade workspace.
- Creation gains a visually representative basket preview without pretending unsupported metadata is durable.

## Acceptance Criteria

- Every market value shown is sourced from canonical indexed data or is explicitly unavailable.
- Images use a square crop with `object-fit: cover`; no token or asset art is stretched.
- Desktop discovery fits at least four compact cards at the widest supported layout, while tablet and mobile degrade to three, two, and one columns without horizontal overflow.
- The reward basket is visually identifiable on the homepage, discovery card, creation surface, and token detail page.
- All user-facing paths remain keyboard navigable and preserve semantic headings, labels, tables, and disclosures.
- The controlled-devnet/testnet state remains visible.


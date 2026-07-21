# Robinhood Chain launchpads and competitive landscape

Last verified: 2026-07-20

## Summary

Robinhood Chain already has a crowded, very young launchpad market. Most products compete on the same mechanics: no-code token creation, bonding curves or direct DEX liquidity, locked liquidity, anti-snipe controls, and lifetime creator fees.

The most relevant competitors are not necessarily the largest by headline activity. For this proposal, the strategically important products are:

- **Vladdy** for a live launch flow that can route 100% of the creator share into one selected Stock Token and give holders pro-rata claims.
- **Alloy** for a live one-stock dividend-memecoin launchpad and a separate fully collateralized index factory.
- **HoodETF** and **BASKET Protocol** for additional permissionless, creator-defined Stock Token basket factories.
- **pons** for a configurable creator payout wallet and direct Uniswap v3 launch model.
- **Bags** for multiple fee claimers and detailed integration contracts.
- **hood.fun** for pro-rata holder rewards from creator fees.
- **Virtuals** for advanced token launches and fee delegation.
- **Vimen** for immutable, redeemable Stock Token baskets created by curators.

The ecosystem expanded materially around mainnet launch. A focused, point-in-time comparison of Vladdy, Alloy, IndexPad, HoodETF, BASKET Protocol, Vimen, HOODL, Skep, hMAG7 and fee-funded reward tokens is in [IndexPad-like products](12-indexpad-like-products.md).

## Comparison

| Product | Status observed | Launch and liquidity model | Fee and reward model | Overlap with proposed product | Evidence quality |
|---|---|---|---|---|---|
| [pons](https://pons.money/) | Live mainnet | Fixed 1B supply; token and WETH Uniswap v3 pool created together; liquidity locked; no migration; 4.2 ETH graduation milestone | 1% pool fee; current factory split is 70% creator and 30% protocol; creator chooses a fee wallet at launch | Strong integration candidate because the fee wallet may be a distributor contract; no basket purchases or holder rewards documented | High: detailed docs, addresses, events, and live app |
| [Bags](https://docs.bags.fm/robinhood/overview) | Live mainnet | Fixed 1B supply; bonding curve sells 830M; graduates into a locked Uniswap v4 position with 170M | 2% on the ETH/WETH leg; 1% creator half split among fee claimers by basis points; 1% protocol half, with optional partner share | Strong integration candidate because fee claimers and partner routing are first-class; no RWA basket conversion documented | High: detailed developer docs and contract book |
| [hood.fun](https://hood.fun/whitepaper) | Live mainnet | Bonding curve; 80% sold on curve and 20% reserved for locked Uniswap v3 liquidity after graduation | 1% trade fee; 80% of creator-side economics to creator and 20% to protocol; community mode routes creator fees pro rata to holders | Closest holder-reward competitor; it distributes fee value but does not document automatic conversion into a creator-selected asset basket | High: whitepaper, terms, and live UI |
| [Virtuals](https://app.virtuals.io/create) | Live Robinhood launch option | Advanced token and agent launch flow with token distribution controls, scheduling, pre-buy, anti-sniper options, airdrops, vesting, and automated capital formation | The live creator UI exposes fee delegation and ACF, which converts allocated launch tokens to USDC as price rises | Strong creator-tooling competitor; its core launchpad is broader than memes and can launch projects that build RWA products | Medium-high: live UI and official Virtuals pages, but Robinhood-specific public technical docs were limited |
| [Vimen](https://www.vimen.org/press) | Live mainnet; launched its `VIM` token on Virtuals | Each basket has an immutable contract; users mint by depositing the exact underlying Stock Tokens in kind and redeem by burning the basket token | 0.30% mint fee, hard-capped at 0.50%; redemption is free; licensed curators earn 60% of their basket's mint fees | Closest basket competitor. It is actually backed and redeemable, but it does not use a separate meme/community token's trading fees to build holder rewards | High: product docs, public code links, fee details, and legal limits |
| [NOXA Fun](https://noxafun.com/) | Live interface with many early mainnet tokens visible | No-code launch and token catalog; many graduated launches are visible | Detailed fee, liquidity, and contract rules were not found in the public page reviewed | Competes for creator attention and early meme liquidity; no verified basket feature | Medium-low: live interface, limited public mechanics |
| [Robinfun](https://robinfun.live/) | Live interface | Fair-launch bonding curve; claims a roughly $4K starting market cap and roughly $44K graduation into Uniswap; 100% of LP burned; no presale or team allocation | No detailed creator-reward split found in the reviewed page | General launchpad competitor, not a verified fee-basket competitor | Medium: live interface and short public description |
| [HoodPad](https://hoodpad.fun/docs) | Live docs and interface | Seeded liquidity, optional dev buy, max-wallet limit, anti-snipe fee window | Published split is 0.8% creator, 0.2% team, and 0.2% buyback treasury; treasury buys `HPAD`; staking rewards are described as coming soon | Demonstrates automated fee-funded market buys, but buys its own platform token rather than a creator-selected basket | Medium-high: detailed product docs; contract verification not assessed |
| [RobinPad](https://www.robinpad.fi/whitepaper) | Testnet complete; security audit active; mainnet pending in the published roadmap | Direct-to-DEX, locked-liquidity launch; fixed 1B supply; no bonding curve migration | 1% pool fee split 60% creator, 30% platform, 10% referrals | General launchpad and referral competitor; not yet a mainnet basket product | Medium-high: detailed whitepaper, but roadmap says mainnet is pending |

## pons

pons launches a fixed-supply token and a WETH Uniswap v3 pool in one transaction. The creator chooses the token metadata, initial buy, and fee wallet. The pool exists from the first trade and does not migrate. “Graduation” is only the point at which paired WETH reaches the current 4.2 ETH threshold.

Current-factory economics:

- 1,000,000,000 token fixed supply.
- 0.0005 ETH launch fee.
- 1% Uniswap v3 pool fee.
- 70% of pool fees to the creator and 30% to pons.
- Legacy launches retain their earlier 90/10 split.
- Fees accrue in both the launch token and WETH.

Why it matters: a basket distributor set as the creator payout wallet could receive the fee stream without rebuilding the token factory or liquidity locker. This must be verified with a mainnet fork or test launch because the docs confirm arbitrary payout addresses but do not explicitly guarantee that every claim and redirect path is contract-wallet-safe.

Sources: [pons documentation](https://docs.ponsfamily.com/), [pons app](https://pons.money/).

## Bags

Bags exposes the clearest third-party integration surface reviewed. Its Robinhood deployment is fully onchain and does not require an API key. Each token receives a `BagsFeeShare` contract, and the creator half of the trade fee can be split among multiple fee claimers by basis points fixed at launch.

Published mechanics:

- 1B fixed supply.
- 830M sold on a virtual `x*y=k` bonding curve.
- 170M paired with the raise at graduation in Uniswap v4.
- Locked post-graduation liquidity.
- 2% fee on the ETH/WETH leg in both phases.
- 1% of trade volume is the creator half, split among fee claimers.
- The protocol half is another 1%, with an optional partner portion.
- Default creation fee is 0.02 ETH, but factory globals can change and must be read live.

Why it matters: the proposed platform could be a Bags partner and automatically register a `BasketFeeRouter` as one fee claimer. This provides an earlier path to revenue than building a new AMM or locker.

Source: [Bags Robinhood Chain developer documentation](https://docs.bags.fm/robinhood/overview).

## hood.fun

hood.fun is the most important fee-distribution precedent. It publishes a `community mode` in which the creator-fee share is allocated pro rata to the token's holders instead of one creator wallet.

Published mechanics:

- Creator-selectable supply from 1 to one quadrillion tokens.
- 80% of supply sold on the curve and 20% reserved for graduation liquidity.
- Free launch aside from gas.
- 1% curve fee with 80% to the creator side and 20% to the protocol.
- A locked 1% Uniswap v3 pool after graduation, with ETH-side fees split 80/20 and launch-token-side fees burned.
- Community mode, creator fee handoff, and a timelocked community takeover path.

Why it matters: holder fee rewards are already part of the local market. The differentiated feature cannot simply be “fees go to holders.” It must be the immutable asset allocation and automatic conversion of those fees into a visible portfolio.

The public materials conflict on delivery mechanics: the whitepaper says community-mode rewards are sent automatically without holder gas, while the terms say rewards are claimed onchain. Treat the contracts as authoritative and verify the deployed implementation before using this feature as an integration dependency.

Sources: [hood.fun whitepaper](https://hood.fun/whitepaper), [holder-reward terms](https://hood.fun/terms).

## Virtuals and Vimen

Virtuals is an AI-agent and tokenization launch platform rather than a basic Pump.fun clone. Its live Robinhood creation flow exposes automated capital formation, pre-buy, custom token distribution, vesting, airdrops, anti-sniper controls, robotics configuration, and fee delegation.

Vimen is a separate protocol launched through Virtuals. It is a direct proof that immutable Stock Token baskets work on Robinhood Chain:

- A basket token is a standard ERC-20.
- Each basket is backed by fixed quantities of Stock Tokens in its own immutable contract.
- Minting requires the underlying assets in kind.
- Redemption burns the basket token and returns the underlying assets.
- Curators burn 25,000 `VIM` for a permanent publishing license.
- The basket recipe is frozen at deployment.
- Curators receive 60% of mint fees.
- Vimen reports 44 supported assets and three initial baskets, compared with 96 assets in Robinhood's broader live registry.
- Vimen says its contracts are unaudited, caps deposits at $100K per basket, and excludes U.S. persons.

Why it matters: a generic “make your own tokenized stock index” pitch has already launched. The proposed product should focus on **fee-funded holder rewards attached to community tokens**, not compete head-on as another in-kind index minter.

Sources: [Virtuals Robinhood creation flow](https://app.virtuals.io/create), [Virtuals announcement of Vimen](https://x.com/virtuals_io/status/2077324765027840502), [Vimen press kit](https://www.vimen.org/press), [Vimen curator model](https://www.vimen.org/vim).

## Other observed platforms

Recent Robinhood Chain trading-tool releases also mention Bankr, Flap, Livo, Trench, LeaveHood, ApeStore, and other launch or trading surfaces. These names show how quickly the market is expanding, but their mechanics were not individually verified for this report. They should remain on a monitoring list, not in a feature matrix presented as fact.

## Competitive conclusion

The proposal is possible, but the original pitch must be sharpened:

> Launch a community token whose creator-fee stream automatically buys an immutable, creator-selected portfolio of eligible onchain assets. Holders accrue and claim the purchased assets according to transparent rules.

The defensible pieces would be:

1. A live, canonical asset allowlist from Robinhood's registry.
2. Reliable Stock Token RFQ and UniswapX execution with oracle safety.
3. Holder accounting that cannot be gamed with snapshot timing.
4. A visible “fees earned, assets purchased, rewards claimable” dashboard.
5. Launchpad adapters, allowing the basket system to receive fees from pons, Bags, and eventually other protocols.
6. Compliance controls that competing meme launchpads generally do not provide.

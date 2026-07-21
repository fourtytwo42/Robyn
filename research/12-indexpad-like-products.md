# IndexPad-like products on Robinhood Chain

Research date: 2026-07-20

## Bottom line

Yes. IndexPad is not alone, and the competitive field is broader than the earlier launchpad survey showed.

The closest live products split into two groups:

1. **Fee-funded holder rewards:** a community token's trading fees buy a Stock Token or another asset and credit or airdrop it to holders. Vladdy and Alloy are the strongest launchpad examples.
2. **Redeemable basket factories:** users deposit underlying Stock Tokens and receive a basket-share ERC-20 that can be burned for the underlying. HoodETF, Alloy Index, BASKET Protocol and Vimen are live examples. HOODL is a live fixed-basket implementation.

No verified live product found in this pass combines all of Robyn's requested features in one launch flow: a creator-selected **weighted multi-asset** reward basket, permissionless community-token launch, automatic conversion of that token's trading fees into every selected asset, and transfer-aware holder claims. That narrower gap remains real, but it is now a feature gap inside an active category rather than a greenfield idea.

## Competitive map

| Product | Current state | Model | How close to Robyn | Important limitation |
|---|---|---|---|---|
| [Vladdy](https://www.vladdy.fun/how-it-works) | Mainnet product with verified factory/hook/router; four live launches | Launch a token, select a 1%, 2%, 3% or 5% trade fee, and route the creator share into one selected Stock Token; holders claim pro rata | **Very close** to the requested launch experience and fee-to-holder loop | Only one reward token; factory enforces nonzero address rather than canonical registry membership; all four distributors reported zero stock purchased/distributed at the fresh audit; fallback conversion trusts an agent |
| [Alloy](https://www.alloy.fund/docs) | Current mainnet app plus an older MIT repository/deployment | Advertises a single-stock 70/20/10 reward/creator/buyback sweep | **Very close** as a source-design reference | Old live factory actually reports 0/100/0, current website launchpad is different and unverified, repository tests are stale/failing, and published old keeper/index records are invalid/empty |
| [IndexPad](https://docs.indexpad.io/) | Testnet software; docs also publish mainnet references, but the project says it is unaudited | Swap fees deepen a per-index treasury containing USDG and selected Stock Tokens; holders burn for pro-rata backing | Exact category reference for fee-funded baskets | Current model is redemption rather than direct dividend claims; linked source repository was inaccessible in the earlier provenance check |
| [HoodETF](https://docs.hoodetf.org/) | Mainnet, deployed 2026-07-10; five seeded baskets and permissionless creation | Creator picks 2-20 whitelisted constituents and weights, seeds a vault, and sets entry, exit and management fees; shares redeem in kind; creator receives 90% of fees | **Very close** to the creator-defined basket half of the product | It is a capital-backed vault, not a memecoin whose trading fees buy rewards. The factory returned `is_verified=false` in the Blockscout address API despite the docs' detailed contract reference; no external audit or public source license was found |
| [Alloy Index](https://www.alloy.fund/about) | Mainnet factory published | Anyone can bundle selected Stock Tokens into a fully collateralized index token and mint/redeem in kind | Direct basket-factory competitor | Separate from Alloy's dividend-memecoin launchpad; does not turn the community token's trading fees into a weighted reward basket |
| [BASKET Protocol](https://rindex.app/docs) | Mainnet contracts and seven named vaults published | Permissionless Stock Token basket vaults with Chainlink NAV, rule-based rebalancing, management/rebalance fees and in-kind redemption | Strong architecture reference for dynamic baskets and rebalancing | More complex and governance-dependent than Robyn's immutable reward basket; explicitly unaudited. Factory was verified in the live Blockscout API check |
| [Vimen](https://www.vimen.org/) | Mainnet; MAG7, AI6 and HOOD6 advertised live | Immutable in-kind baskets of Stock Tokens and chain-native assets; mint fee, free redemption | Proven implementation of redeemable baskets | Not a general community-token launch plus fee-reward product; contracts are unaudited |
| [HOODL](https://hoodl.finance/) | Mainnet site advertises live contracts and deployed indexes | Fixed cross-asset indexes minted and redeemed in kind, with a USDG zap and live NAV lens | Useful fixed-unit basket and zap reference | Current public page is centered on deployed indexes rather than a clearly documented open launchpad and holder-reward stream |
| [Skep](https://www.skep.finance/) | Pre-launch/private beta; contracts still described as in development | Creator-built, rules-based Stock Token baskets with 0-1% management fee and 70/30 creator/protocol split | Product and UX competitor to watch | Not live; audit listed as pending; advertised features are not deployment evidence |
| [hMAG7](https://hmag7.com/) | Contradictory pre-launch page: says one-click mint is live but also says the protocol has not launched and all contract addresses are “Deploying” | Planned fully collateralized basket factory with in-kind redemption and creator fee shares | Adjacent planned factory | Treat as pre-launch until addresses and activity exist; marketing claims are internally inconsistent |

## Live single-token reward products

These are not launchpads, but they prove demand for the same economic story and show alternative distribution patterns.

| Product | Mechanism | Evidence quality |
|---|---|---|
| [HoodStocks](https://www.hoodstock.fun/) | Claims fees buy 13 Stock Tokens and airdrop them proportionally every 15 minutes | First-party site calls it mainnet/live, but the inspected public page did not expose the engine contract or a public code repository; treat automation and custody claims as unverified until the ledger and contracts are audited |
| [HoodStrategy](https://robinhoodstrategy.com/) | Creator fees buy a random top Robinhood Chain token every five minutes and airdrop it to eligible holders | Public page exposes a token address and distribution UI, but this is one token, not a reusable factory |
| [DIVIDENDS / DRIP](https://www.dividendsmoney.site/) | Proposed fees buy tokenized HOOD and distribute it to holders | Pre-launch: the page says the holder terminal is being built and the contract address is to be announced |
| [HOODETF meme](https://www.hoodetf.fun/) | Treasury-operated launch fees buy a preset meme basket, then snapshot-based airdrops pay holders | Operational model, not a trust-minimized vault: the site says fees and airdrops run through a treasury wallet |
| [MacroHard via FEES](https://fees.cx/docs/) | An 8% token tax buys MSFT and credits a dividend tracker | One-stock reference only; FEES says its separate platform-fee-to-reward pipeline is not live |

## What this changes for Robyn

### The differentiation is now narrower

“Launch a coin that pays a Stock Token to holders” is already offered by Vladdy and Alloy. “Create a redeemable on-chain stock basket” is already offered by HoodETF, Alloy Index, BASKET and Vimen. Robyn should therefore lead with the combination competitors do not currently expose:

- two to five immutable reward assets per launch;
- exact creator-selected weights such as 40% NVDA, 40% another available asset and 20% SPY;
- mixed Stock Token, ETF-token and approved crypto/community-token baskets;
- visible per-asset fee conversion and claim accounting;
- a choice between direct claim rewards and, later, a separately labeled redeemable-vault product;
- route quality and failure handling designed for thin Stock Token liquidity.

### The fastest validation path changed

Before building a complete native launch stack, test whether Vladdy will support multiple stock-reward distributors or whether its verified contracts expose an integration seam. It already solves token deployment, Uniswap v4 pool creation, locked liquidity, inline fee capture and a per-token distributor. If there is no safe extension point or license, treat it as a behavioral reference rather than copied code.

Alloy remains the most useful known source-code accelerator because its earlier public repository is MIT-licensed and implements transfer-aware cumulative reward accounting. Its current public product proves the one-stock user flow, but the repo/deployment mismatch must be resolved before relying on the current deployment or representing the repository as its exact source.

For a redeemable basket product, HoodETF is the closest current UX and fee competitor, while Vimen remains the cleaner open-source contract reference. BASKET is useful for oracle, rebalance and risk-control ideas, not as a dependency unless complete source provenance and a suitable license are obtained.

## Due-diligence warnings

- A polished website is not proof that contracts are deployed, verified, audited or controlled as described.
- “Verified on Blockscout” exposes source corresponding to bytecode; it does not grant permission to copy that source. A repository license or explicit license is still required.
- Several projects are unaudited, pre-launch, or present internally inconsistent status claims.
- Direct holder airdrops require holder enumeration or snapshots. Robyn should use transfer-aware cumulative accounting or claim epochs, not an unbounded on-chain loop.
- Redeemable baskets and reward tokens are economically and legally different. Robyn must not call a nonredeemable fee-reward token “backed.”
- All Stock Token wrappers inherit issuer restrictions, administrative powers and jurisdictional limitations described in the Robinhood and RHJ terms study.

## Verified primary sources

- [Vladdy mechanics and published contracts](https://www.vladdy.fun/how-it-works)
- [Alloy dividend-memecoin documentation](https://www.alloy.fund/docs)
- [Alloy index factory overview](https://www.alloy.fund/about)
- [IndexPad documentation](https://docs.indexpad.io/)
- [HoodETF overview](https://docs.hoodetf.org/)
- [HoodETF deployed addresses](https://docs.hoodetf.org/addresses)
- [HoodETF security notes](https://docs.hoodetf.org/security)
- [BASKET Protocol documentation](https://rindex.app/docs)
- [Vimen](https://www.vimen.org/)
- [HOODL](https://hoodl.finance/)
- [Skep](https://www.skep.finance/)
- [hMAG7](https://hmag7.com/)
- [HoodStocks](https://www.hoodstock.fun/)
- [HoodStrategy](https://robinhoodstrategy.com/)
- [HOODETF fee-routed meme basket](https://www.hoodetf.fun/)
- [FEES and MacroHard documentation](https://fees.cx/docs/)

Status and product facts are a point-in-time snapshot. Recheck contracts, activity, source provenance, terms and audits immediately before integration or launch.

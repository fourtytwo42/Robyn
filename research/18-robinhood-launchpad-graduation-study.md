# Robinhood Chain launchpad bonding curves and graduation

Status: Point-in-time product, documentation, verified-source, and onchain study

Research date: 2026-07-22

Scope: Robinhood Chain launchpads with enough public evidence to classify their launch and graduation mechanism

## Executive answer

Most curve-based launchpads on Robinhood Chain graduate into a locked external DEX pool. The dominant destination is Uniswap v3. Circus, hood.fun, and Robinlaunch all describe or implement a curve-to-Uniswap-v3 path. vladlaunch instead graduates a USDG-denominated curve into SushiSwap v3. Rooket documents a Uniswap v4 destination, while Robinfun claims Uniswap v2.

That is not the whole market. pons, LaunchHood, NOXA Fun, LootPad, Robin Launchpad, and the Fair Open lane on Circus create a real DEX pool at launch. Their apparent bonding experience comes from single-sided concentrated liquidity or a DEX-native auction. For those products, “graduation” is a progress badge, ranking threshold, or liquidity milestone; there is no second venue and no migration transaction.

Robyn's controlled-devnet design is closest to the true migration group:

- the fixed `1B / 800M curve / 200M liquidity` split matches the most common curve template;
- its virtual-reserve constant-product curve is materially similar to hood.fun, Robinlaunch, Circus Classic, Rooket, and vladlaunch;
- its threshold-reaching buy migrates atomically, which is stronger than a design requiring a later permissionless migration call;
- its graduated venue is currently a Robyn-only local constant-product rehearsal pool, not Uniswap or another Robinhood Chain DEX;
- its 1% fees fund a weighted reward basket before and after graduation, which is the principal economic difference from every competitor reviewed.

Therefore bonding and graduation are genuinely implemented on the local Robyn network, but the production Robinhood adapter is not. Before public-testnet or mainnet deployment, Robyn still needs a verified DEX adapter, immutable fee-collecting liquidity locker, price-continuity simulation, and chain-specific deployment configuration.

## Terminology: three systems marketed with similar language

| Model | Before milestone | At “graduation” | After milestone | Examples |
|---|---|---|---|---|
| Internal curve to DEX | Launchpad contract holds inventory and quote reserves; a virtual-reserve formula prices trades | Assets are moved or minted into a new external pool | Trading moves to the DEX | Circus Classic, hood.fun, Robinlaunch Curve, vladlaunch, Rooket, Robinfun, Virtuals |
| Pool-native launch | A locked DEX position is the market from the first block | No venue change; the app changes status when a threshold is observed | Same pool continues | pons, LaunchHood, NOXA Fun, LootPad, Robin Launchpad |
| DEX-native auction or price ladder | DEX liquidity is arranged as an auction or multiple price bands | No conventional curve completion | Same DEX system continues | Circus Fair Open with Doppler and Uniswap v4 |

This distinction matters because a pool-native product has no migration failure or price handoff, while a two-phase product can isolate the launch market and reserve a deterministic token allocation for graduation. Calling both systems “bonding curves” or “graduation” without explaining the venue transition hides an important protocol difference.

## Comparison matrix

| Platform | Initial pricing and venue | Quote | Typical supply split | Trigger | Destination | Migration behavior | Liquidity and fee custody | Evidence confidence |
|---|---|---:|---:|---:|---|---|---|---|
| hood.fun | Virtual-reserve constant product, `x*y=k` | ETH | Default 1B; 80% curve, 20% LP | About 6.5 ETH raised | Uniswap v3, 1% | Curve completes, then permissionless `migrate` can be called | LP NFT in ownerless no-withdraw locker; creator/protocol can collect configured fees | High: first-party whitepaper; source behavior described precisely |
| Circus Classic | ETH bonding curve; public formula claimed | ETH | 1B; 800M curve, 200M LP implied by product | About 6.5 ETH | Uniswap v3, 1% | Atomic in threshold-reaching transaction | Immutable FeeLocker; creator receives a post-graduation fee share | High: first-party guide plus independently observed graduated v3 pool |
| Robinlaunch Curve | Virtual-reserve constant product | ETH | 1B; 800M curve, 200M LP | 2.5 ETH net reserves | Uniswap v3, 1% | Atomic `_graduate()` in final buy; excess refunded | LP NFT sent to fee collector/locker; current source exposes fee collection without principal withdrawal | High: first-party docs and verified deployed source |
| vladlaunch | Virtual-reserve constant product | USDG | 1B; remaining curve inventory becomes LP | 8,000 USDG | SushiSwap v3, 1% | Final buy seeds pool in the same transaction | Graduation contract and Sushi v3 position; five proxy admins remain a disclosed governance risk | High for documented architecture and deployed bytecode; implementation source is only partly verified |
| Rooket | Virtual-reserve constant product | ETH | 1B; 800M curve, 200M LP | 4 ETH real reserves | Uniswap v4 | Docs say remaining ETH after 2% migration fee plus 200M tokens become liquidity | Docs claim permanent burn/lock; exact v4 position custody was not independently proven | Medium: first-party docs; no live launches and no verified deployment provenance found |
| Robinfun | Bonding curve; exact public formula not found | ETH | Site says 1B on curve; migration accounting is not sufficiently disclosed | About 2.6 ETH | Uniswap v2 | Claimed migration with LP burn | Creator-selectable token transfer taxes continue after graduation | Medium-low: first-party marketing only; contract source not independently established |
| Virtuals | Prototype bonding curve paired with VIRTUAL | VIRTUAL | Product-specific | Generic docs describe a VIRTUAL threshold | DEX liquidity after curve | True curve-to-DEX model | Chain-specific Robinhood configuration was not found in official docs | Medium for generic mechanism; low for Robinhood-specific constants |
| pons | Single-sided concentrated-liquidity pool from launch | WETH | 1B placed through one locked v3 position | Default 4.2 WETH paired principal | Same Uniswap v3 pool | No migration; status is computed from the existing position | Locker holds principal; fees are collectable and split creator/protocol | High: first-party docs and verified deployed factory/locker source |
| LaunchHood | Entire supply placed single-sided in real pool | WETH | 1B in pool | 4 ETH net buys | Same Uniswap v3 pool | No migration; milestone affects badges/discovery | Pool position locked forever; 1% fee split 50/50 | High: first-party docs and verified deployed source |
| NOXA Fun | Single-sided real pool from block one | Chain-specific native/wrapped asset | Product-specific | Robinhood example shows 4.2 ETH | Same Uniswap v3 pool | No migration; graduation is gamification | Docs state liquidity is permanently locked | High for product model; exact deployed factory was not audited in this pass |
| LootPad | Single-sided concentrated-liquidity “curve” in DEX | WETH | Product-specific | Liquidity/floor milestone | Same Uniswap v3 pool | No synthetic curve and no venue migration | Locked position; fees split creator, stakers, and house | Medium-high: first-party whitepaper; deployed source not audited in this pass |
| Circus Fair Open | Doppler multicurve price ladder | ETH | About 99% offered across v4 ranges | None | Uniswap v4 from launch | No conventional graduation | Locked v4 pool; early output tax decays over two minutes | High: first-party guide |

Thresholds and fee splits are product configuration and can change. They are not safe constants for Robyn unless bound in our own immutable deployment and surfaced from chain state.

## Detailed findings

### hood.fun

The [hood.fun whitepaper](https://www.hood.fun/whitepaper) is one of the clearest Robinhood Chain descriptions of a conventional launchpad curve. It uses virtual token and ETH reserves with `x*y=k`, places 80% of supply on the curve, reserves 20% for graduation, and seeds its default 1B-token launch with 2.81 virtual ETH. The document targets approximately 6.5 real ETH collected and a terminal market capitalization around 26.9 ETH.

The curve charges 1%, split 80% to the creator and 20% to the protocol. When the final curve token is sold, trading closes and anyone can call a permissionless migration function. Migration places the net ETH and reserved tokens into the official Uniswap v3 1% pool. Its stated protections include checking the canonical factory/pool and handling a pre-existing pool rather than trusting an arbitrary migration recipient.

The resulting Uniswap v3 position is sent to an ownerless locker with no principal-withdraw function. The locker can collect fees: ETH-side fees are split creator/protocol, while token-side fees are burned. This is permanent liquidity, but not fee renunciation.

Important difference from Robyn: hood.fun does not describe migration as necessarily occurring inside the threshold-reaching buy. A permissionless follow-up call is safer than an admin-only step but still creates a between-phases state that Robyn's current atomic local implementation avoids.

### Circus

The [Circus product guide](https://circus.trade/how-it-works) exposes two distinct launch engines.

Classic Curve uses a fixed 1B supply with 800M sold on an ETH curve. It targets about 6.5 ETH, then states that graduation atomically creates a Uniswap v3 pool and locks the LP position forever in an immutable FeeLocker. The curve charges 1%; the creator receives 80% of that fee. After graduation the creator receives 60% of the 1% v3 trading fee, with the remainder allocated between Circus and compounded liquidity according to its current explanation. Transfers are locked during the curve phase.

Fair Open does not use this curve. It uses Doppler to create a locked Uniswap v4 pool at launch and arranges roughly 99% of supply across a multi-range price ladder. Its two-minute output tax starts at 100% and decays linearly to zero. It is an auction/anti-sniper design, not curve graduation.

Independent onchain check: the [Circus RH67 token page](https://circus.trade/coin/0x3b9b713a3bba6c3388371cfdb072cd70118bb727) marks the token graduated and links to Uniswap. Querying the canonical Robinhood Uniswap v3 factory returned pool [`0x0a5d1657027e555d47c3dD669E4B04AB22485616`](https://robinhoodchain.blockscout.com/address/0x0a5d1657027e555d47c3dD669E4B04AB22485616), with WETH/token ordering, 1% fee tier, and nonzero liquidity. This confirms that the migration claim is not only a UI narrative for that launch.

### Robinlaunch

[Robinlaunch's guide](https://robinlaunch.fun/how-it-works) and [developer documentation](https://robinlaunch.fun/docs) describe both a curve lane and an instant-pool lane.

The currently documented curve fixes supply at 1B, sells 800M, and reserves 200M for liquidity. Verified source for factory v11 at [`0x4FB5057634f3CAE0B400E753852ea12B5d6278e2`](https://robinhoodchain.blockscout.com/address/0x4FB5057634f3CAE0B400E753852ea12B5d6278e2?tab=contract) shows virtual initial reserves of 1 ETH and 1.12B tokens, a 2.5 ETH net threshold, a 1% fee, final-buy capping/refunds, and atomic graduation when either the reserve threshold or 200M-token inventory boundary is reached.

`_graduate()` wraps ETH, creates or initializes the canonical Uniswap v3 1% pool, and mints a full-range position. The LP NFT goes to the configured fee collector or, if absent, a dead address. The current collector at [`0xA510A8d9a9a767289B3B6e646eB09AaD956627a5`](https://robinhoodchain.blockscout.com/address/0xA510A8d9a9a767289B3B6e646eB09AaD956627a5?tab=contract) exposes fee collection but no NFT-transfer or principal-withdraw path in its verified source. The current fee split is 70% creator and 30% protocol.

Robinlaunch also offers Direct Pool launches. Those put the full supply into a single-sided Uniswap v3 position immediately and never enter a bonding phase. Its interface reported no graduated factory-v11 curve launch during this research, so the source path is verified but a live v11 graduation receipt was not available to inspect.

### vladlaunch

[vladlaunch documentation](https://docs.vladlaunch.com/) demonstrates that an ETH quote is not required. Its curve is a virtual-reserve constant product denominated in six-decimal USDG. It uses a 1B supply, 8,000 USDG virtual liquidity, an 8,000 USDG real threshold, and a 1% fee split 70% creator and 30% protocol.

The threshold-crossing buy seeds a TOKEN/USDG SushiSwap v3 1% pool in the same transaction using the remaining token inventory and collected USDG. The [contract reference](https://docs.vladlaunch.com/smartcontract) publishes VladBonding `0x2997f31E200608A5501757B641B07dDD83823cd2`, SushiGraduator `0x7482a30872eF0894CCdAbcB235d117189f547FA2`, Sushi v3 factory `0xE51960f...`, and position manager `0x51d0e...`. Live bytecode checks found contracts at the published full addresses.

This is the closest precedent for Robyn's stable-quote curve. It is not a basket-reward system. Its docs also disclose that five ProxyAdmin contracts are currently controlled by the deployer with a future multisig planned. Robyn should not copy that upgrade trust model for liquidity custody.

### Rooket

[Rooket's documentation](https://rooket.fun/docs) describes a fixed 1B supply, 800M curve allocation, 200M liquidity allocation, and the virtual-reserve spot-price expression `(VIRTUAL_ETH + ethReserve) / (VIRTUAL_TOKENS - tokensSold)`. At 4 real ETH, it deducts a 2% migration fee and says the rest plus 200M tokens goes to Uniswap v4.

The docs claim the resulting LP is permanently burned or locked, but v4 liquidity custody is not represented by an ordinary v2 LP token and needs exact PoolManager/position-manager verification. No live launches were shown and no authoritative deployment/source link was found in this pass. Rooket is useful product evidence, not a reusable or proven contract dependency yet.

### Robinfun

[Robinfun](https://robinfun.io/) claims an approximately 2.6 ETH curve threshold, migration to Uniswap v2, and permanent LP burn. It charges a flat 1% platform curve fee and permits creators to configure additional buy/sell transfer taxes up to 10%, with the creator receiving 90% of that fee stream.

The exact curve formula and deployed source were not independently verified. The token-tax model also differs sharply from Robyn: it changes ERC-20 transfer behavior and can impair router, aggregator, holder-accounting, and exchange compatibility. Robyn's fee belongs in the market/pool adapter and reward vault, not in arbitrary token transfers.

### Virtuals

Virtuals' [launch-mode documentation](https://whitepaper.virtuals.io/about-virtuals/tokenization-platform/modes) and [standard-launch description](https://whitepaper.virtuals.io/builders-hub/agent-launch-mechanisms/more-on-standard-launch) establish a genuine curve-to-DEX model: a prototype token trades against VIRTUAL until a threshold, after which DEX liquidity is created for the graduated asset.

Those pages describe generic deployments and examples on other chains. They do not establish the precise Robinhood Chain threshold, factory, pool version, fee tier, or locker. Third-party Robinhood launch pages are not enough to substitute for official configuration or verified deployed source. The correct conclusion is that Virtuals uses the same broad two-phase model, while its Robinhood-specific implementation remains unverified.

### pons

[pons documentation](https://docs.ponsfamily.com/) describes no internal bonding contract and no migration. Creation deploys the token and a locked, single-sided Uniswap v3 position in the same transaction. All trading occurs in that real WETH pool.

Verified source for active factory [`0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB`](https://robinhoodchain.blockscout.com/address/0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB?tab=contract) confirms the factory creates the v3 position. `graduationStatus()` derives progress from paired principal in the locked position rather than gross volume or direct token donations. The default milestone is 4.2 WETH. The active locker at [`0x736D76699C26D0d966744cAe304C000d471f7F35`](https://robinhoodchain.blockscout.com/address/0x736D76699C26D0d966744cAe304C000d471f7F35?tab=contract) allows fee collection while locking principal.

pons has no curve-to-pool discontinuity. Its “graduation” means the existing pool crossed an economic milestone.

### LaunchHood

[LaunchHood documentation](https://launchhood.com/docs) likewise puts the entire 1B supply single-sided into a Uniswap v3 1% pool at creation. The concentrated-liquidity position provides the rising price path from the first block. At 4 ETH net buys, the app marks the token graduated for badges, charts, and discovery, but nothing moves and the same pool continues trading.

Its published factory is [`0x62B33A039D289CBDa50EbeB72Fe4261449E61Bcf`](https://robinhoodchain.blockscout.com/address/0x62B33A039D289CBDa50EbeB72Fe4261449E61Bcf?tab=contract) and locker is [`0x99B79154Ff4Fc0e313549B809254B02722631ee0`](https://robinhoodchain.blockscout.com/address/0x99B79154Ff4Fc0e313549B809254B02722631ee0?tab=contract). The 1% pool fee is currently described as a 50/50 creator/protocol split.

### NOXA Fun, LootPad, and Robin Launchpad

[NOXA Fun's launchpad overview](https://docs.noxa.fi/launchpad/overview/) says tokens launch directly into single-sided permanently locked liquidity rather than migrating later. Its [Robinhood WISHBONE example](https://fun.noxa.fi/rh/token/0x77581054581b9c525e7dd7a0155de43867532d03) displays a 4.2 ETH target and a graduated state while still identifying Uniswap as the market.

[LootPad's whitepaper](https://lootpad.tech/whitepaper) explicitly treats the single-sided Uniswap v3 position as the curve. It adds “floor locking” inside the continuing pool rather than a second venue. [Robin Launchpad](https://launch.robinchirp.com/) also advertises Uniswap v3 from the first block, no bonding wait, and no graduation fee.

These products validate the pool-native alternative, but they are less similar to Robyn's currently implemented lifecycle.

## DEX and infrastructure findings

Robinhood's [ecosystem documentation](https://docs.robinhood.com/chain/?lang=en) lists Uniswap as the public DEX. Uniswap's [Robinhood Chain launch announcement](https://blog.uniswap.org/robinhood-chain-is-live) says v2, v3, v4, and UniswapX are live. That breadth explains why launchpads can choose v2 LP burn, v3 NFT lockers, or v4/Doppler systems, but those versions have different custody and fee mechanics.

The canonical mainnet addresses repeatedly used by the launchpads reviewed are:

| Contract | Robinhood Chain mainnet address |
|---|---|
| WETH | [`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`](https://robinhoodchain.blockscout.com/address/0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73) |
| Uniswap v3 factory | [`0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`](https://robinhoodchain.blockscout.com/address/0x1f7d7550B1b028f7571E69A784071F0205FD2EfA) |
| Uniswap v3 position manager | [`0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`](https://robinhoodchain.blockscout.com/address/0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3) |
| Uniswap v3 swap router | [`0xCaf681a66D020601342297493863E78C959E5cb2`](https://robinhoodchain.blockscout.com/address/0xCaf681a66D020601342297493863E78C959E5cb2) |

These are mainnet findings, not testnet configuration. Robinhood's [network guide](https://docs.robinhood.com/chain/connecting/) confirms chain IDs 4663 and 46630 but does not publish a canonical testnet Uniswap deployment table. On 2026-07-22, Robinhood testnet Blockscout reported that the four identical mainnet addresses above were not contracts on chain 46630. Explorer search finds multiple independently deployed contracts named like Uniswap components, but a verified name does not prove that a deployment is canonical, supported, correctly wired, or liquid.

Consequently Robyn must not put the mainnet Uniswap addresses into its testnet manifest. The testnet path needs either:

1. an official Uniswap/Robinhood testnet deployment with independently verified factory, wrapped quote, position manager, router, fee tiers, and code hashes;
2. a clearly labeled Robyn-owned test DEX deployment used only to rehearse the adapter; or
3. continued use of the local locked-pool rehearsal until an official testnet target exists.

## Is their bonding like ours?

### What matches

| Property | Robyn local implementation | Closest competitors |
|---|---|---|
| Fixed supply | 1B | Circus, Robinlaunch, Rooket, pons, LaunchHood |
| Curve/LP allocation | 800M/200M | Circus Classic, hood.fun default, Robinlaunch, Rooket |
| Curve family | Virtual-reserve constant product | hood.fun, Robinlaunch, Rooket, vladlaunch |
| Final-buy capping/refund | Implemented | Robinlaunch verified source |
| Automatic threshold transition | Same transaction | Circus claim, Robinlaunch source, vladlaunch docs |
| Irreversible liquidity | No-withdraw local pool | Most reviewed products claim or implement locked/burned liquidity |
| Fee continuity | 1% before and after transition | Several products retain creator/protocol fees across phases |

### What does not match

- Robyn uses mUSD locally; most Robinhood curves use ETH/WETH. vladlaunch is the closest stable-quote precedent with USDG.
- Robyn's post-graduation pool is an internal local constant-product contract. It is deliberately not represented as Uniswap.
- Robyn routes fees into a launch-specific weighted reward basket for holders. Competitors route fees primarily to creators, protocol treasuries, burns, stakers, or liquidity.
- Robyn allows ordinary token transfers during bonding. Circus says Classic transfers are locked before graduation, while Robinfun adds persistent transfer taxes.
- Robyn's threshold is 6,500 mUSD for controlled devnet. It is a test parameter, not economically comparable to 6.5 ETH, 2.5 ETH, 4 ETH, or 8,000 USDG without a starting/terminal FDV and liquidity simulation.
- Pool-native launchpads do not resemble Robyn's two-phase state machine even when their cards display a bonding or graduation rail.

## Recommended production design for Robyn

### 1. Keep the two-phase model

The current curve gives Robyn a simple deterministic launch state, a familiar 80/20 allocation, and a precise moment at which permanent liquidity is created. It also makes basket-fee routing explicit before a third-party DEX exists. A pool-native lane can be added later, but it should be described as “DEX from launch,” not as the same graduation mechanism.

### 2. Target canonical Uniswap v3 on mainnet

Uniswap v3 has the strongest evidence across the ecosystem: it is officially supported, used by multiple launchpads, and independently observable for graduated Circus launches. It also gives Robyn a position NFT whose principal can be immobilized while fees remain collectable for the reward basket.

Uniswap v2 LP burn is simpler but makes programmable fee harvesting for basket rewards impractical. Uniswap v4/Doppler can support more sophisticated launches, but hooks, PoolManager accounting, position custody, and audit scope are materially more complex. Sushi v3 with USDG is a credible precedent, but its Robinhood support and liquidity should be compared with canonical Uniswap before selection.

### 3. Use a no-withdrawal, fee-collecting locker

Robyn cannot simply burn or irretrievably send away a v3 position if post-graduation fees must fund rewards. The locker should:

- accept only the factory-bound position manager and pool;
- receive exactly one position from its bound market;
- have no principal withdrawal, NFT transfer, arbitrary approval, or rescue path for the launch pair;
- collect fees permissionlessly or through a bounded keeper;
- route collected quote-side value to the immutable basket vault;
- define what happens to launch-token-side fees: compound, burn, or swap under bounded slippage;
- expose cumulative fee and collection events so the indexer can prove reward provenance.

An “ownerless locker” is not enough if an approval, delegate, proxy admin, rescue function, or mutable fee recipient can still move the NFT or principal.

### 4. Make graduation atomic and fail closed

The threshold-reaching buy should either complete the purchase and DEX initialization together or revert completely. It should not leave user funds accepted while a keeper later chooses a pool, router, recipient, tick range, or price. Required protections include:

- immutable/canonical factory, WETH or USDG, position manager, fee tier, locker, and basket vault;
- pre-existing-pool and pool-squatting handling;
- token-order and `sqrtPriceX96` calculation with explicit decimals;
- a simulated terminal curve price that matches the initial DEX price within a bounded tolerance;
- exact accounting for reserve, 200M allocation, unsold curve inventory, migration fee, and dust;
- final-buy cap and excess refund;
- idempotent one-way phase state;
- reentrancy protection across wrapping, approvals, pool initialization, minting, and fee recording;
- explicit failure tests for missing DEX code, occupied pools, reverted mints, callbacks, fee-on-transfer tokens, and hostile quote tokens.

### 5. Choose the quote asset deliberately

WETH offers ecosystem familiarity and the deepest launchpad precedent. USDG gives users and reward accounting a stable unit and matches vladlaunch's demonstrated pattern. For Robyn, USDG may make basket conversion and displayed graduation funding easier to understand, but only if the chosen DEX has dependable USDG liquidity and routing into every supported reward asset.

The economic model must select virtual reserves from desired starting FDV, terminal curve price, collected quote, slippage, and post-migration liquidity. Copying a competitor's ETH constants into a USDG curve would not reproduce its economics.

### 6. Preserve truthful terminology in the UI

- `Bonding`: trades execute in the Robyn curve.
- `Graduating`: only if an actual onchain migration transaction is pending; avoid this state if migration is atomic.
- `Graduated`: trading has moved to the bound external pool and the locker receipt is indexed.
- `DEX from launch`: for any future pool-native lane.
- `Milestone reached`: for a status threshold that does not move liquidity.

Discovery progress must come from net reserves or locked-position principal, never gross volume.

## Required next work

1. Decide WETH versus USDG based on real mainnet routing/liquidity measurements for the intended reward assets.
2. Obtain or confirm an official chain-46630 DEX deployment. Do not treat arbitrary verified clones in testnet explorer search as canonical.
3. Implement a versioned `UniswapV3GraduationAdapter` and immutable `RewardFeePositionLocker` behind the existing factory-bound interface.
4. Build an economic simulation covering start/terminal FDV, final-buy behavior, migration price continuity, full-range versus concentrated range, fee generation, basket conversion, and adverse sells.
5. Add fork tests against exact mainnet bytecode and isolated testnet tests against the selected deployment.
6. Independently review the adapter and locker before any real-value use.
7. Update the token page to link the canonical pool, position NFT, locker, migrated amounts, price-continuity check, and cumulative reward fees.

## Research limitations

- Launchpad contracts and interfaces are upgradeable or redeployable; addresses, thresholds, fees, and split percentages can drift.
- A verified Blockscout source proves published source correspondence for that address, not security, license permission, canonical status, or absence of proxy/admin control.
- Some projects publish marketing pages without complete contract addresses or exact formulas. Those entries are marked lower confidence and must not drive implementation constants.
- Explorer searches for contract names are not proof of official testnet infrastructure.
- No external contract was selected for direct code reuse. Reuse requires license verification, exact commit/deployment provenance, dependency pinning, and independent review.

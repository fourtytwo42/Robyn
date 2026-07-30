# Reusable contracts and infrastructure

Research date: 2026-07-20

## Executive conclusion

We do not need to build the whole launchpad stack from scratch.

The closest reusable code is [Alloy](https://github.com/AlloyRH/AlloyFund), an MIT-licensed Robinhood Chain launchpad whose token contract already uses transfer-aware, magnified reward-per-share accounting so trading fees can buy a Robinhood Stock Token and holders can claim it without iterating over all holders. Alloy is extremely close to the requested product, but it supports one reward stock per launch, uses an MEV-exposed `amountOutMinimum = 0` swap, allows arbitrary reward-token addresses at contract level, has mutable global fee splits, and has no publicly reviewable audit report. Its code is a starting point, not a production dependency.

The recommended architecture is therefore a selective fork and integration:

1. Reuse Alloy's MIT-licensed transfer-aware dividend accounting as the mathematical starting point.
2. Extend it to a maximum of three configured reward assets and immutable basis-point weights.
3. Use OpenZeppelin Contracts for token, access, transfer, clone, reentrancy, pause, math, Merkle and timelock primitives.
4. Use Robinhood's canonical RHJ asset API and Chainlink feed directory instead of maintaining token or oracle addresses by hand.
5. Use 0x Swap API v2 for executable Stock Token quotes, with a tightly constrained contract-wallet executor and Chainlink deviation guards.
6. Either:
   - launch natively using the existing Robinhood Uniswap deployments and adapted Alloy mechanics, or
   - use Bags for launch/liquidity and accept off-chain holder accounting with Merkle claims.
7. Use the canonical Safe contracts already listed for chain ID `4663` for multisig administration, plus an OpenZeppelin timelock for non-emergency changes.

This reduces the custom Solidity surface to the parts that are genuinely unique to Robyn: multi-asset reward accounting, immutable weighted basket configuration, guarded fee conversion, and the launch integration glue.

Live Blockscout address checks on 2026-07-20 confirmed verified source for the Bags implementation behind its proxy, the pons factory and the old Alloy launchpad. IndexPad is only partially verified. Alloy's current website launchpad is a different, unverified contract. This confirms provenance only where stated; it does not establish safety or audit quality.

## What “reuse” means

These are materially different actions and must not be treated as interchangeable:

| Reuse type | What we do | License or dependency consequence |
|---|---|---|
| Call a deployed contract | Call an existing factory, fee-share, router, pool manager or oracle through its ABI | We depend on that deployment, its admins, upgrades, terms and availability; we are not copying its implementation |
| Import a library | Compile maintained source such as OpenZeppelin into our contracts | Follow its source license, pin an exact release and audit our composition |
| Fork source | Copy and modify a protocol such as Alloy | Preserve the license and notices, document the exact source commit, then audit the modified system |
| Consume an API | Request a quote, registry response or indexed data | Subject to authentication, rate limits, commercial terms, uptime and response changes |
| Use as a design reference | Learn from a contract whose source or license is not safely reusable | Do not copy it; implement independently and retain evidence of provenance |

An ABI being public does not establish permission to copy a contract's source. Conversely, interacting with an already-deployed permissionless contract is not the same as forking its code.

## Best reusable discovery: Alloy

### What it already implements

[Alloy's repository](https://github.com/AlloyRH/AlloyFund) describes “dividend memecoins” on Robinhood Chain. Each launch binds a fixed-supply community token to one tokenized stock. A permissionless `sweep` collects the launch token's Uniswap v3 LP fees, converts them into USDG, buys the selected Stock Token and calls the token's `distribute` function. Holders accrue that Stock Token and claim it from the token contract.

Its deployed mainnet addresses file identifies:

| Component | Address |
|---|---|
| `AlloyLaunchpad` | `0x927750E6EebAD299EFDb88f37F830BAD27b0657e` |
| `AlloyKeeper` | Repository value `0xA3f7d1fC4Bc08d996C2cD77c1F32cc5F8aE9c4b` is malformed: only 39 hexadecimal characters |
| `AlloyIndex` | Repository value `0x0E97c9Ba434Ca51a14b3a843Ae6e1b8D26a8A5d8` has no deployed bytecode |
| Recorded deploy block | `1,847,293` |

The repository is MIT-licensed. The reviewed head was commit `ffbc72de1aa3ea4b354916c06e178250dfb74d27` on 2026-07-20.

Fresh live reads found 15 launches, but the old deployed factory currently reports `dripBps=0`, `creatorBps=10000`, and `alloyBps=0`. It therefore does not currently implement the repository's advertised 70/20/10 holder/creator/protocol allocation. The current Alloy website publishes another launchpad address whose source was not verified in Blockscout.

### The reusable accounting primitive

`AlloyMeme.sol` uses a `2^128` magnification factor and three pieces of state:

- `magPerShare`: cumulative reward per eligible token unit;
- `corrections[account]`: offsets historical rewards when balances move;
- `withdrawn[account]`: rewards already claimed.

On every token transfer, the sender receives a positive correction and the receiver receives a negative correction. That preserves rewards earned before the transfer while preventing the receiver from receiving rewards distributed before they owned the tokens. Distribution is constant time and claiming is pull-based. The AMM pool, launchpad and burn address are excluded from eligible supply so the pool does not absorb holder rewards.

This is much better suited to a native Robyn token than an off-chain snapshot or a push-to-every-holder loop.

### What can be reused

| Alloy component | Reuse decision | Required change |
|---|---|---|
| Magnified per-share transfer corrections | Fork and harden | Change scalar state into fixed-size per-reward-asset state; add overflow/property tests |
| Pull-based `claim()` | Fork and harden | Add `claim(asset)` and `claimAll()` with reentrancy protection and balance-delta conservation checks |
| Eligible-supply exclusions | Reuse concept and code structure | Make the exclusion set complete at initialization and immutable thereafter |
| Single-sided Uniswap v3 launch | Reuse as a fallback native-launch design | Revalidate tick math, pool addresses, LP fee custody and price range on Robinhood mainnet |
| Permissionless `sweep()` | Reuse the public-trigger concept | Replace unguarded swaps with validated 0x or known-pool execution and minimum output |
| Shared launchpad-held LP NFTs | Reuse only after review | Prefer isolated per-launch fee receivers or prove a shared holder cannot move principal |
| Arbitrary reward address | Do not reuse | Require canonical RHJ registry membership or a governance-approved crypto allowlist |
| Mutable global fee split | Do not reuse | Snapshot immutable per-launch weights and fee policy |
| `amountOutMinimum = 0` | Do not reuse | Enforce quote expiry, minimum output, oracle deviation and exact approvals |

### Why we should not deploy Alloy unchanged

Alloy currently supports one reward asset, not a weighted basket. Its README explicitly identifies `amountOutMinimum = 0`, which makes each sweep sandwichable. Its contract accepts an arbitrary reward ERC-20 even though the UI checks Robinhood addresses. Its launchpad owner may change the global fee split. Its public `SECURITY.md` says it was audited and that the report is “available on request,” while the public README and code do not provide the report. That claim cannot be independently verified from the repository.

A clean-checkout reproduction also failed. `npm ci` cannot run because there is no lockfile. A fresh install selected TypeScript 7 and broke Hardhat/ts-node; after temporarily pinning TypeScript 5.7.3, 21 Solidity files compiled but the suite ended with 0 passing and 4 failing tests: three stale constructor calls and a missing `DistributionMathHarness` artifact. This is fixable source, not a deployable dependency.

## Exact-product competitor and reference: IndexPad

[IndexPad](https://docs.indexpad.io/) is important because its landing documentation initially describes almost the exact requested idea: a permissionless Robinhood Chain launchpad where fees are converted into tokenized stocks. Its newer architecture is different, however. Current technical pages say it removed dividend accounting and now routes each swap's fee into a per-index treasury. Holders burn the index token to redeem a pro-rata share of USDG and basket stocks.

### What is live

IndexPad publishes both testnet and mainnet deployments. Its mainnet page lists:

| Component | Address |
|---|---|
| `FeeRegistry` | `0xdfAEA4D0B6f00DD06907b374847Ea3653684F4Bc` |
| `IndexFactory` | `0x2F7bE872eeBfE6D9D010F9757028f389ba2aC2cA` |
| `IndexFeeHook` | `0x8B123d3D25fB9c9ebF7aD837BC6758C7304600Cc` |
| `ReserveSwapRouter` | `0xCCDD49502bb159F4F6B46142440b88e468318e8c` |
| `V4SwapRouter` | `0x646A33eb2CEF164F6DffC8fEDCC36Db29B2e2975` |
| `TreasuryDeployer` | `0x230D84C7995A3878ff14629F3E2601110686CEF0` |
| Uniswap v4 `PoolManager` | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |

Blockscout returns verified source for the factory with an MIT SPDX identifier, although it reports partial rather than certified verification. The factory uses OpenZeppelin clones, single-sided Uniswap v4 positions and a shared hook. The project's linked GitHub repository returned `404` during this review, so there is no currently accessible repository, tagged release, complete dependency lock or public CI history to consume.

### Useful ideas

- EIP-1167 token clones with CREATE2 address mining so USDG has deterministic currency ordering.
- A shared v4 fee hook instead of fee-on-transfer behavior.
- Single-sided stepped liquidity seeded from a deterministic launch floor.
- Per-launch treasury isolation.
- Per-asset `try/catch` so an unavailable reward route does not stop the launch token's trade.
- Oracle-free pro-rata redemption from raw balances.
- A registry that can disable new buys without blocking sells or redemptions.

### Why it is not our production base today

- It is a redeemable backing product, not a fee-reward claim product.
- Its current basket leg appears evenly divided; the requested arbitrary weights are not in the published `IndexConfig`.
- Its own security page says it has no professional audit.
- The same page says mainnet routing still needs to be adapted because Stock Token liquidity is RFQ/0x rather than guaranteed hookless AMM pools.
- Its mainnet page says Chainlink feeds are not yet registered for the listed stocks.
- Its documentation contains stale or conflicting claims about dividends, testnet-only status and mainnet deployment.
- The source repository linked from its documentation is not publicly accessible now.

Use IndexPad as a design and competitive reference. Do not make Robyn depend on its current deployment. Obtain a complete source archive and provenance from its team before considering a fork.

## Existing launch protocols

### Bags: best adapter if we accept Merkle holder accounting

[Bags' Robinhood contracts reference](https://docs.bags.fm/robinhood/contracts) provides a complete on-chain integration surface.

| Contract | Mainnet address |
|---|---|
| `BagsFactory` proxy | `0xe8Cc4431adF8b5A847C113EF0c6af9043219Cb37` |
| `BagsLens` | `0xC82Db941dAf90B754aecb5F7D14c683dc608d595` |
| `BagsV4Hook` | `0x2380aBf72C17aABAb76480244759AC7E2932EEcC` |
| `BagsVault` proxy | `0x4861446aa7fFd9e67a83cBbAcb1A4B70540B83Aa` |
| Modified Universal Router | `0x8876789976dEcBfCbBbe364623C63652db8C0904` |
| v4 `PoolManager` | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| `Permit2` | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |

Reusable capabilities:

- `create` and `createAndBuy` deploy the fixed-supply token, bonding curve and per-token fee-share contract.
- One to 100 fee claimers can split the creator half using basis points totaling 10,000.
- Creator fees accrue as WETH in `BagsFeeShare` through both curve and post-graduation pool trading.
- A smart contract is not prohibited by the documented claimer validation rules.
- `claim(false)` pays WETH, which is exactly what a basket router should receive.
- The public factory registry, lens, events, ABIs, quotes and trading routes can be reused for the interface and indexer.
- A partner address can earn the factory's snapshotted share of the protocol half without reducing creator claimers.

Critical integration detail: the `BagsFeeShare` ABI includes `owner`, `setClaimers`, `transferOwnership` and `renounceOwnership`. A direct creator launch leaves a mutable claimer list. Robyn should either atomically set the basket contract as the sole claimer and renounce ownership, or transfer ownership to a defined timelock. A wrapper factory can do this atomically, but Bags will then record the wrapper as the protocol-level creator. `createAndBuy` also buys for `msg.sender`, so a wrapper must forward received launch tokens and any refund to the actual creator.

Bags has an important dependency risk. Its factory and vault are UUPS proxies, and all live per-token curve and fee-share contracts use shared upgradeable beacons. A single beacon upgrade can change all live fee-share behavior. Robyn must monitor `Upgraded` events, include an emergency harvest pause and never assume the current bytecode remains permanent.

The Bags ABI repository did not expose a recognized repository license during this review. Use its published ABIs to call deployments; do not copy implementation code without an explicit license or written permission. Obtain written commercial and compatibility confirmation before production.

Because a Bags launch token is a standard immutable token without Robyn's transfer hook, Bags cannot provide fully on-chain time-weighted holder rewards by itself. We would still need a Transfer-event indexer and per-epoch Merkle roots, or we would have to change the product so only staked/wrapped holders receive rewards.

### pons: useful fallback adapter and Uniswap v3 deployment source

[pons documentation](https://docs.ponsfamily.com/) publishes immutable factory and locker addresses, a fixed-supply launch flow, direct Uniswap v3 pools, locked liquidity, on-chain events and a configurable creator fee wallet.

| Component | Address |
|---|---|
| Active factory | `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` |
| Active locker | `0x736D76699C26D0d966744cAe304C000d471f7F35` |
| Uniswap v3 factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` |
| Position manager | `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` |
| Swap router | `0xCaf681a66D020601342297493863E78C959E5cb2` |
| Quoter V2 | `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` |

pons says the creator sets the fee wallet at creation and its locker exposes `feeRedirects(token)`. Current launches snapshot a 70% creator and 30% protocol LP-fee split. Its deployments are described as immutable, with new versions using new addresses.

This makes pons a credible contract-recipient spike and a useful source of Robinhood v3 deployment addresses. The missing public source license and the fact that LP fees accrue in both launch token and WETH make it less convenient than Bags. Confirm the claim and redirect call path with a contract recipient on a mainnet fork before relying on it.

## Native launch infrastructure we can reuse later

### Uniswap Liquidity Launcher

[Uniswap's Liquidity Launcher](https://github.com/Uniswap/liquidity-launcher) is an MIT-licensed, audited system for token creation, distribution, Continuous Clearing Auctions or liquidity bootstrapping pools, and migration into Uniswap v4 liquidity. Its repository lists reviews by OpenZeppelin, Spearbit and ABDK, plus bug-bounty coverage.

Reusable pieces include:

- token and distribution factory interfaces;
- full-range, advanced and governed liquidity-bootstrapping strategies;
- atomic `createToken` plus `distributeToken` orchestration;
- `TimelockedPositionRecipient`;
- `PositionFeesForwarder`;
- Uniswap v4 pool initialization and position-management code.

It does not publish a Robinhood-specific strategy factory deployment. We would need to deploy and test its strategy against Robinhood's v4 `PoolManager` and modified router environment. This is a strong native-v2 option, not the shortest initial route.

### Index and vault contracts

[Vimen](https://github.com/vimenprotocol/vimen) is MIT-licensed and provides non-upgradeable, in-kind mint/redeem basket contracts, a factory, immutable unit recipes, asset and maker registries, RFQ balance-delta checks, a fee splitter and extensive Foundry unit/fuzz/invariant/fork tests. Its contracts are explicitly unaudited and its product is a fully redeemable basket, not the requested fee-reward community token.

Good components to study or selectively port:

- `AssetRegistry`: additive registration, frozen feed wiring and disable-new-buys behavior;
- `MakerRegistry`: settlement-contract allowlisting;
- exact-approval, external-call and post-call balance-delta checks from `BasketToken2`;
- in-kind redemption math and failure rules if Robyn later offers a truly backed product;
- immutable fee-splitter patterns.

Do not import Vimen's basket token into the reward-stream MVP. ERC-4626 and in-kind basket vaults similarly fit a redeemable share product, not a nonredeemable community token whose trading fees fund separate rewards.

## Stock Token selection and execution

### Canonical asset discovery

Reuse the [live RHJ asset API](https://api.robinhood.com/rhj/assets) and the [official token-contract page](https://docs.robinhood.com/chain/contracts/). Do not maintain a hand-written production token list.

Recommended flow:

1. A backend synchronization job fetches the live registry and records symbol, name, status, chain ID and canonical address.
2. The launch transaction accepts only addresses already committed in a versioned on-chain allowlist root or registry.
3. The app refreshes status at launch and harvest time.
4. A token disabled after launch remains claimable and sellable, but its future buy weight accumulates as WETH or USDG until restored.

Robinhood's current docs say Stock Tokens are ERC-20s and implement ERC-8056. Corporate actions adjust `uiMultiplier()` rather than rebasing raw balances. Chainlink's stock price already incorporates that multiplier, so price math must not apply it twice.

### Direct Uniswap routes

Schema-14 supports only direct Uniswap v4 single-hop execution and native/WETH
wrapping. Use the verified PoolManager, on-chain Quoter, bounded input,
reference-tick/TWAP protection, and a hard minimum output.

Do not assume every Stock Token has a deep AMM pool. A required asset without a
qualifying direct v4 pool fails the Mainnet rehearsal. An optional asset remains
disabled until its direct v4 pool passes the deployment-block checks.

## Oracle and corporate-action safety

Reuse Chainlink's standard `AggregatorV3Interface`. Robinhood's [oracle guide](https://docs.robinhood.com/chain/oracles-and-price-feeds) points to Chainlink's live address directory with `network=robinhood` as the source of truth for feed proxies, decimals and heartbeats.

The reusable interface does not remove the need for a small custom guard. `OracleGuard` should:

- verify Robinhood's L2 sequencer uptime feed and grace period;
- require a positive answer;
- read feed decimals rather than assuming eight;
- reject `updatedAt == 0` and data older than the published heartbeat;
- reject excessive difference between the quote and Chainlink fair value;
- read the Stock Token's `oraclePaused()` flag and treat it as unavailable;
- never apply `uiMultiplier()` to a Chainlink stock price a second time;
- use `Math.mulDiv` for full-precision normalization.

Chainlink's feed addresses and heartbeats should be governance-updatable through a timelock because feeds can migrate. The basket asset addresses and weights remain immutable.

## Standard contract libraries

[OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) is MIT-licensed and should supply almost every generic primitive:

| Need | Reuse |
|---|---|
| ERC-20 token | `ERC20`, optionally `ERC20Permit` |
| Safe token calls | `SafeERC20` and `forceApprove` |
| Reentrancy protection | `ReentrancyGuard` or the chain-compatible transient variant |
| Exact percentage math | `Math.mulDiv` |
| Per-launch instances | `Clones` and deterministic clones |
| Roles | `AccessControl` or minimal `Ownable2Step` where one owner is sufficient |
| Delayed governance | `TimelockController` |
| Emergency launch/harvest pause | `Pausable` scoped so claims and recovery exits remain open |
| Epoch claims | `MerkleProof` |
| Signed keeper instructions | `EIP712`, `SignatureChecker` and `Nonces` |

Pin a released OpenZeppelin version and commit. Do not track `master`. Library reuse reduces code volume but is not a substitute for auditing the composed protocol.

### What OpenZeppelin does not solve

- `MerkleProof` verifies a root; it does not compute fair time-weighted holder entitlements.
- `ERC20Votes` provides checkpoints, not continuous multi-asset reward accounting.
- `ERC4626` represents redeemable shares of a single-asset vault; using it would change the product.
- `PaymentSplitter`-style fixed recipients cannot handle a changing, unbounded holder set.

## Administration and operational infrastructure

### Safe multisig

The canonical [Safe deployments repository](https://github.com/safe-global/safe-deployments) contains chain ID `4663` for Safe v1.4.1. Relevant canonical addresses are:

| Safe component | Address |
|---|---|
| Safe L2 singleton | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` |
| Safe proxy factory | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` |
| MultiSend | `0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526` |
| MultiSendCallOnly | `0x9641d764fc13c8B624c04430C7356C1C7C8102e2` |
| Compatibility fallback handler | `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` |

Use a Safe as the proposer/guardian, not a single EOA. Put non-emergency changes through `TimelockController`. Emergency authority should be limited to stopping new launches and new conversions; already-accrued holder claims should remain available.

### Multicall and read aggregation

Robinhood's protocol-contract page lists L2 Multicall at `0x2cAC2D899eCC914d704FeaAE33ac1bF36277DaD1`, and Bags publishes Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11`. Use batched reads for token pages and portfolios instead of a separate RPC call per field.

### RPC and indexing

Keep the existing cost policy:

- Browser wallets and light reads can use the public RPC, with per-user provider fallbacks.
- The public RPC is rate-limited and Robinhood says it is not for production-grade, high-throughput or latency-sensitive use.
- A small shared archive/WebSocket provider is still required for deterministic event ingestion, reorg handling, epoch calculation and keeper operation.
- Bags' lens, registry and API can accelerate discovery UX, but on-chain events remain the source of truth.
- Alchemy is Robinhood's recommended RPC, archive, data and gas-sponsorship provider. Allium is listed as an ecosystem analytics provider.

Do not attempt to run reward accounting solely in each user's browser. Different RPC truncation, reorg or availability behavior would produce inconsistent roots.

### Keeper

No official evidence found in this review established Chainlink Automation support on Robinhood Chain. Start with two independent, narrowly permissioned keeper keys operated by separate processes. Keep harvest callable by anyone only if all execution parameters are independently checked on-chain.

A keeper should be unable to choose assets, weights, recipients, arbitrary targets or unlimited amounts. Its job is only to obtain a quote for a contract-defined leg and submit it before expiry.

## Holder accounting choices

### Native launch: reuse Alloy's on-chain accumulator

This is the preferred end state. For at most three reward assets, every token transfer updates three correction values for sender and receiver. Harvesting calls `distribute(asset, received)`, and each holder claims independently.

Required invariants:

- `totalClaimed[asset] <= totalDistributed[asset] <= actual received asset balance + totalClaimed[asset]`;
- a transfer cannot change the sum of sender and receiver accrued entitlement except for rounding dust;
- no account earns a distribution made before it became eligible;
- excluded balances never enter the denominator;
- supply held by the pool, router, reward contract, zero address and burn address is excluded;
- adding an asset after launch is impossible;
- loops are bounded by `MAX_ASSETS`;
- a malicious or frozen reward token cannot block claims for other assets.

Use Alloy's implementation as a starting point, but rewrite around fixed-size asset slots, `SafeERC20`, `ReentrancyGuard`, explicit custom errors and property tests.

### Bags or pons adapter: Merkle epochs remain custom

An existing launch token cannot be retrofitted with a transfer hook. The reusable pieces are OpenZeppelin `MerkleProof`, event logs and standard claim bitmaps. The non-reusable work is reconstructing ownership duration, handling excluded addresses, applying epoch boundaries and proving the root was computed correctly.

Recommended adapter design:

- Index every `Transfer` from token creation.
- Integrate balance over time within each epoch rather than using one snapshot block.
- Publish `(epoch, asset, root, total)` after a challenge delay.
- Store immutable evidence files containing start/end blocks, all transfers, exclusions and deterministic calculation code.
- Allow any account to recompute and compare the root.
- Use bitmap or cumulative claims to prevent duplicate withdrawal.

This path has less launch-contract work but adds an operational trust and data-availability surface. A single-block snapshot is not acceptable because it lets a temporary buyer capture rewards earned by earlier holders.

### Staking wrapper: reusable but changes the product

An ERC-4626-style wrapper around a Bags or pons token could give the wrapper transfer-aware reward accounting. Only deposited tokens would earn rewards. This is much easier than Merkle accounting but violates “all token holders receive the fees.” Keep it only as an explicit alternative product.

## Recommended minimized contract set

### Native Robyn MVP

| Contract | Source strategy | Purpose |
|---|---|---|
| `RobynFactory` | Adapt Alloy factory or Uniswap Liquidity Launcher | Deploy token/reward controller and create liquidity |
| `RobynToken` | Fork Alloy accounting plus OpenZeppelin ERC-20 | Fixed supply and bounded multi-asset transfer-aware accrual |
| `BasketController` | Custom, using OpenZeppelin and 0x example boundary | Immutable weights, fee custody, guarded conversion and distribution |
| `AssetRegistry` | Adapt Vimen pattern; sync from RHJ API | Canonical assets, category, feed, heartbeat and enabled state |
| `OracleGuard` | Custom consumer of Chainlink interfaces | Sequencer, staleness, pause and quote-deviation checks |
| `TimelockController` | OpenZeppelin unchanged | Delayed governance |
| Safe | Existing canonical deployment | Multisig proposer and emergency guardian |

`BasketController` can also hold reward balances, so a separate `RewardVault` is not required for the first version. Splitting it later may improve isolation, but it is not necessary to prove the product.

### Bags adapter MVP

| Contract | Source strategy | Purpose |
|---|---|---|
| `BagsLaunchAdapter` | Thin custom wrapper over public ABI | Clone controller, launch through Bags, freeze fee claimer ownership, forward initial buy/refund |
| `BasketController` | Same guarded converter as native | Claim Bags WETH, buy configured assets and fund epochs |
| `EpochDistributor` | Custom plus OpenZeppelin `MerkleProof` | Store roots and process pull claims |
| `AssetRegistry` and `OracleGuard` | Same as native | Asset and execution safety |

We do not build a bonding curve, ERC-20 factory, Uniswap migration, v4 hook, trading router, LP locker or market-state lens on this path. Bags supplies them.

## Build versus reuse matrix

| Capability | Reuse | Custom work still required | Recommendation |
|---|---|---|---|
| ERC-20 and security utilities | OpenZeppelin | Composition and invariants | Reuse |
| Single-asset holder reward accounting | Alloy MIT source | Audit and hardening | Fork |
| Multi-asset weighted rewards | None found production-ready | Fixed slots, transfer corrections, claims | Build |
| Token launch and liquidity | Bags, pons, Alloy, Uniswap Liquidity Launcher | Adapter or Robinhood deployment | Bags for fastest spike; native later |
| LP locking | Bags/pons or position-recipient contracts | Monitoring and fee routing | Reuse |
| Canonical Stock Token list | RHJ API | Cached/on-chain policy | Reuse API |
| Stock price feeds | Chainlink | Guard policy | Reuse feeds, build guard |
| Stock liquidity routing | 0x Swap API v2 | Constrained executor | Reuse API |
| Crypto liquidity routing | Uniswap routers/PoolManager | Pool allowlist and min-out | Reuse deployment |
| Holder discovery in adapter mode | ERC-20 events | Time-weighted epoch calculation | Build indexer |
| Merkle verification | OpenZeppelin | Root computation/challenge policy | Reuse library |
| Multisig | Safe v1.4.1 deployment | Owner setup and operating policy | Reuse deployment |
| Timelock | OpenZeppelin | Role setup | Reuse |
| Frontend RPC | Public RPC and wallet provider | Fallbacks | Reuse best-effort |
| Reliable indexer/keeper RPC | Alchemy or another provider | Minimal paid endpoint | Buy minimal shared service |
| Truly backed basket | Vimen/IndexPad patterns, ERC-4626 concept | Different product and audit | Defer |

## Recommended implementation order

### Phase 0: provenance and compatibility spikes

1. Check out Alloy at a pinned commit; make its compile and tests reproducible locally.
2. Request Alloy's claimed audit report and verify scope, commit and auditor.
3. Fork Robinhood mainnet at a pinned block and verify a contract can hold, transfer and claim each initial Stock Token.
4. Execute bounded direct-v4 WETH/native round trips for NVDA and SPY on the pinned fork.
5. Verify Chainlink feed proxy, heartbeat, sequencer feed and `oraclePaused()` behavior for the initial assets.
6. Run the Bags smart-contract claimer spike, including `claim(false)`, ownership transfer/renunciation, beacon upgrade monitoring and wrapper `createAndBuy` forwarding.

### Phase 1: accounting proof

Build `RobynToken` from the Alloy accumulator with three mock reward assets. Use Foundry fuzz and invariant tests for transfers, buys, sells, burns, exclusions, dust, zero eligible supply, multi-asset distributions and arbitrary claim order.

### Phase 2: guarded execution proof

Build `BasketController` with:

- immutable token addresses and basis-point weights;
- per-leg accrued sell budgets;
- no arbitrary target or execution-calldata entrypoint;
- direct v4 balance-delta and minimum-output checks;
- Chainlink and sequencer guards;
- asset-specific failure isolation;
- event-complete accounting.

### Phase 3: choose launch route

- If the priority is fastest branded launch: Bags adapter plus Merkle epochs.
- If the priority is trust-minimized “every holder accrues on-chain”: native token and launch path using adapted Alloy or Uniswap Liquidity Launcher.

The second route better matches the product and becomes simpler operationally once built. The first route gets a real market and fee stream faster.

## Code and dependency due-diligence checklist

Before importing or forking anything:

- Record repository, exact commit, tag, source license and copyright notice.
- Verify every deployed address against official docs and Blockscout bytecode.
- Confirm proxy implementation and admin/beacon addresses.
- Archive ABI and source hashes used by the build.
- Identify whether an audit covers the exact commit and chain configuration.
- Run a clean build and all tests without unpublished local dependencies.
- Review dependency licenses file by file when a repository uses mixed licensing, especially Uniswap v4 core.
- Add an SBOM and third-party notices file.
- Monitor upstream security advisories and upgrade events.
- Obtain written API and commercial terms for 0x and any launchpad adapter.

## What not to reinvent

Do not write a new ERC-20 base, clone library, safe-transfer wrapper, reentrancy guard, role framework, timelock, Merkle proof library, AMM, quote optimizer, oracle network, multisig or general-purpose bridge.

Do not copy a launchpad's curve or hook merely because its bytecode is verified. Prefer calling the existing deployment or using explicitly licensed, audited source.

Do not build a custom Stock Token registry from ticker symbols. Contract address and current status are the security boundary.

## What we genuinely must build

Even after aggressive reuse, these elements remain Robyn-specific:

- immutable per-launch weighted basket configuration;
- bounded multi-reward transfer-aware accounting, or deterministic time-weighted Merkle epochs for adapter tokens;
- safe conversion of fee assets into each configured Stock Token or crypto asset;
- corporate-action, sequencer, feed-staleness and quote-deviation policy;
- per-asset failure accounting and reserve behavior;
- complete event model and public root/accounting verifier;
- branded launch, basket, reward and portfolio interface;
- product-specific risk disclosures and upstream dependency monitoring.

## Final recommendation

Use Alloy as the source-code accelerator, not as an unchanged deployed dependency. Its MIT-licensed reward accounting proves that the core “fees buy a Stock Token and holders claim it” mechanism already exists on Robinhood Chain. Extend and audit that mechanism for at most three immutable reward assets.

In parallel, complete the Bags contract-recipient spike. If marketing speed matters more than fully on-chain accrual, Bags can supply the entire launch and trading lifecycle while Robyn supplies fee conversion and Merkle rewards. If the product promise is that every holder automatically accrues based on time held, native transfer-aware accounting is the better architecture.

For Stock Token purchases, use 0x rather than building routing or market-maker infrastructure. For generic contract safety, use OpenZeppelin. For canonical assets and prices, use RHJ and Chainlink. For administration, use Safe plus a timelock. For a later native launch engine, evaluate Uniswap Liquidity Launcher before maintaining a home-grown curve.

The resulting product is not “all custom.” It is a small, auditable layer that composes established launch, liquidity, oracle, quote, registry, library and multisig infrastructure around the one feature that is actually unique: creator-selected weighted asset rewards for holders.

## Primary sources

- [Robinhood Chain overview and ecosystem](https://docs.robinhood.com/chain/)
- [Robinhood Chain connection and RPC details](https://docs.robinhood.com/chain/connecting/)
- [Robinhood protocol contracts](https://docs.robinhood.com/chain/protocol-contracts/)
- [Robinhood token contracts and canonical registry](https://docs.robinhood.com/chain/contracts/)
- [Robinhood Stock Token building guide](https://docs.robinhood.com/chain/building-with-stock-tokens/)
- [Robinhood oracle and price-feed guide](https://docs.robinhood.com/chain/oracles-and-price-feeds/)
- [RHJ live asset API](https://api.robinhood.com/rhj/assets)
- [Bags Robinhood overview](https://docs.bags.fm/robinhood/overview)
- [Bags Robinhood contract reference](https://docs.bags.fm/robinhood/contracts)
- [Bags launch guide](https://docs.bags.fm/robinhood/launch-token)
- [Bags fee-claim guide](https://docs.bags.fm/robinhood/claim-fees)
- [Bags public ABI repository](https://github.com/bagsfm/bags-idl)
- [pons documentation](https://docs.ponsfamily.com/)
- [Alloy source repository](https://github.com/AlloyRH/AlloyFund)
- [IndexPad documentation](https://docs.indexpad.io/)
- [IndexPad architecture](https://docs.indexpad.io/contracts/overview)
- [IndexPad deployed addresses](https://docs.indexpad.io/reference/addresses)
- [IndexPad security notes](https://docs.indexpad.io/security)
- [Vimen source repository](https://github.com/vimenprotocol/vimen)
- [Uniswap Liquidity Launcher](https://github.com/Uniswap/liquidity-launcher)
- [Uniswap Liquidity Launcher technical reference](https://github.com/Uniswap/liquidity-launcher/blob/main/docs/TechnicalReference.md)
- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts)
- [0x Robinhood Chain announcement](https://0x.org/post/robinhood-chain)
- [0x supported chains](https://docs.0x.org/docs/introduction/supported-chains)
- [0x Swap API v2 guide](https://docs.0x.org/docs/0x-swap-api/guides/swap-tokens-with-0x-swap-api)
- [0x smart-contract integration example](https://github.com/0xProject/0x-examples/tree/main/swap-v2-with-foundry)
- [Safe canonical deployments](https://github.com/safe-global/safe-deployments)

This is technical research, not an audit or legal opinion. Addresses, APIs, contract implementations, licenses and upstream terms must be rechecked immediately before implementation and deployment.

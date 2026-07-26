# Protocol core

Status: core and testnet-mock package implemented and security-gated; controlled devnet deployed

Last verified: 2026-07-21

Production graduation decision updated: 2026-07-22

## Scope

The current native protocol checkpoint proves the core fee-to-holder-reward accounting path:

1. Anyone creates a fixed-supply community token with one to three immutable reward assets and weights totaling 10,000 basis points.
2. Its isolated vault measures the base asset actually received and allocates that balance across basket legs.
3. Anyone may execute a leg through the vault's immutable conversion router when the threshold or maximum-delay rule permits.
4. The vault fixes the input, output, receiver and router, requires a live deadline and nonzero minimum output, uses exact temporary approvals, and measures actual balance deltas.
5. The launch token measures the second transfer into its reward controller and distributes only what it received.
6. Transfer corrections preserve already earned rewards for sellers and prevent buyers from receiving pre-purchase distributions.
7. Holders pull one reward or all available rewards. No creator, factory, treasury or operator reward sweep exists.
8. The launch creator seals a one-time inventory/pool exclusion set before the first distribution. Excluded balances never dilute eligible holder rewards, and no later mutation is possible.

This is the native reference path for the controlled devnet and Robinhood testnet mock package. The browser-operated genesis market proves the disclosed buy/sell, fee conversion and claim journey. A bounded keeper and reorg-aware indexer are implemented; a production market, upstream launchpad adapter, canonical Stock Token registry/oracle guards and production quote provider remain external integration work.

## Production graduation target

The production native lifecycle is now fixed to automatic Uniswap v3 graduation:

1. The threshold-reaching buy completes the capped curve purchase and refund.
2. In that same transaction, the pre-bound adapter validates or initializes the canonical token/quote Uniswap v3 pool at the approved terminal price.
3. Graduation liquidity is minted directly as a position NFT to an immutable no-withdrawal locker.
4. The locker retains principal permanently but permits bounded fee collection into the launch's existing basket vault.
5. The Robyn token page keeps the same Buy/Sell controls and switches their quote/execution path from the curve to the bound Uniswap pool based on canonical onchain phase state.
6. The indexer consumes both Robyn-submitted and direct pool swaps so charts, volume and activity remain truthful.

The deployed `DevnetLockedLiquidityPool` already proves the lifecycle and continuous-interface behavior on chain 31337, but it is not Uniswap. Robinhood testnet/mainnet manifests must fail closed until the exact canonical Uniswap factory, position manager, router/quoter, quote asset, fee tier and code hashes are verified and the adapter/locker implementation passes independent review.

### Robinhood mainnet curve policy

The accepted chain-4663 mainnet policy is recorded in
`config/protocol/robinhood-mainnet-curve.json`. It does not change the small
chain-46630 testnet curve and does not authorize a mainnet deployment.

- Sell 800 million of the fixed one-billion-token supply on the curve.
- Reserve 200 million tokens for permanently locked graduation liquidity.
- Require exactly 6 ETH of net curve collateral to exhaust the inventory.
- With the immutable 1% bonding fee, this requires at least
  6.060606060606060607 ETH of gross buy demand before offsetting sells.
- Seed graduation liquidity with the collected 6 ETH and the reserved tokens.
- Cap an individual bonding buy at 0.5 ETH.
- Open at a terminal fully diluted value of 27.5 ETH under the selected virtual
  reserves. The UI may show a live USD estimate, but USD does not control the
  onchain trigger.
- Keep the 1% graduated-pool LP fee and additional 1% Sherwood protocol hook
  fee defined by schema v9.
- Make these terms immutable for launches created by the factory. A later
  economic change requires governance enrollment of a new reviewed factory;
  it cannot rewrite existing launches.

`pnpm validate:mainnet-curve` recomputes the constant-product exhaustion point,
gross demand, terminal price, terminal FDV, allocations, fee policy, and
single-buy cap from the committed values. Mainnet deployment tooling must
consume this validated policy rather than duplicating literal parameters.

## Contracts

| Contract | Responsibility |
|---|---|
| RobynLaunchFactory | Permissionless deployment, public launch registry, chain/version discovery and immutable shared policy |
| FeeBasketVault | Per-launch/per-leg fee isolation, measured allocation, constrained permissionless conversion and reward deposit |
| RobynLaunchToken | Fixed ERC-20 supply, transfer-aware multi-asset accumulators and pull claims |
| FeeBasketAccounting test fixture | Earlier conservation primitive retained under packages/contracts/test/fixtures as a regression reference; it is not production source |

The factory deploys the vault first, passes that address as the token's immutable controller, binds the token to the vault once, and exposes both addresses. Basket assets and weights have no mutation path. Distribution remains disabled until the creator seals the immutable exclusion set through the factory.

## Controlled-devnet fixtures

Contracts under packages/contracts/src/devnet are explicit local-network substitutes:

- DevnetMockERC20 provides operator-minted base and reward assets.
- DevnetConversionRouter provides owner-configured fixed rates and route-failure controls.
- DevnetFixedPriceMarket provides deterministic one-percent-fee buys/sells and sends every fee to the launch vault.
- DevnetMarketFactory permissionlessly deploys one fixed-policy market for each launch, restricted to that launch's recorded creator.

The market must be excluded before sealing so inventory does not earn rewards. These contracts expose the DEVNET_ONLY marker and are prohibited from Robinhood testnet or real-value manifests.

## Dependency provenance

- Solidity: 0.8.30, exact in every source file and Foundry configuration.
- OpenZeppelin Contracts: exact 5.4.0 in the root pnpm lockfile.
- Imported primitives: ERC20, IERC20, SafeERC20, ReentrancyGuard, and SafeCast.
- License: OpenZeppelin Contracts is MIT licensed; Robyn contracts are currently SPDX MIT.
- Resolution: Foundry maps the exact pnpm-installed package from the repository lockfile. Clean validation starts with pnpm install --frozen-lockfile.

The selected version is intentionally pinned instead of floating to the current registry version. Dependency upgrades require a dedicated review and complete contract-suite rerun.

## Enforced invariants and guards

- One to three vault basket assets, all unique and nonzero, with exactly 10,000 total basis points.
- Up to five token reward slots are supported for gas/reference testing; factory launches expose at most three.
- Weighted pending balances plus consumed base equal all measured fees received.
- Failed, expired, below-minimum or insufficient-output conversions revert atomically and retain the leg's principal.
- One failed route cannot prevent a different leg from converting.
- Router, input, output and receiver cannot be chosen by a keeper or public caller.
- Input spend and output/deposit amounts use independent balance-delta measurements.
- Allowances are exact and cleared after successful external calls.
- Post-distribution buyers receive none of the earlier reward; sellers retain it.
- Reward distribution cannot start before exclusions are sealed.
- Excluded market/pool balances are removed from eligible supply and can never claim.
- Total claims cannot exceed measured rewards received. Integer division may leave bounded, unswept dust in the token.
- Claims update state before safe token transfer and are reentrancy guarded.

## Verification

From the VM repository:

~~~bash
pnpm install --frozen-lockfile
forge fmt --root packages/contracts --check
forge test --root packages/contracts -vv --gas-report
forge build --root packages/contracts --sizes
~~~

The 2026-07-21 checkpoint passed 28 unit/fuzz/adversarial tests plus four stateful handler invariants. The invariant campaign ran 128 runs at depth 64 (8,192 calls per invariant run-set) with zero handler reverts. Tests cover fee-on-transfer base and reward tokens, duplicate assets, invalid weights, failed route isolation, stale/zero-minimum rejection, unauthorized deposits/rebinding, exclusion sealing, excluded inventory, creator-authorized one-market deployment, devnet buy/sell fee generation, the one-time base faucet, one/three/five reward slots, transfer ordering, multi-asset claims and balance conservation.

Largest production runtime at this checkpoint is RobynLaunchFactory at 21,047 bytes, leaving 3,529 bytes below the 24,576-byte EIP-170 limit. The factory embeds vault and token creation bytecode, so size must remain a release gate.

The deployment and live-verification commands are:

~~~bash
scripts/deploy-devnet-protocol.sh
scripts/verify-devnet-deployment.sh deployments/31337.json
~~~

They require loopback operator RPC with an unlocked Anvil account, refuse any chain other than 31337, store no private key, and verify live bytecode and cross-contract relationships.

## Deployment evidence

- The current controlled-devnet deployment is recorded in deployments/31337.json at block 74 from commit d31c68ff8bcb15f3ed37414baab43c3c3221915e and includes the self-service market factory.
- The prior browser journey bought and sold ROBYN, converted exact weighted fees, claimed all three reward assets and recovered its state after reload. Each deployment is independently verified before the web build is promoted.

The following items remain required before Robinhood testnet or any real-value deployment.

## Required before deployment

- The stateful handler invariants, malicious callback fixtures, bounded exclusion set, clean chain-46630 mock deployment and isolated five-service rehearsal are implemented.
- The old standalone accounting primitive is test-only under packages/contracts/test/fixtures.
- Obtain an independent contract security review before any real-value deployment.
- Treat the internal review as non-independent; the package is not approved for real assets.
# Atomic launch v2

All new native launches enter through immutable `RobynAtomicLaunchCoordinator`. One creator transaction creates the CREATE2 token and basket vault, creates the pre-bound Uniswap pool and bonding market, transfers and seeds the complete fixed one-billion-token inventory, clears allowance, and seals exclusions for the market, adapter, pool, locker, and coordinator. Any failed step reverts all contracts, mappings, approvals, logs, and the launch counter.

`RobynLaunchFactoryV2` and `UniswapV3MarketFactoryV2` start inactive. Their initializer can bind a coordinator exactly once, after which creator-facing factory methods remain unavailable and only coordinator calls are accepted. The market's canonical creator is the wallet while its one-use seed authority is the coordinator.

The canonical identity is `AtomicLaunchCreated` from the creator transaction receipt. Clients must not use the current `launchCount` to identify their result. The indexer exposes v2 launches only when the event agrees with both factory mappings and onchain seeded/sealed state.
# DAO and protocol fee extension

The schema-v4 protocol adds fixed-supply RDAO governance and the immutable 50/25/20/5 fee router with per-token creator-native accounting. Architecture, accounting, keeper controls, and invariants are specified in [DAO Governance and Fee Operations](dao-governance-operations.md) and PRD 11.

`RobynProtocolFeeRouterV2` keeps launch identity as the accounting key. Native conversion credits `claimableCreatorNative` on that launch's account, while `cumulativeCreatorNative` and `claimedCreatorNative` preserve lifetime reconciliation. The router retains `totalCreatorNativeLiability` as a global conservation check but exposes no wallet-aggregated creator balance. Single and batch claims validate the immutable creator recorded when the coordinator registered the launch.

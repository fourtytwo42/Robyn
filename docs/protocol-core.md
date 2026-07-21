# Protocol core

Status: implemented, tested and deployed to the shared controlled devnet

Last verified: 2026-07-21

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

This is a native reference path for the controlled devnet. The browser-operated genesis market proves the disclosed buy/sell, fee conversion and claim journey. The system does not yet include a production market, upstream launchpad adapter, stock registry/oracle guards, Merkle epochs, keeper, indexer or production quote provider.

## Contracts

| Contract | Responsibility |
|---|---|
| RobynLaunchFactory | Permissionless deployment, public launch registry, chain/version discovery and immutable shared policy |
| FeeBasketVault | Per-launch/per-leg fee isolation, measured allocation, constrained permissionless conversion and reward deposit |
| RobynLaunchToken | Fixed ERC-20 supply, transfer-aware multi-asset accumulators and pull claims |
| FeeBasketAccounting | Earlier conservation primitive retained as a narrow regression reference |

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

The 2026-07-21 checkpoint passed 21 tests, including two 256-run fuzz properties. Tests cover fee-on-transfer base and reward tokens, duplicate assets, invalid weights, failed route isolation, stale/zero-minimum rejection, unauthorized deposits/rebinding, exclusion sealing, excluded inventory, creator-authorized one-market deployment, devnet buy/sell fee generation, the one-time base faucet, one/three/five reward slots, transfer ordering, multi-asset claims and balance conservation.

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

- Add formal stateful handler invariants and broader malicious-token/callback fixtures.
- Decide whether the old standalone accounting primitive remains or is removed after migration.
- Add mock registry/feed/issuer boundaries and clean-genesis deployment rehearsal.
- Obtain independent contract security review before any real-value deployment.
- Treat this checkpoint as unaudited; it is not approved for real assets.

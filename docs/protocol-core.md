# Protocol core

Status: implemented and tested locally; shared-devnet deployment pending

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

This is a native reference path for the controlled devnet. It does not yet include a market, upstream launchpad adapter, stock registry/oracle guards, Merkle epochs, keeper, indexer, production quote provider or web transaction journey.

## Contracts

| Contract | Responsibility |
|---|---|
| RobynLaunchFactory | Permissionless deployment, public launch registry, chain/version discovery and immutable shared policy |
| FeeBasketVault | Per-launch/per-leg fee isolation, measured allocation, constrained permissionless conversion and reward deposit |
| RobynLaunchToken | Fixed ERC-20 supply, transfer-aware multi-asset accumulators and pull claims |
| FeeBasketAccounting | Earlier conservation primitive retained as a narrow regression reference |

The factory deploys the vault first, passes that address as the token's immutable controller, binds the token to the vault once, and exposes both addresses. Basket assets and weights have no mutation path.

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

The 2026-07-21 checkpoint passed 16 tests, including two 256-run fuzz properties. Tests cover fee-on-transfer base and reward tokens, duplicate assets, invalid weights, failed route isolation, stale/zero-minimum rejection, unauthorized deposits/rebinding, one/three/five reward slots, transfer ordering, multi-asset claims and balance conservation.

Largest production runtime at this checkpoint is RobynLaunchFactory at 19,588 bytes, leaving 4,988 bytes below the 24,576-byte EIP-170 limit. The factory embeds vault and token creation bytecode, so size must remain a release gate.

## Required before deployment

- Add formal stateful handler invariants and broader malicious-token/callback fixtures.
- Decide whether the old standalone accounting primitive remains or is removed after migration.
- Add deployment scripts, deterministic manifest, source/ABI publication and clean-genesis rehearsal.
- Implement the mock market/fee generator and production-shaped mock conversion/registry/feed boundaries.
- Obtain independent contract security review before any real-value deployment.
- Treat this checkpoint as unaudited; it is not approved for real assets.

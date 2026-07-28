# Sherwood Forest schema-10 smart contract security audit

Status: internal engineering audit complete for the current schema-10 testnet
contracts

Verdict: no known critical, high, or medium Solidity finding remains in the
reviewed schema-10 contract set. Mainnet remains NO-GO because the remediated
contracts still require full public-testnet lifecycle coverage, recovery
evidence, an eight-hour endurance gate, real wallet acceptance, and an
independent professional audit.

Last verified: 2026-07-27

This is an internal AI-assisted engineering review. It is not an independent
professional audit, does not prove absence of undiscovered defects, and does
not authorize Robinhood mainnet deployment.

## Audited target

- Repository: `/home/hendo420/Robyn-schema9`
- Source commit audited: `e94da5afa3a56555de1519c602b887e760cbaa3a`
- Deployed contract commit: `e754037bd40c5caee426e31b0886514da9c9ed12`
- Served testnet app release: `03e568ac987ce4cdce42c6d99d4cdd6c10e463ae`
- Manifest: `/home/hendo420/Robyn-schema9/deployments/46630-v4.json`
- Chain: Robinhood Testnet `46630`
- Operator RPC used for live verification: `http://192.168.50.117:8547`
- Active database: `robyn_testnet_schema10_e754037`

The source commit is newer than the deployed contract commit only because of
tooling and memory updates after deployment. The deployment manifest still
points at the immutable bytecode source commit.

## Scope

Reviewed active schema-10 contracts:

- `packages/contracts/src/RobynLaunchToken.sol`
- `packages/contracts/src/RobynTokenSink.sol`
- `packages/contracts/src/dao/RobynDaoToken.sol`
- `packages/contracts/src/dao/RobynTestnetGovernor.sol`
- `packages/contracts/src/uniswap/RobynNativeBasketVaultV2.sol`
- `packages/contracts/src/uniswap/RobynNativeLaunchDeployerV4.sol`
- `packages/contracts/src/uniswap/RobynNativeLaunchFactoryV4.sol`
- `packages/contracts/src/uniswap/RobynNativeProtocolFeeRouterV4.sol`
- `packages/contracts/src/uniswap/RobynNativeVaultDeployerV4.sol`
- `packages/contracts/src/uniswap/RobynV4AdapterDeployer.sol`
- `packages/contracts/src/uniswap/RobynV4AssetRouter.sol`
- `packages/contracts/src/uniswap/RobynV4BondingCurveMarket.sol`
- `packages/contracts/src/uniswap/RobynV4FeeAndPhaseHook.sol`
- `packages/contracts/src/uniswap/RobynV4FeePositionLocker.sol`
- `packages/contracts/src/uniswap/RobynV4GraduationAdapter.sol`
- `packages/contracts/src/uniswap/RobynV4LaunchCoordinatorV5.sol`
- `packages/contracts/src/uniswap/RobynV4LockerDeployer.sol`
- `packages/contracts/src/uniswap/RobynV4MarketDeployer.sol`
- `packages/contracts/src/uniswap/RobynV4MarketFactory.sol`
- `packages/contracts/src/uniswap/RobynV4TestAssetLiquidityLocker.sol`

Archived v3, devnet, and retired schema-v9 contracts remain compiled for
regression coverage but were not treated as active runtime contracts.

## Fresh evidence

Evidence directory:

`/home/hendo420/robyn-evidence/security-remediation/latest-audit-2026-07-26/`

Fresh checks run on 2026-07-27:

- `scripts/security-audit.sh`
  - Gitleaks scanned 439 commits and reported no leaks.
  - `pnpm audit --audit-level high` found no high or critical known dependency
    vulnerability.
  - Foundry default contract suite passed.
  - Slither completed active-scope analysis.
  - Slither detector counts: 48 medium, 33 low, 29 informational, 1
    optimization.
  - Reviewed unresolved Slither high findings: 0.
  - Reviewed unresolved Slither medium findings: 0.
- `FOUNDRY_PROFILE=assurance forge test --root packages/contracts -vv`
  - 159 tests passed.
  - 0 tests failed.
  - 1 environment-gated fork test skipped.
  - 256-run, depth-128 invariants passed.
  - `testNativeV4Campaign512Wallets32Launches25000Actions20Seeds` passed.
- `scripts/verify-testnet-release.sh /opt/robyn/testnet-current`
  - Release path:
    `/opt/robyn/testnet-releases/03e568a-security-remediation`
  - 531 deployment checks passed.
  - Ingestion lag: 0.
  - Projection lag: 0.
  - Router solvent: true.
  - Current indexed launch count: 1.

## Findings

### SF10-01A: Graduation adapter can trap unsolicited ETH

Severity: Low

Status: Closed in source, fresh deployment required.

The adapter now rejects direct native transfers. Because forced ETH cannot be
prevented at the EVM level, it exposes `unattributedNative()` and a
permissionless, non-reentrant `sweepUnattributedNative()` that forwards the
entire idle balance to the immutable timelock treasury configured on its
canonical locker. The adapter has no persistent native liability, and the
reentrancy guard prevents sweeping transient value during graduation or routed
trading.

Regression coverage proves:

- A direct ETH transfer reverts with `DirectNativeTransferRejected`.
- Forced ETH is classified as unattributed rather than protocol revenue.
- Anyone can sweep it only to the immutable timelock treasury.
- The amount and cumulative swept total reconcile exactly.
- A zero-balance sweep fails closed.

The full 165-test assurance suite, 256-run/depth-128 invariants,
512-wallet/32-launch/25,000-action simulation, contract-size gate, dependency
and secret scans, and active-scope static analysis pass after the change.

### SF10-01B: Asset router can trap unsolicited ETH

Severity: Low

Status: Closed in source, fresh deployment required.

The canonical PoolManager sends native swap output directly to the requested
recipient, and native input enters through the explicit payable swap function.
The router therefore no longer accepts fallback transfers. Forced ETH remains
possible at the EVM level, so the router now exposes `unattributedNative()` and
a permissionless, non-reentrant `sweepUnattributedNative()` that can send the
idle balance only to its immutable governor. Deployment tooling binds that
governor to the timelock treasury.

Regression coverage proves:

- Direct ETH transfers revert.
- Forced ETH remains isolated while a normal protected swap executes.
- Existing refund accounting does not leak the forced balance to a swap caller.
- Anyone can sweep the balance only to the immutable timelock.
- The balance and cumulative sweep accounting reconcile exactly.
- A zero-balance sweep fails closed.

Release impact:

- Does not block testnet continuation.
- The adapter and asset-router source fixes change bytecode and require fresh
  immutable deployment before they protect live protocol activity.

## Previously reported findings

The prior schema-v9 audit findings are closed in schema 10 at the source level:

- SF-01 pre-graduation v4 pools accepting third-party liquidity and direct
  swaps: closed by phase-aware hook gating.
- SF-02 unused graduation inventory treated as collectible token fees: closed
  by principal-safe locker accounting.
- SF-03 zero eligible DAO supply halting fee-bearing trades: closed by
  accounting-only fee intake and queued DAO settlement.
- SF-04 instant reward deposits enabling predictable reward sniping: reopened
  as an explicit product-policy risk. Immediate transfer-aware accounting
  prevents retroactive capture but does not prevent entering before a
  predictable settlement.
- SF-05 unsolicited ETH misclassification in fee surfaces: closed in source for
  fee router, locker, graduation adapter, and asset router.

## Manual review notes

### Phase-aware v4 hook

`RobynV4FeeAndPhaseHook` registers each launch pool in `Bonding`. During
`Bonding`, `beforeSwap`, `beforeAddLiquidity`, and `beforeDonate` revert. During
`Graduating`, only the immutable PositionManager is permitted to add the one
graduation position. The canonical adapter is the only phase controller, and
phase progression is one-way.

Focused tests cover direct pre-graduation swap, liquidity addition, donation,
unchanged price, unchanged observation count, successful graduation, and
post-graduation third-party liquidity.

### Hook fee accounting

The hook charges an additional 1 percent Sherwood fee on registered launch-pool
swaps after graduation. Exact-input and exact-output behavior is tested in both
directions. Native fees are queued in the hook and settled into the fee router.
Launch-token fees are converted through the protected asset router with TWAP,
staleness, size, slippage, and impact checks.

### Principal-safe locker

The locker measures balance deltas around `collectFees` and verifies the
position liquidity before and after collection. Only measured collection deltas
become pending fees. Principal liquidity and permitted residual dust remain
separate and cannot be converted or routed as fee revenue.

### Fee router

`RobynNativeProtocolFeeRouterV4` performs accounting only on fee intake. It
credits liabilities for basket settlement, token-specific creator rewards, DAO
holder rewards, and treasury settlement using the fixed 50/25/20/5 policy.
Destination settlement is permissionless and isolated, so a failed or
temporarily unavailable destination cannot block trading or unrelated
settlement.

### Immediate rewards

The audited schema-10 release assigned each deposit at settlement time.
Transfers settle sender and receiver before balances move, preserving rewards
already assigned to the prior holder. If eligible supply becomes zero, rewards
remain queued and activate when eligible supply returns. Buying before a
predictable settlement can still capture a pro-rata share; this is accepted for
testnet but remains a mainnet-review item.

Creator rewards are also immediate. The canonical creator may divide future
creator-fee allocations across up to eight unique addresses totaling exactly
10,000 basis points. An open split can be edited, while a locked split is
irreversible. Changes never reassign rewards already accrued to a recipient.

### Atomic launch and graduation

The coordinator creates token, vault, market, adapter, pool, locker, exclusions,
market seeding, fee registration, and optional creator purchase in one
transaction. Graduation occurs atomically through the bonding market and adapter.
Pool phase reverts with the transaction if the position mint or locker
verification fails.

## Mainnet readiness verdict

Current verdict: NO-GO for mainnet.

Reasons:

- No known critical, high, medium, or low Solidity finding remains in the
  reviewed source. SF10-01A and SF10-01B are not yet in deployed bytecode.
- The remediated public-testnet campaign has not run because funding preflight
  is blocked.
- The fresh schema-10 deployment currently has only the genesis launch indexed,
  so post-remediation public-testnet coverage has not yet exercised multiple
  launches, graduations, direct Universal Router swaps, hook settlement, LP fee
  settlement, all reward-asset routes, and all claim paths.
- Empty-database rebuild, recovery drills, backup/restore, real MetaMask,
  Robinhood Wallet acceptance, reproducible build comparison, exact-current app
  promotion, and the uninterrupted eight-hour endurance gate are not complete.
- Independent professional audit remains required before any real-value
  deployment.

## Recommended next steps

1. Deploy fresh contracts containing both unsolicited-ETH fixes and verify
   their exact runtime bytecode.
2. Promote an exact-current application release so served release and
   `origin/main` are aligned.
3. Add the requested testnet ETH and rerun the fixed no-reduced-coverage
   campaign preflight.
4. Run the full 100-wallet remediated public-testnet lifecycle campaign.
5. Rebuild an empty database from canonical logs and reconcile.
6. Run browser, MetaMask, Robinhood Wallet, recovery, backup/restore,
   reproducibility, and eight-hour endurance gates.
7. Send the exact final commit and deployment to an independent professional
   smart-contract auditor.

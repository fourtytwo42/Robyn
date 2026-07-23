# Uniswap v3 Graduation and Fee Operations

Last verified: 2026-07-22

## Outcome

Robyn's production market implementation can atomically graduate a sold-out bonding curve into a canonical Uniswap v3 pool while preserving the same market contract as the user's Buy/Sell entrypoint. The liquidity-position NFT is permanently held by an immutable locker. Quote-asset trading fees fund the launch's existing reward basket; launch-token fees stay sequestered in the excluded locker.

The feature-branch deployment path now uses pinned official Uniswap v3 artifacts on chain 31337 and has passed an isolated full deployment, seeded-demo, graduation, post-graduation trading, and keeper-harvest rehearsal. The persistent served chain is not changed until the validated release is promoted.

## Contracts

- `UniswapV3BondingCurveMarket`: curve inventory, terminal-buy cap/refund, fee recording, atomic graduation, and the stable pre/post-graduation `quoteBuy`, `quoteSell`, `buy`, and `sell` interface.
- `UniswapV3GraduationAdapter`: validates DEX configuration, creates the bound pool before reward exclusions seal, enforces terminal-price continuity, initializes the pool, mints the position, and routes post-graduation swaps.
- `RewardFeePositionLocker`: owns one validated position forever, exposes no principal/NFT withdrawal path, and permissionlessly collects fees.
- `UniswapV3Interfaces`: minimal interfaces for the official v3 factory, pool, position manager, QuoterV2, and SwapRouter02.
- `UniswapV3MarketFactory`: creator-authorized registry that computes token-order-aware initial price, deploys the adapter and market, binds them in one transaction, and retains the existing `marketByToken` application seam.
- `UniswapV3AdapterDeployer` and `UniswapV3MarketDeployer`: one-controller, size-bounded deployment helpers required to keep every runtime below EIP-170.

## Atomic lifecycle

1. Market construction validates the configured DEX contracts and pre-creates the unique token/quote/fee-tier pool.
2. Launch initialization excludes the market, adapter, locker, and pool from holder-reward supply before exclusions seal.
3. The terminal curve purchase takes only the required input, records its curve fee, transfers the final curve inventory, and refunds excess input.
4. In the same transaction, the market passes its reserved launch tokens and net quote liquidity to the adapter.
5. The adapter rejects an initial price outside the configured terminal-price tolerance, initializes the pre-created pool, and mints full-range liquidity directly to the locker.
6. The adapter verifies and binds the NFT held by the locker. Any failure reverts the terminal purchase and every preceding state change.
7. Later calls to the same market ABI automatically use QuoterV2 and SwapRouter02.

## Fee policy

- The v3 position remains active and fee-bearing even though its NFT cannot move.
- Anyone may call `RewardFeePositionLocker.harvest()`.
- The conversion keeper detects graduated Uniswap markets, simulates a harvest to avoid empty transactions, serializes the permissionless harvest through its existing audited BullMQ worker, and then processes the newly pending basket conversions normally.
- The locker measures actual token balance deltas from `collect`; it does not trust nominal amounts.
- Actual quote-asset fees are approved to the launch's `FeeBasketVault` only for the exact collected amount, then the approval is cleared.
- Collected launch-token fees remain in the locker permanently. The locker and pool must be excluded from reward eligibility so locked inventory cannot dilute holders or earn rewards.
- Initial liquidity and unused mint residuals are principal, not fee revenue, and remain locked.
- The configured pool tier is a nominal swap fee. If Uniswap governance enables a protocol fee, the position receives less than the nominal total; UI/accounting must display harvested amounts as authoritative.

## Official Robinhood mainnet bindings

The no-broadcast fork test uses the official Uniswap deployment table for chain 4663:

| Component | Address |
| --- | --- |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| Uniswap v3 factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` |
| NonfungiblePositionManager | `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` |
| SwapRouter02 | `0xCaf681a66D020601342297493863E78C959E5cb2` |
| QuoterV2 | `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` |

SwapRouter02 is deliberately modeled with its seven-field `exactInputSingle` tuple. It does not use the legacy v3 `deadline` field.

## Controlled chain-31337 deployment

`scripts/deploy-local-uniswap-v3.sh` deploys bytecode from pinned official npm artifacts only on chain 31337. It records package versions and runtime code hashes for the factory, position manager, QuoterV2, and SwapRouter02. The local mock base asset is used only as the wrapped-quote constructor dependency for this controlled environment.

`scripts/deploy-devnet-protocol.sh` deploys the helper contracts and `UniswapV3MarketFactory`, binds both helpers once, creates each pool before exclusions seal, and records adapter, locker, pool, DEX addresses, fee tier, tick range, terminal price, use tolerance, and runtime hashes in the manifest. Launch initialization excludes the market, adapter, locker, and pool.

`scripts/verify-devnet-deployment.sh` fails closed on missing code, helper-controller drift, market/adapter/locker/pool mismatch, exclusion omissions, DEX code-hash drift, configuration drift, and graduated pools without liquidity.

## Verification

Run all project commands on the VM:

```bash
cd /home/hendo420/Robyn/packages/contracts
/home/hendo420/.foundry/bin/forge fmt --check
/home/hendo420/.foundry/bin/forge test -vv
/home/hendo420/.foundry/bin/forge build --sizes
```

Run the canonical no-broadcast fork explicitly:

```bash
ROBINHOOD_MAINNET_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
  /home/hendo420/.foundry/bin/forge test \
  --match-contract RobinhoodUniswapGraduationForkTest -vv
```

Without `ROBINHOOD_MAINNET_RPC_URL`, the fork test returns without accessing a network so the ordinary deterministic suite remains offline-compatible.

The isolated chain-31337 rehearsal additionally proved that the seeded EVID demo graduated, remained buyable and sellable through the same market address, minted position NFT `1` directly to its locker, routed collected mUSD fees into its basket vault, permanently retained the collected launch-token side, and completed an automatic keeper harvest job. The rehearsal used a disposable Anvil process, disposable PostgreSQL schema, and previously empty Redis logical database; all were cleaned after verification.

## Fail-closed deployment gates

- Never reuse chain-4663 addresses on chain 46630 without independent official provenance and runtime code-hash verification.
- Do not broadcast a public-testnet transaction without the user's explicit authorization.
- The factory atomically deploys and binds the adapter, pre-created pool, locker, and market once `createMarket` begins. `createLaunch` and `createMarket` are still separate wallet transactions, so public deployment must add a launch coordinator or another atomic mechanism to eliminate the remaining pool-precreation denial-of-service interval.
- Bind the deployment manifest to exact chain ID, quote asset, factory, position manager, router, quoter, pool fee, tick range, initial price, implementation versions, and runtime code hashes.
- Independently review the no-withdrawal locker, price math, token-decimal assumptions, mint-use tolerance, pool-squatting behavior, and application route selection before real value.

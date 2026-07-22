# Uniswap v3 Graduation and Fee Operations

Last verified: 2026-07-22

## Outcome

Robyn's production market implementation can atomically graduate a sold-out bonding curve into a canonical Uniswap v3 pool while preserving the same market contract as the user's Buy/Sell entrypoint. The liquidity-position NFT is permanently held by an immutable locker. Quote-asset trading fees fund the launch's existing reward basket; launch-token fees stay sequestered in the excluded locker.

The persistent chain-31337 application still uses `DevnetLockedLiquidityPool`. That pool is a controlled UX/accounting rehearsal, not Uniswap. Do not represent the currently served devnet market as canonical Uniswap until deployment and data-plane integration are complete.

## Contracts

- `UniswapV3BondingCurveMarket`: curve inventory, terminal-buy cap/refund, fee recording, atomic graduation, and the stable pre/post-graduation `quoteBuy`, `quoteSell`, `buy`, and `sell` interface.
- `UniswapV3GraduationAdapter`: validates DEX configuration, creates the bound pool before reward exclusions seal, enforces terminal-price continuity, initializes the pool, mints the position, and routes post-graduation swaps.
- `RewardFeePositionLocker`: owns one validated position forever, exposes no principal/NFT withdrawal path, and permissionlessly collects fees.
- `UniswapV3Interfaces`: minimal interfaces for the official v3 factory, pool, position manager, QuoterV2, and SwapRouter02.

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

## Fail-closed deployment gates

- Never reuse chain-4663 addresses on chain 46630 without independent official provenance and runtime code-hash verification.
- Do not broadcast a public-testnet transaction without the user's explicit authorization.
- Deploy token, market, pre-bound pool, locker, and exclusions in one launch transaction or otherwise eliminate the interval in which a third party can pre-create the token pair and deny market construction.
- Bind the deployment manifest to exact chain ID, quote asset, factory, position manager, router, quoter, pool fee, tick range, initial price, implementation versions, and runtime code hashes.
- Independently review the no-withdrawal locker, price math, token-decimal assumptions, mint-use tolerance, pool-squatting behavior, and application route selection before real value.

# Bonding curve and graduation design

Status: Architecture decision for controlled-devnet implementation  
Date: 2026-07-21

## Decision

Robyn will add a native launch lifecycle with a constant-product bonding curve and an automatic, irreversible graduation into locked AMM liquidity. Trading fees continue to fund the launch's immutable holder reward basket in both phases.

This is a real protocol state machine. The interface must never calculate graduation from arbitrary volume, invented market cap, or demo percentages.

## Current reference behavior

### Pump

Pump's current documentation describes a virtual-reserve constant-product AMM. Buys move the price upward, sells move it downward, and price impact grows with order size. Completion closes the curve and moves liquidity atomically to PumpSwap. Migration is irreversible and the protocol owns the canonical pool liquidity.

Primary sources:

- https://pump.fun/docs/bonding-curve
- https://pump.fun/docs/fees
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md

### Circus

The live Circus product currently presents two launch lanes. Its Classic Curve lane uses a 1B fixed supply, offers 800M on the curve, shows market cap and graduation progress on cards and token pages, and states that graduation occurs at roughly 6.5 ETH raised. Its published explanation says graduation atomically creates a Uniswap v3 pool and locks liquidity permanently. Its Fair Open lane starts directly in a locked Doppler/Uniswap v4 pool and has no graduation phase.

Live references:

- https://circus.trade/
- https://circus.trade/how-it-works

Point-in-time observations can drift. Contract source and deployment provenance must be independently verified before reusing any external implementation.

## Robyn lifecycle

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Bonding: token, basket and curve initialized
    Bonding --> Bonding: buy or sell
    Bonding --> GraduationReady: onchain threshold reached
    GraduationReady --> Graduated: atomic permissionless migration
    Graduated --> Graduated: AMM buy or sell
```

| Phase | Trading venue | Pricing | Liquidity status | Reward fees |
|---|---|---|---|---|
| Draft | None | None | Not initialized | None |
| Bonding | Robyn curve | Constant product with virtual reserves | Curve inventory and reserve held by immutable market | Routed to the immutable basket vault |
| Graduation ready | Curve closed to new trades | Final curve quote | Migration may be called by anyone | Already accrued fees remain claimable |
| Graduated | Canonical AMM pool | Pool reserves | LP position permanently locked | Pool fee share routed to the same basket vault |

## Controlled-devnet policy

- Fixed token supply: 1,000,000,000 tokens.
- Curve allocation: 800,000,000 tokens.
- Graduation-liquidity allocation: 200,000,000 tokens.
- Quote asset: mock USD (`mUSD`).
- Curve formula: `virtualTokenReserve * virtualBaseReserve = k` with conservative rounding.
- Trade fee: 1.00%, routed into the existing weighted reward vault.
- Graduation target: 6,500 mUSD net curve reserve for normal devnet launches.
- Accelerated test fixtures may use a smaller constructor target, but the UI must display the actual immutable target read from the market.
- Graduation: permissionless, idempotent and irreversible.
- Local graduated venue: an immutable no-withdrawal constant-product pool that implements the same fee-vault interface. It is a rehearsal dependency, not a claim that Uniswap is running locally.

Exact production virtual reserves must be chosen by a checked-in economic simulation that proves the starting FDV, terminal curve price, migration price continuity, maximum price impact and reserve solvency. The initial controlled-devnet constants are test parameters, not a mainnet recommendation.

## Required contract boundaries

### `BondingCurveMarket`

- Immutable token, quote asset, reward vault, curve parameters, fee and graduation adapter.
- Holds only the curve allocation and curve quote reserve.
- Exposes exact buy/sell quotes, current price, net reserve, remaining curve inventory, progress basis points and lifecycle phase.
- Applies checks-effects-interactions and reentrancy protection.
- Rejects zero amounts, zero-output trades, impossible reserve states, stale minimum outputs and trades after curve closure.
- Emits reserve snapshots after every trade so the indexer can reproduce price history without guessing.

### `GraduationAdapter`

- Can be invoked by anyone only after the immutable threshold is reached.
- Creates or initializes exactly one canonical pool.
- Moves exactly the recorded quote reserve, remaining curve inventory and reserved graduation allocation.
- Sends the LP position to an immutable locker or provably irrecoverable ownership target.
- Binds the pool fee receiver to the existing launch reward vault.
- Records the venue, pool, locker, migrated amounts and transaction in one canonical event.
- Cannot select arbitrary tokens, recipients, routers, fee tiers or price ranges at call time.

### Launch token

- Fixed supply and no post-launch mint authority.
- Before graduation, transfers are limited to curve-mediated movement and explicitly approved protocol accounts so a side market cannot bypass the curve.
- After graduation, ordinary ERC-20 transfers are permanently enabled.
- Reward correction accounting must remain solvent across the transfer-policy transition.

## Invariants

1. Quote reserves and curve inventory never become negative.
2. Every successful trade preserves the constant-product invariant within documented conservative rounding.
3. Actual token and quote balances cover all recorded reserves and pending fee transfers.
4. Net reserve and progress decrease correctly after sells and never exceed 10,000 bps in the public view.
5. Graduation cannot occur below the threshold.
6. Graduation can succeed only once and cannot be reversed.
7. No privileged account can withdraw curve or graduated liquidity.
8. The migrated amounts exactly equal the curve's recorded migratable balances.
9. Trading fees before and after graduation remain isolated to the launch's existing basket vault.
10. Buyers after a prior reward distribution cannot receive that prior reward.
11. Failed graduation leaves the complete curve state recoverable and does not strand user balances.
12. A malicious token, router, adapter or callback cannot reenter trade, fee recording or migration.

## API and indexing

Every discovery and token-detail response must expose:

- `marketPhase`: `bonding`, `graduation_ready`, `graduated` or `legacy_fixed`;
- current price and market cap;
- `graduationProgressBps`;
- net quote reserve and immutable graduation target;
- remaining curve tokens;
- graduated pool and locker addresses when present;
- formula and adapter version;
- block number for the indexed snapshot.

The indexer derives history from canonical curve-state and graduation events. It must not estimate progress from volume because sells, fees and failed transactions make gross volume an invalid reserve proxy.

## Product behavior

- Discovery cards show both the reward-basket weight rail and a compact graduation rail. They answer different questions and neither replaces the other.
- The token page shows phase, current progress, amount raised, amount remaining, curve price, estimated price impact, migration destination and locked-liquidity proof.
- Buy/sell controls quote the active venue and refresh after each confirmed transaction.
- A graduated token visibly switches from `Bonding` to `Graduated`, links the pool and lock receipt, and never continues showing a mutable progress bar.
- Discovery supports `Bonding` and `Graduated` filters.
- Creation previews fixed supply, curve allocation, migration allocation, threshold, fee routing and transfer restrictions before signature.

## Delivery sequence

1. Add economic simulation and select controlled-devnet parameters.
2. Implement curve, transfer policy, local graduation pool/adapter and adversarial tests.
3. Extend deployment manifest, verifier, indexer and read API.
4. Extend create, discovery, detail, trade and portfolio interfaces.
5. Deploy a new controlled-devnet factory without deleting the current chain or user-created launches; retain legacy fixed-market reads during migration.
6. Exercise an accelerated launch through buy, sell, threshold, graduation, post-graduation trade, fee conversion and holder claim in the in-app browser.
7. Before Robinhood testnet, verify the exact Uniswap/Doppler deployment, fee ownership, pool initialization, locker and price-range strategy, then replace the local adapter.

## Explicit non-shortcuts

- Do not label gross volume as amount raised.
- Do not show fabricated graduation percentages.
- Do not mark a token graduated from an offchain admin flag.
- Do not let a keeper choose migration recipients or assets.
- Do not call an unlocked or admin-withdrawable position `locked liquidity`.
- Do not reuse Pump or Circus contracts without verified source, license, deployment provenance and an independent security review.


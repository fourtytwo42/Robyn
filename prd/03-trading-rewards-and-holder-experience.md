# Trading, rewards and holder experience

Status: Draft  
Owner: Product/frontend TBD  
Date: 2026-07-20

## Goal

Make trading and rewards legible enough that a user can answer four questions before acting:

1. What am I buying or selling?
2. What fees will the trade pay?
3. What basket does the holder-reward share fund?
4. What has actually been purchased and what can I claim now?

## Token detail page

### Header

- Name, symbol and full/copyable contract address.
- Creator wallet and launch time.
- Upstream market status and liquidity.
- Prominent experimental-risk label.

### Market panel

- Buy/sell controls using the upstream venue or embedded supported flow.
- Input, expected output, price impact, total fee, minimum received and gas.
- Route and transaction target details behind an expandable inspection panel.
- Balance and allowance state.

### Market intelligence and ownership

- The token page uses the launchpad-standard three-column priority: token identity and metrics, a dominant chart, and a persistent buy/sell panel on wide screens.
- Market cap, liquidity, volume, trade count, holder count and fees must name their source and must not be synthesized when canonical data is unavailable.
- The controlled fixed-price market charts its real fixed price and cumulative canonical volume; the UI explicitly explains why the price line is flat.
- Top-holder balances are reconstructed from complete canonical `Transfer` history. Liquidity inventory is labeled separately from ordinary holder wallets.
- Recent trades show side, trader, token quantity, base value, block and transaction provenance from decoded market events.
- Holder/recent-trade tables, reward state and raw verification remain useful without connecting a wallet. Connection authorizes trading rather than unlocking public market information.

### Reward basket

For each immutable leg:

- asset symbol, name, verified address and weight;
- pending unconverted WETH/USDG;
- total asset purchased and deposited;
- latest conversion price/time/transaction;
- route status and reason for delay;
- wallet accrued and claimable amount.

### Reward timeline

Events include fees claimed, conversion attempted, conversion succeeded/failed, rewards deposited, epoch proposed, epoch opened and holder claimed. The UI must distinguish protocol event time from indexed time.

### Verification

Display upstream contracts, Robyn contracts, basket configuration hash, implementation/version, epoch manifests, vault balances, exclusions and relevant explorer links.

## Trading requirements

| ID | Requirement | Priority | Acceptance |
|---|---|---:|---|
| TRADE-001 | Trade preview MUST show expected output, minimum received, price impact, venue fee, estimated gas and reward-directed fee share | MUST | Quote/UI integration test |
| TRADE-002 | The UI MUST re-quote after expiry, material block/state change or user amount change | MUST | Expiry and stale-state tests |
| TRADE-003 | The UI MUST verify the connected chain and transaction target before signature | MUST | Wrong-chain/target tests |
| TRADE-004 | Allowances SHOULD be exact or Permit2-scoped and MUST identify the spender | MUST | Allowance test |
| TRADE-005 | Successful trades MUST reconcile wallet balance and transaction receipt | MUST | E2E test |
| TRADE-006 | Failed/replaced trades MUST not be represented as completed | MUST | Replacement/revert tests |
| TRADE-007 | Trading MUST remain separable from reward claiming | MUST | Availability isolation test |
| TRADE-008 | Embedded trading MAY defer to the upstream interface in R1 if Robyn preserves clear fee and destination disclosure | MAY | Product review |

## Reward state model

| State | Meaning |
|---|---|
| Pending fee | Fee value belongs to the launch but has not been claimed from the upstream protocol |
| Pending cash | Claimed WETH/USDG assigned to a basket leg but not converted |
| Purchased | Reward asset acquired and held by the vault/controller |
| Unlocking | Purchased reward asset is releasing linearly over the rolling one-hour stream |
| Accrued | Holder allocation checkpointed by the transfer-aware accumulator |
| Claimable | Currently unlocked allocation available to withdraw |
| Claimed | Asset transferred to holder and marked consumed |
| Delayed | Conversion or epoch is intentionally waiting for threshold, quote, challenge or route recovery |
| Reconciled exception | Issuer action or exceptional loss has been publicly accounted for under incident policy |

The interface must not collapse these states into a single “rewards earned” number.

## Adapter epoch experience

1. Epoch window closes at a published block.
2. Indexer deterministically reconstructs time-weighted balances and exclusions.
3. Builder publishes a manifest, reward totals and Merkle root.
4. Challenge delay begins; allocations are visible but not claimable.
5. Root becomes final unless rejected under the defined safety mechanism.
6. Holder requests proof and submits a claim for one or more assets.
7. Contract marks the leaf/asset consumed and transfers exact assets.

Time weighting must be defined in block units with a published formula. The default candidate is balance-blocks: the integral of eligible token balance across the epoch divided by total eligible balance-blocks. The exact epoch cadence and challenge period remain decision items.

## Reward requirements

| ID | Requirement | Priority | Acceptance |
|---|---|---:|---|
| REWARD-001 | Holder MUST see pending, purchased, accrued, claimable and claimed amounts separately by asset | MUST | UI/data test |
| REWARD-002 | Claims MUST be pull-based and MUST NOT require iteration over holders | MUST | Contract/gas review |
| REWARD-003 | Adapter allocations MUST use complete canonical Transfer history and published exclusions | MUST | Independent replay test |
| REWARD-004 | Epoch manifests MUST include chain, contracts, block range/hash, reward totals, exclusions, formula version, root and content hash | MUST | Schema validation |
| REWARD-005 | Anyone MUST be able to reproduce a wallet proof from public inputs | MUST | Independent builder comparison |
| REWARD-006 | A wallet MUST NOT claim the same epoch/asset allocation twice | MUST | Unit/fuzz test |
| REWARD-007 | Claim UI MUST show claim amount, asset, gas, contract and proof epoch before signature | MUST | E2E test |
| REWARD-008 | A sold balance MUST retain rewards earned in prior finalized periods | MUST | Ownership-interval test |
| REWARD-009 | A newly purchased balance MUST NOT earn prior-period rewards | MUST | Snapshot-gaming test |
| REWARD-010 | Failed asset conversion MUST remain visible as pending cash for the same leg | MUST | Failure-path E2E |
| REWARD-011 | Small claims SHOULD remain available for batching rather than be forfeited | SHOULD | Multi-epoch claim test |
| REWARD-012 | The page MUST explain that received Stock Tokens may be subject to issuer restrictions and controls | MUST for R2 | Copy/legal test |
| REWARD-013 | Native holder rewards MUST unlock linearly over one rolling hour and checkpoint both accounts before every transfer | MUST | Unit, fuzz and transfer-timing tests |
| REWARD-014 | A pull claim MUST transfer only the currently unlocked amount and leave the remaining stream intact | MUST | 0, 10, 30, 59 and 60 minute claim tests |

## Portfolio

Connected wallet view:

- launched and held community tokens;
- claimable rewards across launches, grouped by asset;
- pending/nonfinalized allocations;
- claim history and transaction status;
- estimated aggregate gas for selected claims;
- direct links to independently verify each allocation.

Portfolio values are estimates with timestamp and source. Token amounts remain primary.

## Notifications

MVP supports in-app states only. Optional later notifications may cover:

- conversion completed;
- epoch proposed/finalized;
- rewards claimable;
- route delayed;
- issuer or protocol incident.

No notification may state a guaranteed reward value or create urgency to trade.

## Accessibility and comprehension

- Do not rely on red/green alone for transaction or route status.
- Asset and token addresses must be copyable and readable by assistive technology.
- Charts need text summaries.
- Fee and reward explanations use dollar examples and exact percentages.
- The confirmation test asks users to identify whether the token is redeemable. It must not become a dark-pattern quiz that obscures launch.

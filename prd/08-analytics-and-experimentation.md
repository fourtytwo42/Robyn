# Analytics and experimentation requirements

Status: Draft  
Owner: Product/data TBD  
Date: 2026-07-20

## Purpose

Measure whether creators understand and want the product, whether holder rewards become meaningfully active, and whether the system operates safely. Raw token launches and trading volume are not sufficient success measures.

## North-star outcome

**Weekly active reward launches:** launches that both generate real third-party trading fees and complete at least one successful basket conversion during the week.

This is paired with correctness and comprehension guardrails. A launch produced by self-trading alone or a conversion that fails reconciliation does not count.

## Metric framework

### Acquisition

- Unique wallets viewing create flow.
- Qualified creator starts and completed previews.
- Source/referrer and campaign where consented.
- Discovery-to-token-detail and detail-to-trade intent.

### Activation

- Launch completion rate.
- Time to configure basket.
- Basket validation error rate.
- First third-party trade.
- First fee receipt and first conversion.
- First holder claim.

### Retention

- Creators returning to monitor launches at 7/30 days.
- Holders returning after claimable notification/state.
- Launches with active trading and conversions in weeks 2-4.
- Repeat creators launching a second token.

### Economic activity

- Realized fee revenue by source.
- Pending cash by age and basket leg.
- Gross/net converted value and execution loss.
- Median time to conversion threshold.
- Claimable versus claimed amounts and claim gas ratio.
- Launch liquidity retention and third-party wallet concentration.

### Safety and reliability

- Accounting reconciliation exceptions.
- Failed/stale/rejected quote rate.
- Indexer lag and reorganization count.
- Invalid root proposals/challenges.
- Keeper failure and manual intervention count.
- Route/issuer pause duration.
- Support and incident rate per active launch.

### Comprehension

- Percentage correctly identifying nonredeemability.
- Percentage correctly distinguishing pending versus claimable.
- Percentage correctly explaining immutable weights.
- Percentage correctly predicting rewards after buy/sell timing examples.

## Analytics requirements

| ID | Requirement | Priority | Verification |
|---|---|---:|---|
| ANALYTICS-001 | Onchain-derived metrics MUST retain source contracts, transactions and `asOfBlock` | MUST | Metric lineage audit |
| ANALYTICS-002 | Product events MUST use a versioned schema and exclude secrets/signed payloads | MUST | Event schema/privacy test |
| ANALYTICS-003 | Wallet addresses MUST be pseudonymous identifiers and not labeled as verified people | MUST | Dashboard/privacy review |
| ANALYTICS-004 | Launch count and volume MUST be reported with sybil/wash caveats and cohort-quality measures | MUST | Reporting review |
| ANALYTICS-005 | Projected rewards MUST never be combined with realized purchased or claimed rewards | MUST | Metric/UI test |
| ANALYTICS-006 | Execution metrics MUST compare quote, minimum output, actual output, oracle reference and fees | MUST | Reconciliation pipeline test |
| ANALYTICS-007 | Funnel events SHOULD avoid third-party tracking where first-party aggregate measurement suffices | SHOULD | Architecture/privacy review |
| ANALYTICS-008 | Users MUST receive required analytics/privacy disclosures and controls | MUST | Legal/UI test |
| ANALYTICS-009 | Experiment assignments MUST NOT alter immutable onchain economics after preview | MUST | Experiment guard test |
| ANALYTICS-010 | Safety and comprehension guardrails MUST be visible beside growth metrics | MUST | Dashboard acceptance |

## Product event taxonomy

Events are offchain UI telemetry unless noted:

- `create_viewed`
- `token_metadata_completed`
- `basket_asset_added`
- `basket_validation_failed`
- `economics_viewed`
- `permanent_rules_acknowledged`
- `launch_previewed`
- `launch_transaction_submitted`
- `launch_confirmed` (onchain-derived)
- `token_detail_viewed`
- `trade_previewed`
- `trade_submitted`
- `trade_confirmed` (onchain-derived)
- `reward_state_viewed`
- `proof_requested`
- `claim_submitted`
- `claim_confirmed` (onchain-derived)
- `verification_link_opened`
- `rpc_degraded`
- `route_delayed_viewed`

Client telemetry must never be the canonical source for financial transactions.

## Pre-build user research

Participants:

- 10 potential token creators familiar with crypto launchpads.
- 15 prospective traders/holders across experienced and less experienced users.

Creator tasks:

1. Launch a sample token with NVDA 40%, SPY 40% and crypto 20%.
2. Explain where a hypothetical $100 creator-fee receipt goes.
3. Respond to a thin/unavailable asset.
4. Compare 0.5%, 1%, 2% and 5% trading-fee scenarios.
5. Explain what can change after launch.

Holder tasks:

1. Decide whether the token can be redeemed for the basket.
2. Locate pending cash, purchased assets and claimable assets.
3. Predict rewards for buying before versus after an epoch.
4. Respond to delayed conversion and issuer pause states.
5. Decide whether a claim is worth its gas.

Pass thresholds:

- 90% complete basket creation without facilitator help.
- 100% resolve weight-total validation.
- At least 70% identify nonredeemability before final confirmation and 90% after it.
- 80% explain pending cash and failed-leg retention.
- 80% distinguish accrued/nonfinalized from claimable.
- Median creator preference is no higher than a 2% trading fee, unless evidence strongly supports otherwise.

## Execution-liquidity study

For each candidate Stock Token, sample authenticated firm quotes during underlying-market open and closed periods:

- notional: $100, $1,000 and $10,000;
- providers: 0x and 1inch where supported;
- record route/source, expected output, provider fees, expiry, targets/spenders and oracle reference;
- simulate calldata and record whether it would pass onchain policy;
- do not execute production notional without separate authorization.

Default-list threshold hypothesis:

- at least 90% valid $100 quotes during trading windows;
- below 1% oracle-relative execution loss for at least 95 of 100 $100 samples;
- no more than five consecutive market sessions without a valid route;
- route remains valid under the exact contract-wallet receiver model.

## R1 pilot experiments

### Fee comprehension

Compare a simple percentage explanation with a dollar-flow table. Success is comprehension, not conversion-rate uplift alone.

### Basket builder

Compare blank selection with equal-weight/40-40-20 templates. Ensure templates are labeled configuration aids, not recommendations.

### Reward cadence

Compare user reaction to weekly versus threshold-only conversion messaging without changing live economics mid-launch.

### Claim batching

Test single-asset versus multi-asset claim selection based on estimated gas and user understanding.

No experiment may hide risk, alter a deployed basket, create fake scarcity or encourage trading solely to increase rewards.

## Go/no-go dashboard

Before expanding R1:

- at least 10 contract-recipient fee claims complete without privileged intervention;
- all financial reconciliation checks pass;
- median active launch reaches conversion threshold at least weekly or users accept slower cadence;
- comprehension thresholds hold in real beta feedback;
- route failures and support load are operationally manageable.

Before R2:

- quote dataset passes asset thresholds;
- legal and provider gates are signed off;
- issuer-control and route incident drills pass;
- no unresolved critical/high audit issue;
- Stock Token language passes comprehension testing.

Before native R3:

- measured Merkle delay/trust or upstream dependence is a top user/operator problem;
- native transfer gas remains acceptable;
- expected benefit justifies the expanded audit and liquidity-launch surface.


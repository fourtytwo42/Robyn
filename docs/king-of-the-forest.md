# King of the Forest

Status: implemented for Robinhood Testnet
Last verified: 2026-07-26

## Policy

A launch earns King of the Forest once per chain when a qualifying post-activation trade leaves it with at least 5,000 bps bonding progress and 10 distinct lifetime traders. Graduated launches remain eligible. Existing history rebuilds progress and trader counts, but only fresh activity at or after the manifest activation block may create an award.

The award is a discovery achievement only. It grants no tokens, fees, voting power, ownership right, or control over the launch.

## Canonical projection

The deployment manifest freezes the policy version, activation block, progress threshold, and trader threshold. The launch projector derives progress, distinct traders, and permanent awards from canonical raw logs. Bonding trades use the indexed buyer or seller. Direct v4 swaps use the canonical transaction sender. Known protocol and router contracts do not count as traders.

Awards are unique by chain and token. The reigning King is the newest canonical award ordered by block, transaction index, log index, and token. A reorg rebuilds the projection from canonical logs and removes an award only if its qualifying transaction is no longer canonical.

## Operator checks

- `GET /king-of-forest` returns the policy, reigning token, history, and canonical checkpoint.
- `GET /status` returns `kingOfForestProjectionAsOfBlock`, `kingOfForestAwardCount`, and `currentKingOfForest`.
- `/admin/health` shows projection lag, award count, and current winner without exposing operator credentials.
- The `king-of-forest-projector` checkpoint must not be ahead of the launch projector and must catch up before the launch projector commits its cycle.

## Rebuild acceptance

An isolated schema copy rebuilt the complete testnet history through block 93579188. It reconstructed 69 distinct trader rows across five active launches, populated pool IDs for all 15 launches, and produced no historical awards. This is expected because the activation policy forbids retroactive awards. Once caught up, idle cycles completed in 1.3 to 2.2 ms with no new chain reads per existing launch.

# Schema-19 Mainnet Contingency Playbooks

Status: candidate operations policy. This document becomes active only after an
authorized Schema-19 Mainnet replacement passes deployment verification.

## Safety boundaries

- User trades and holder claims are primary actions. Their bounded maintenance
  attempt is best effort and must not determine whether the primary action
  succeeds.
- Every fee receipt is assigned to holder, creator, DAO, and treasury
  liabilities before any external conversion or settlement call.
- Pending maintenance is not insolvency. It is attributed value waiting for the
  next trade, claim, or permissionless `processRewards(token)` call.
- The Safe may pause launches and conversions and disable routes. It may not
  seize balances, rewrite liabilities, unlock LP principal, or change a launch's
  immutable basket.
- Application transaction disable is the first reversible response to uncertain
  client, API, indexer, or RPC behavior.
- LAN RPC is the only application and transaction upstream. Alchemy is a
  comparison probe and never an automatic fallback.
- Never repeat a confirmed or ambiguous transaction. Reconcile the hash, nonce,
  receipt, and expected state first.

## Severity levels

| Level | Meaning | Default response |
| --- | --- | --- |
| SEV-1 | Contract accounting, solvency, supply, principal, or authorization defect | Disable application transactions, guardian-pause all Schema-19 activity, preserve evidence, and stop |
| SEV-2 | Route, oracle, RPC, or service condition blocks safe new activity without corrupting state | Disable the affected route or submission path and keep unaffected reads and claims available |
| SEV-3 | A deterministic maintenance task is pending or failed while accounting remains conserved | Observe and allow the next user or manual permissionless call to retry |

## Best-effort maintenance failure

Expected signal: the trade or claim receipt succeeds and emits a failed
maintenance result with a normalized reason.

1. Verify the primary balance and liability changes are correct.
2. Verify the scheduler advanced at most one task and did not mark it complete.
3. Classify the failure as route-specific, administrative pause, insufficient
   pending value, or gas exhaustion.
4. Do not refund gas, reclassify fees, or submit a platform-funded retry.
5. Let the next trade, claim, or permissionless `processRewards(token)` call
   resume the same deterministic queue.
6. Escalate to SEV-1 only for accounting drift, duplicate processing, or a
   primary-action failure caused by maintenance.

## Inactive launch with pending work

No user activity means no caller is available to carry routine maintenance.
This is acceptable while all value remains attributed and backed.

1. Display the pending task, age, and attributed balances on the token page and
   health surfaces.
2. Keep claims for already vested rewards available.
3. Permit any caller to invoke `processRewards(token)` at their own cost.
4. Do not create an automatic keeper obligation or spend treasury funds.
5. Escalate only if backing or conservation fails, not because pending work is
   old.

## One basket leg is unavailable

1. Continue healthy legs, trading, claims, creator settlement, DAO settlement,
   and treasury settlement.
2. Confirm the failed leg retains its exact pending native allocation.
3. Count an observation only when the enabled primary route objectively fails
   for stale or paused oracle, inadequate liquidity, protected-quote failure, or
   excessive deviation.
4. Do not count global conversion pause, RPC degradation, insufficient pending
   value, or caller gas limits.
5. Reset the failure history after a successful protected primary quote.
6. Keep the original basket weight unchanged.

## WETH fallback eligibility

Fallback is allowed only after three objective failures separated by at least 24
hours, spanning at least 72 hours, plus a final current route failure.

1. Verify all observation blocks, timestamps, reason classes, and route identity.
2. Verify no successful protected primary quote occurred after the first
   observation.
3. Convert only the currently pending allocation into canonical WETH.
4. Verify previously purchased assets, accrued liabilities, historical rewards,
   and other legs are unchanged.
5. Reset the leg after fallback so the next fee batch retries the immutable
   primary asset.
6. Disable the route and pause conversions if any observation was manufactured
   by an administrative action.

## Route or oracle incident

1. Block new asset selection in the application.
2. Disable the affected onchain route if continued execution is unsafe.
3. Preserve Chainlink round data, heartbeat, pause state, pool identity,
   liquidity, spot/TWAP values, quotes, and failure events.
4. Keep other routes and pull claims available when their accounting is
   independent and healthy.
5. Require current-state fork rehearsal and a separately authorized governance
   operation before changing a pool, cap, liquidity floor, or route.
6. Never add an unqualified intermediary or silently substitute a lookalike
   token.

## LAN RPC degraded, lagging, or unavailable

1. Mark the frontend connection degraded and disable every financial submission.
2. Stop indexer publication if canonical continuity cannot be established.
3. Use Alchemy only for permitted chain ID, synchronization, and block-height
   comparison probes.
4. Do not send application reads or transactions through Alchemy.
5. Re-enable submissions only after LAN chain identity, synchronization, head
   lag, canonical hashes, fee history, calls, estimates, receipts, and logs pass.

## Ambiguous transaction or nonce

1. Stop the affected runner or application submission path.
2. Preserve the intent record, signed hash if available, local nonce, pending
   nonce, and every provider response.
3. Reconcile against canonical chain state through the LAN node.
4. Never automatically replace, resubmit, or reuse the idempotency key.
5. Resume only after the transaction is confirmed failed or a new explicitly
   sealed recovery sequence is authorized.

## Accounting, backing, or supply anomaly

1. Treat as SEV-1 even when the difference is one wei.
2. Disable application transactions and guardian-pause launches, conversions,
   and routes.
3. Preserve balances, liabilities, deposited/vested/claimed totals, rounding
   carry, supplies, allowances, position NFT, and locked principal.
4. Stop all manual processing and claims publication for the affected scope.
5. Rebuild projections from the deployment block and compare direct reads,
   receipts, and event-derived accounting.
6. Do not cap a claim, socialize a loss, move treasury/DAO funds, or redeploy
   until the defect and state consequences are fully understood.

## Application or indexer discrepancy

1. Disable application transactions while retaining a maintenance or read-only
   page.
2. Keep onchain contracts unchanged unless direct reads show a contract issue.
3. Verify the exact signed release, Schema-19 manifest, indexing-policy hash,
   deployment block, tracked launch set, and pool IDs.
4. Rebuild an empty scoped database and require exact equality before promotion.
5. Roll back only to a database-compatible signed release.

## Emergency shutdown verification

After any guardian shutdown, prove:

- application transaction submission is disabled;
- launch mode is Paused;
- both conversion systems are paused;
- every active route is disabled with a recorded reason;
- claims of already vested and backed rewards have the intended availability;
- fixed supplies and locked LP principal are unchanged;
- no residual allowance or unattributed asset exists; and
- every submitted transaction has one unique receipt with no ambiguity.

## Recovery admission

Recovery requires a clean pushed tooling SHA, exact current-state fork rehearsal,
restart-safe intent and receipt journals, positive reserve margin, LAN-only RPC,
and a sealed manifest when an onchain governance or guardian transaction is
needed. Public activation, route replacement, bridging, and contract deployment
remain separate authorization boundaries.

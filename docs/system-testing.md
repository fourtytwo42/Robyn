# Robyn exhaustive system testing

## Completion standard

"Every combination" is not a finite claim for arbitrary calldata and action
sequences. Robyn therefore uses an auditable finite model:

1. Every product-owned public write function and every user-visible action is
   exercised on its success path.
2. Every action is crossed with applicable roles, authentication/network
   states, lifecycle phases, and boundary values.
3. Pairwise action ordering covers stateful interactions; high-risk workflows
   receive explicit longer sequences.
4. Fuzzing and invariant handlers explore values and sequences that are not
   practical to enumerate.
5. Adversarial, concurrency, keeper-race, restart/rebuild, and dependency
   failure paths are tested.
6. Browser acceptance proves the same user journeys in the built application.

No release may be described as exhaustively tested while a required row is
skipped, flaky, or represented only by a mock that removes the behavior being
claimed.

## Coverage dimensions

| Dimension | Required values |
|---|---|
| Wallet | disconnected, canonical creator, holder, nonholder, DAO member, nonmember, guardian, wrong chain, rejected transaction |
| Launch | invalid request, predicted, atomic success, duplicate salt, pool precreation, concurrent launch |
| Market | unseeded, bonding, near graduation, exact graduation boundary, graduated |
| Trade | buy, sell, zero, below minimum, exact balance, insufficient balance, stale quote, slippage, concurrent submissions |
| Fees | bonding base fee, LP quote fee, LP launch-token fee, pending conversion, partial conversion, paused, retry, converted |
| Rewards | before holding, while holding, after transfer, single claim, claim all, failed receiver, no reward |
| Creator | one token, multiple tokens, individual claim, batch claim, claim-to, foreign token, zero balance |
| DAO | transfer, permit, delegation, proposal threshold, pending, active, defeated, succeeded, queued, executed, canceled, expired |
| Identity/media | nonce, replay, domain/chain mismatch, session expiry/logout, profile validation, upload validation, bind, report, quarantine/fallback |
| Operations | index lag, rebuild, keeper duplicate/race/retry, Redis/Postgres outage, RPC rejection, service restart, backup/restore |
| Viewport/input | desktop, tablet, 390x844, pointer, keyboard, reduced motion |

## Real-use simulation

`scripts/simulate-real-use.sh` is deterministic and fail-closed. Its contract
phase models 256 EOAs, eight creators' launches, bonding and DEX trading,
graduation, both reward systems, creator batch claims, 100 delegated voters,
and timelock execution. Its HTTP phase uses 256 stable virtual-client identities
at configurable concurrency against the built VM services.

The simulation produces raw logs, JSON metrics, and SHA-256 checksums below
`evidence/system-simulation/<UTC run id>/`. The live shared devnet is read-only
during the HTTP phase; all contract mutations run inside Foundry's isolated EVM.
The HTTP gate snapshots the five participating PM2 processes before and after
the run and fails if any process restarts, disappears, or leaves the online
state, even when every individual HTTP response succeeds.

The higher-scale acceptance profile is 512 virtual clients, 150 requests per
second, 256 concurrent requests, and 120 seconds. An initial run exposed two
web restarts at the previous 512 MiB PM2 ceiling. The production and preview
web budgets are now 1 GiB on the 8 GiB VM; all backend budgets remain bounded
at 256 or 384 MiB.

## Current automated matrix

The schema-v4 contract suite currently contains 70 passing tests, including four
128-run, depth-64 stateful invariants. Dedicated matrices cover:

- atomic launch rollback, duplicate salts, pool precreation, coordinator
  authorization, pause authority, and exact supply custody;
- 256 actors across eight launches plus 100 delegated voters;
- RDAO permit, delegation by signature, replay/expiry, transfer-aware native
  rewards, exclusions, and fixed-supply constraints;
- governance threshold, quorum, for/against/abstain validation, double-vote
  rejection, queue, early-execution rejection, guardian cancellation, and
  timelock execution;
- native conversion authorization, deadline, pool availability, TWAP
  deviation, price impact, caller minimum, recipient/asset validation, measured
  balance deltas, and allowance cleanup;
- all 64 public API read/write/validation cases, including a real ephemeral
  SIWE signature, authenticated profile update, sanitized media upload/read/
  report, logout, and session invalidation.

`scripts/test-api-surface.mjs` defaults to the same-origin LAN Nginx API route
so SIWE request Host and Origin match exactly. Override both values together
when testing another trusted origin:

```bash
ROBYN_API_TEST_URL=http://192.168.50.250:3000/api \
ROBYN_API_TEST_AUTH_ORIGIN=http://192.168.50.250:3000 \
node scripts/test-api-surface.mjs
```

## Built-browser acceptance checkpoint

The Codex in-app browser completed the production-build journeys against
`http://192.168.50.250:3000` on 2026-07-23:

- created, funded, traded, converted, and claimed with a fresh session wallet;
- searched and filtered Markets, watched a token, and exercised Price/Volume
  and time-range chart controls;
- bought through the bonding threshold, verified automatic locked-liquidity
  graduation, then bought and sold through the graduated pool;
- launched two new tokens atomically, proved SIWE wallet ownership, edited the
  creator profile, rejected an invalid 99 percent basket, and verified launch
  completion cannot accidentally submit a duplicate;
- accrued and claimed token-specific creator rewards, then claimed two tokens
  in one Portfolio batch transaction;
- claimed RDAO rewards, delegated 120 million votes, proposed, voted, proved
  early execution fails, queued after three days, and executed after the
  two-day timelock;
- verified Treasury, Members, Activity, and proposal detail views;
- verified the token mobile trade sheet, discard confirmation, backward focus
  wrapping and opener focus restoration, plus keyboard chart-point movement;
- verified no horizontal overflow and nonzero headings at 390 by 844 and 768
  by 1024 on Home, Markets, Portfolio, DAO, Create, and token detail;
- cleared the wallet and proved token creator controls and Portfolio financial
  state disappear while public market data remains accessible.

The browser console remained empty after the tested journeys. Seed transfers
and EVM time advancement were controlled local-test preparation only; all
product actions were submitted through the served UI.

The standard Foundry coverage reporter is not a release gate in this repository:
the non-IR mode cannot compile the production-shaped coordinator because of
stack depth, while the `--ir-minimum` source analyzer cannot resolve pnpm-linked
OpenZeppelin relative imports. The fail-closed action manifest and explicit
test-to-action evidence are used instead; normal optimized compilation and
tests remain mandatory.

Run:

```bash
scripts/simulate-real-use.sh
```

Useful scale controls:

```bash
LOAD_DURATION_SECONDS=300 \
LOAD_REQUESTS_PER_SECOND=250 \
LOAD_CONCURRENCY=256 \
LOAD_VIRTUAL_USERS=512 \
scripts/simulate-real-use.sh
```

## Evidence rule

Passing tests are necessary but not sufficient. The final audit binds:

- exact Git commit and deployment manifest;
- contract/service test output;
- invariant and fuzz configuration;
- simulation workload and metrics;
- browser screenshots, DOM assertions, transactions, and console state;
- indexer/keeper reconciliation;
- optimized build hashes and served-release identity;
- restart and backup/restore results;
- all known limitations and externally blocked testnet-only checks.

# Robyn exhaustive system testing

## Completion standard

“Every combination” is not a finite claim for arbitrary calldata and action
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
phase models 256 EOAs, eight creators’ launches, bonding and DEX trading,
graduation, both reward systems, creator batch claims, 100 delegated voters,
and timelock execution. Its HTTP phase uses 256 stable virtual-client identities
at configurable concurrency against the built VM services.

The simulation produces raw logs, JSON metrics, and SHA-256 checksums below
`evidence/system-simulation/<UTC run id>/`. The live shared devnet is read-only
during the HTTP phase; all contract mutations run inside Foundry’s isolated EVM.

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

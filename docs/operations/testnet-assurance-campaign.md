# Testnet assurance campaign

The Sherwood Forest assurance campaign is a one-shot, resumable operator
workflow. It does not create a timer, scheduled task, recurring Codex
automation, or daemon.

## Security model

- The campaign derives exactly 100 deterministic actor wallets from one random
  32-byte root.
- The root is encrypted with AES-256-GCM and scrypt. The encryption passphrase
  is read from a separate mode-0600 VM file.
- `state.json` and `evidence.json` contain actor addresses and transaction
  evidence, never private keys, the root, the passphrase, or project-wallet
  credentials.
- The project deployer is loaded only from the protected Foundry keystore.
  Plain private-key rehearsal input is accepted only with `--rehearsal` and a
  loopback RPC URL.
- Live preflight requires chain 46630, schema v8, a clean exact
  `origin/main`/manifest release, runtime code at every required contract, 25%
  execution and Nitro L1-data headroom, the complete recovery sweep, and the
  fixed 0.0015 ETH reserve. It also requires at least 5 GiB free on the state
  filesystem before funding begins.
- A loopback rehearsal may supply `--gas-price-wei` and
  `--l1-base-fee-wei` when Anvil pricing differs from Robinhood Testnet or an
  old fork cannot retrieve the Nitro fee-estimator trie node. Overrides are
  rejected for every non-loopback or non-rehearsal invocation; live testnet
  always reads both prices from the chain.

## Operator phases

Use a unique lowercase campaign ID. The normal state directory is
`~/.local/state/robyn-testnet-campaigns/<campaign-id>`.

```bash
export ROBYN_CAMPAIGN_ID=schema8-assurance-YYYYMMDD
export ROBYN_CAMPAIGN_PASSPHRASE_FILE=/etc/robyn/campaign-passphrase
export ROBYN_CAMPAIGN_MANIFEST=/home/hendo420/Robyn/deployments/46630-v4.json
export ROBYN_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com

pnpm campaign:testnet init
pnpm campaign:testnet preflight
pnpm campaign:testnet fund
pnpm campaign:testnet launches
pnpm campaign:testnet trading
pnpm campaign:testnet conversions
pnpm campaign:testnet governance
pnpm campaign:testnet claims
pnpm campaign:testnet fill
pnpm campaign:testnet sweep
pnpm campaign:testnet status
```

`init` refuses to overwrite an existing campaign. `fund` requires a recorded
passing preflight and journals every confirmed transaction before continuing.
It funds the actors through a binary tree and is safe to resume because labels
are unique and already-confirmed labels are skipped.

`launches` authenticates each creator with SIWE, uploads sanitized artwork,
prepares campaign-tagged immutable IPFS metadata, submits one atomic launch,
derives identity only from the coordinator receipt, waits for index visibility,
and immutably binds the preparation. A fixed metadata URI may replace the API
pipeline only on an explicitly marked loopback rehearsal.

`trading` executes 900 quote-bounded buys, 200 token transfers, 150 approvals,
150 sells, three graduations, five distinct bonding states, bidirectional
direct-v4 swaps, and an expected slippage rejection. `conversions` harvests the
three locked positions, routes their native and launch-token fees, exercises
all 24 unique basket routes, and proves a failed minimum-output request can be
retried safely. `governance` distributes and delegates test RDAO, exercises a
successful, defeated, and cancelled proposal, all three vote choices, rejection
cases, queueing, and timelock execution. `claims` proves 20 holder claims, eight
token-specific creator claims, ten transfer-aware RDAO claims, and a foreign
creator rejection.

`fill` counts product writes separately from funding and adds real token
transfers only if fewer than 1,510 product transactions have succeeded. `sweep`
returns campaign ERC-20, RDAO, and recoverable ETH balances to the project
wallet while recording unavoidable dust and enforcing the hard reserve. Native
sweeps reserve their fee from the same preflight-frozen execution and Nitro L1
prices used for submission, plus 25% headroom. The
`all` command resumes the complete ordered workflow and skips every confirmed
label. Submitted transaction hashes are journaled before receipt waiting so an
interrupted process resumes the same hash rather than broadcasting a duplicate.

The funding projection includes every planned payable action, not merely the
three graduation thresholds. It prices 2,600 transactions and assigns each
actor a dedicated sweep-gas budget for up to eight launch-token transfers, one
RDAO transfer, and one native transfer. Every phase remains a release gate and
must pass an exact-release isolated rehearsal before live use is authorized.

## Schema-v8 promotion endurance

The schema-v8 public release has a separate one-shot endurance runner. It uses
the same encrypted 100-wallet campaign root without writing private keys to Git,
logs, status responses, or evidence.

```bash
cd /home/hendo420/Robyn
sudo scripts/install-testnet-endurance.sh schema8-endurance-YYYYMMDD
sudo systemctl start robyn-testnet-endurance.service
systemctl status robyn-testnet-endurance.service --no-pager
```

The unit is static and is never enabled. The runner:

- signs locally and sends only through Robinhood's public chain-46630 RPC;
- samples application, RPC, index, queue, accounting, disk, memory, IPFS, and
  alert health every 30 seconds;
- performs operator-grade verifier reviews every 20 minutes;
- journals transaction hashes before receipt polling so recovery never
  rebroadcasts a known transaction;
- runs bounded writes every ten minutes and launches four campaign-labeled
  immutable-IPFS tokens near healthy hours 0, 2, 4, and 6;
- pauses the healthy clock during a failed sample or remediation and resumes
  from the durable state file; and
- seals append-only evidence and SHA-256 checksums after eight accumulated
  healthy hours.

The protected status view is `GET /api/operator/endurance` with the existing
operator bearer token. It returns run identity and health state, never wallet
keys or credentials.

Evidence lives under `/var/lib/robyn/testnet-endurance/<run-id>/`. A segmented
run is not described as uninterrupted. Each release SHA and failed/remediated
segment remains explicit in the evidence.

This release deliberately waives new backup creation, isolated restore, and
restore drills. That waiver must remain visible in final acceptance evidence.

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
  execution and Nitro L1-data headroom, and the fixed 0.0015 ETH reserve.

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
pnpm campaign:testnet status
```

`init` refuses to overwrite an existing campaign. `fund` requires a recorded
passing preflight and journals every confirmed transaction before continuing.
It funds the actors through a binary tree and is safe to resume because labels
are unique and already-confirmed labels are skipped.

The transaction-execution phases for launches, trading, conversions, claims,
governance, final write-count filling, and residual sweeping are release gates
and must be present and pass an isolated rehearsal before the live campaign is
authorized. Until then, the operator must not use the foundation commands to
claim that the public campaign is complete.


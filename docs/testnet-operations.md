# Robinhood Chain Testnet operations

Status: deployment package and isolated local rehearsal implemented; no public testnet transaction has been authorized

Last verified: 2026-07-21

## Boundary

Robinhood Chain Testnet uses chain ID `46630` (`0xb626`). The checked-in default RPC is `https://rpc.testnet.chain.robinhood.com` and the explorer is `https://explorer.testnet.chain.robinhood.com/`. The public RPC, chain ID and explorer were rechecked on 2026-07-21.

The current package deliberately deploys testnet mock base/reward assets, a deterministic conversion router and a fixed-price market because no official public testnet Stock Token registry or faucet has been located. These contracts expose `TESTNET_MOCK_ONLY = "robinhood-testnet-mock"`. They are rehearsal infrastructure, not representations of stocks, ETFs, issuer instruments or real prices.

Actual public-testnet broadcast is a separate authorized operation. It requires funded testnet ETH and a protected operator keystore. Never copy a development private key into an environment file, PM2 configuration, Git, shell history or deployment manifest.

## Files

| File | Purpose |
|---|---|
| `config/networks/robinhood-testnet.json` | Canonical chain, RPC, explorer, mock strategy and bundle policy |
| `packages/contracts/src/testnet/` | Explicitly labeled mock assets, conversion router and market |
| `scripts/deploy-testnet.sh` | Chain-locked deployment with fail-closed broadcast and key policy |
| `scripts/verify-testnet-deployment.sh` | Bytecode, binding, basket, marker and configuration verification |
| `scripts/rehearse-testnet.sh` | Full claim, buy, three-leg convert, claim and sell journey |
| `scripts/build-testnet-candidate.sh` | Protected Next.js build and forbidden-marker scan |
| `scripts/rehearse-testnet-stack.sh` | Five-service isolated database/queue/indexer/keeper/web rehearsal |
| `infrastructure/pm2/ecosystem.testnet.config.cjs` | Separate testnet process names, ports, database, Redis DB and queue |

## Local chain-46630 rehearsal

The transaction journey starts a clean loopback Anvil, deploys the exact package, verifies every relationship, uses a second account, and exercises faucet, buy, all three conversions, claim-all and sell:

~~~bash
cd /home/hendo420/Robyn
scripts/rehearse-testnet.sh
~~~

The service rehearsal additionally builds and starts isolated `-testnet` PM2 processes on loopback ports, resets only the dedicated `robyn_testnet_rehearsal` database, waits for indexing, lets the restricted-key keeper convert all three legs, verifies rewards, removes the rehearsal processes, resets the rehearsal schema and proves the live devnet health was preserved:

~~~bash
scripts/rehearse-testnet-stack.sh
~~~

The database is preprovisioned natively in PostgreSQL and owned by the unprivileged operator. The operator has no general database-creation privilege. No Docker service is involved.

Both rehearsals are mandatory gates in `scripts/build-release.sh`; their JSON summaries are retained as `release-evidence/testnet-journey.json` and `release-evidence/testnet-stack.json`.

## Browser acceptance

Conversion controls are keeper-race safe: they re-read the leg before submitting and, after an error, suppress it only when a second read proves the keeper already consumed the pending principal. Any error with executable principal still pending is rethrown.

On 2026-07-21 the in-app browser verified the protected chain-46630 home, explicit mock disclosures, no-injected-wallet failure state, one-launch registry, anonymous discovery, canonical detail, portfolio no-wallet state, zero console warnings/errors and a 390 by 844 responsive layout without horizontal overflow. CLI signed transactions remain the transaction evidence because the in-app browser has no injected wallet; the protected UI correctly refuses to invent or bundle one.

## Protected web build

~~~bash
ROBYN_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com \
ROBYN_TESTNET_DATA_API_URL=https://testnet-api.example.invalid \
ROBYN_TESTNET_BUILD_OUTPUT=/tmp/robyn-testnet-candidate \
  scripts/build-testnet-candidate.sh /protected/path/46630.json
~~~

The build selects testnet modules at compile time. It requires injected-wallet calls and chain `0xb626`, and rejects any bundle containing devnet markers, generated session keys, faucet routes or deterministic development-wallet code. Browser traffic uses the user's injected provider for signed transactions and may use the public RPC for reads. The API/indexer/keeper remain correctness dependencies and use separately configured backend RPC access.

For LAN-only rehearsal, set the public data API URL to the LAN edge actually exposed to the browser. For internet/public operation, use same-origin TLS routing; do not expose the raw loopback service port.

## Real public-testnet deployment

Prerequisites:

- exact candidate commit is clean and pushed to `origin/main`;
- release gates and the uninterrupted 24-hour controlled-devnet soak pass;
- a funded operator account is available as an encrypted keystore;
- keystore and password files are owner-only and outside the repository/release tree;
- current official RPC, explorer, chain ID, mock/canonical asset decision and funding route are rechecked;
- monitoring, backup, rollback and incident ownership are assigned; and
- the user explicitly authorizes broadcast.

Simulate/readiness-check first without the broadcast flag. For the authorized broadcast:

~~~bash
ROBYN_TESTNET_BROADCAST=true \
ROBYN_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com \
ROBYN_TESTNET_KEYSTORE=/protected/path/operator-keystore.json \
ROBYN_TESTNET_PASSWORD_FILE=/protected/path/operator-password \
ROBYN_TESTNET_MANIFEST=/protected/path/46630.json \
  scripts/deploy-testnet.sh

ROBYN_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com \
  scripts/verify-testnet-deployment.sh /protected/path/46630.json
~~~

The deployer refuses the wrong chain, unlocked-account operation on a real endpoint, a dirty/unpushed repository, or missing explicit broadcast authorization. The resulting manifest contains addresses and transaction metadata, never a private key.

## Runtime isolation and rollback

Testnet processes use suffix `-testnet`, web/API/keeper ports `3012/3111/3210`, PostgreSQL database `robyn_testnet_rehearsal` for local rehearsal, Redis database 1 and queue `robyn-conversions-testnet`. A real testnet runtime must use a separately named persistent database and protected service environment, not the rehearsal database.

Rollback stops and deletes only the five testnet PM2 processes, preserves devnet processes, and retains the deployment manifest/evidence. Onchain contracts and completed transactions cannot be rolled back; incident response must pause external routing where supported, stop the keeper and publish the affected addresses.

## Remaining external gates

- Public testnet ETH funding route.
- Recheck for canonical testnet Stock Token, ETF, stablecoin, registry and oracle addresses.
- Human alert receiver for unattended operation.
- Independent contract security review before any real-value asset use.
- TLS and a stable hostname before access leaves the trusted LAN.
- Legal/issuer confirmation before substituting restricted Stock Tokens for mocks.

These are not permission to weaken the local package. Mocks remain visibly labeled until canonical integrations are verified.

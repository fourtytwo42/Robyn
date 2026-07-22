# Robinhood Chain Testnet operations

Status: funded persistent deployer and no-broadcast readiness verification passed; public-testnet deployment still requires explicit authorization

Last verified: 2026-07-22

## Boundary

Robinhood Chain Testnet uses chain ID `46630` (`0xb626`). The checked-in default RPC is `https://rpc.testnet.chain.robinhood.com` and the explorer is `https://explorer.testnet.chain.robinhood.com/`. The public RPC, chain ID and explorer were rechecked on 2026-07-21.

The current package deliberately deploys testnet mock base/reward assets, a deterministic conversion router and a fixed-price market because no canonical testnet Stock Token registry has been validated for application integration. Robinhood now operates an official faucet that advertises 0.01 testnet ETH plus five testnet units each of TSLA, AMZN, PLTR, NFLX, and AMD per eligible daily request. Faucet availability does not establish canonical contract provenance for Robyn. The package contracts expose `TESTNET_MOCK_ONLY = "robinhood-testnet-mock"`; they are rehearsal infrastructure, not representations of stocks, ETFs, issuer instruments or real prices.

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

### Persistent deployer wallet

The dedicated testnet-only deployer address is `0xecc5d6d032ADc9ca9E0F4042128067b8366da17A`. Its encrypted Foundry keystore, separately permissioned password, public address, and non-secret environment pointers live under:

~~~text
/home/hendo420/.config/robyn/wallets/robinhood-testnet-deployer/
~~~

An age-encrypted recovery archive and checksum live under:

~~~text
/home/hendo420/.local/share/robyn-wallet-backups/
~~~

Both directories and all operational secret files are owner-only. The recovery archive was decrypted into an isolated temporary directory and reproduced the same public address. The encrypted archive and checksum were also uploaded to the private `fourtytwo42/Robyn` GitHub release `robyn-state-backups`; a fresh download matched SHA-256 `22f901854fd9f39e6cf09d21dcc9acec3245cabd4d1c6aade9cc6be54c4afed8` and independently restored the same address. Never display, commit, copy into PM2, or place in shell history the keystore password, decrypted key, or recovery contents. This is a disposable testnet wallet and must never receive real assets.

Check the wallet identity, permissions, chain, and public balance without exposing secrets:

~~~bash
cd /home/hendo420/Robyn
scripts/check-robinhood-testnet-wallet.sh
~~~

The official funding route is [Robinhood Chain Testnet Faucet](https://faucet.testnet.chain.robinhood.com/). Its browser security checkpoint and any CAPTCHA or eligibility step must be completed interactively; do not bypass or automate those controls. Last verified 2026-07-22, the official RPC and Robinhood Blockscout API both reported a 0.01 ETH deployer balance after one faucet request.

An isolated full-bundle measurement deployed all contracts and completed initialization in 20 transactions using 15,352,146 gas. At the live 2026-07-22 public-testnet gas price of 10,000,000 wei, that is 0.00015352146 ETH of execution cost. One advertised 0.01 ETH faucet claim therefore provides about 65 times the measured execution-only requirement. Arbitrum L1 data fees are not reproduced by local Anvil, so retain the remaining balance for that overhead and repeated tests rather than treating it as disposable. Funding is considered sufficient when the official RPC confirms the full 0.01 ETH claim.

Run the complete no-broadcast readiness check before authorizing deployment. It verifies the wallet identity and permissions, official chain and balance, clean/pushed Git state, contract build and marker policy, and a fresh isolated gas measurement:

~~~bash
cd /home/hendo420/Robyn
scripts/check-robinhood-testnet-deployment-readiness.sh
~~~

The default readiness floor is 0.005 ETH, more than 32 times the measured execution-only requirement at the current gas price. Override it only by increasing `ROBYN_TESTNET_MIN_DEPLOYER_BALANCE_WEI`; never lower the committed floor to force a pass.

Last verified 2026-07-22, the no-broadcast checker passed from clean, pushed `main` with 0.01 ETH, 65 times measured execution-only headroom, and no public transaction. The actual encrypted keystore then deployed and verified the complete 20-transaction package on an isolated temporary chain-46630 instance using `ROBYN_TESTNET_KEYSTORE` and `ROBYN_TESTNET_PASSWORD_FILE`. This proves the real signer/configuration path without spending testnet funds. A public deployment remains a separate irreversible action requiring explicit user authorization.

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

- Preserve at least the 0.005 ETH readiness floor in the dedicated deployer wallet until deployment and testnet acceptance are complete.
- Recheck for canonical testnet Stock Token, ETF, stablecoin, registry and oracle addresses.
- Human alert receiver for unattended operation.
- Independent contract security review before any real-value asset use.
- TLS and a stable hostname before access leaves the trusted LAN.
- Legal/issuer confirmation before substituting restricted Stock Tokens for mocks.

These are not permission to weaken the local package. Mocks remain visibly labeled until canonical integrations are verified.

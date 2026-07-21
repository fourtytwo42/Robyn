# Controlled devnet operations

Status: Implemented foundation; not yet a public production environment
Last verified: 2026-07-21

## Live topology

| Component | Listener | Supervisor | Persistence |
|---|---|---|---|
| Robyn web | 0.0.0.0:3000 | PM2 through pm2-hendo420.service | Saved PM2 process list |
| Restricted RPC and faucet | 0.0.0.0:8546 | PM2 through pm2-hendo420.service | Process restarts; rate windows are currently memory-only |
| Raw privileged Anvil RPC | 127.0.0.1:8545 | robyn-anvil.service | /var/lib/robyn/anvil/state.json every five seconds and on clean exit |

The raw RPC is loopback-only. LAN users and browser wallets use the restricted gateway. Docker is not involved.

## User network

- Name: Robyn Devnet
- Chain ID: 31337
- User RPC: http://192.168.50.250:8546
- Faucet: POST http://192.168.50.250:8546/faucet
- Web: http://192.168.50.250:3000
- Native currency: development ETH with no real-world value

The faucet accepts a JSON object with an address field. It raises a low balance to exactly 10 dev ETH. The same address is limited to one successful request per hour and a source IP is limited to five requests per hour. Failed upstream attempts release their quota reservation.

## RPC policy

The allowlist lives in apps/rpc-gateway/src/app.ts. It permits bounded standard read methods and eth_sendRawTransaction. Everything else fails closed with JSON-RPC error -32601.

Unavailable classes include anvil, evm, hardhat, debug and trace methods; impersonation; unsigned node-managed transactions; snapshot/revert; arbitrary state mutation; and administrative, personal, miner and txpool surfaces.

The gateway limits request bodies to 256 KiB and batches to 20 entries. It sets no-store, CORS and nosniff response headers. Raw RPC access is used only by the local faucet and operator tooling.

## Installation and operation

Install or update the pinned Anvil service:

~~~bash
cd /home/hendo420/Robyn
sudo bash scripts/install-anvil-service.sh
~~~

Build and start Node processes:

~~~bash
cd /home/hendo420/Robyn
pnpm install --frozen-lockfile
pnpm build
pnpm exec pm2 start infrastructure/pm2/ecosystem.config.cjs --update-env
pnpm exec pm2 save
~~~

The generated pm2-hendo420.service is enabled and resurrects the saved process set. Regenerate it after an intentional PM2 path or version change.

Routine checks:

~~~bash
systemctl is-active robyn-anvil.service
systemctl is-active pm2-hendo420.service
pnpm exec pm2 status
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:8546/health
cast chain-id --rpc-url http://127.0.0.1:8546
~~~

Expected chain ID is 31337. The web page must show robyn-devnet and RPC gateway status ok on chain 31337.

## State and security

- Anvil runs as the non-login robyn system user.
- The state directory is owned by robyn:robyn with mode 0750.
- state.json is mode 0600.
- The unit uses ProtectSystem=strict, ProtectHome=true, NoNewPrivileges=true, private devices/tmp and one writable state path.
- The root-owned service binary is /usr/local/bin/anvil.
- Do not commit Anvil state, PM2 dumps, logs, private keys or development account material.

## Verification completed

The 2026-07-21 checkpoint verified:

- raw RPC listens only on loopback;
- user RPC and web listen on the VM interface;
- standard chain and balance calls pass;
- privileged state mutation through the user gateway is rejected without balance change;
- the faucet sets a new address to 10 dev ETH and an immediate repeat returns HTTP 429;
- LAN access to port 8545 fails while port 8546 succeeds;
- CORS preflight returns HTTP 204 with POST and content-type allowed;
- Anvil state survives a controlled systemd restart;
- a full VM reboot restores Anvil, the saved PM2 applications, web and gateway health with the funded balance unchanged; and
- in-app-browser DOM and console checks show recovered RPC status ok on chain 31337.

## Protocol deployment

The canonical controlled-devnet manifest is deployments/31337.json. It contains public contract addresses only and no signing material.

Deploy or verify from the VM:

~~~bash
cd /home/hendo420/Robyn
scripts/deploy-devnet-protocol.sh
scripts/verify-devnet-deployment.sh deployments/31337.json
~~~

Deployment uses the first Anvil unlocked account through loopback operator RPC. No private key is exported or stored. The deployment script refuses every chain ID except 31337 and returns the existing verified deployment unless ROBYN_FORCE_DEPLOY=true is explicitly set.

The verifier checks:

- bytecode at every declared address;
- factory, token, vault, router and market cross-links;
- chain ID and immutable market fee/price policy;
- sealed market exclusion and basket asset order; and
- live accounting conservation after both unused and actively traded states.

Devnet-only contracts under packages/contracts/src/devnet must never appear in a Robinhood testnet manifest. Testnet release checks will reject the DEVNET_ONLY marker and controlled-chain identifiers.

Last verified 2026-07-21: the current manifest records the self-service-market deployment created at block 74 from commit d31c68f. Its mock base token gives each address one 10,000 mUSD claim while reward-asset faucets remain disabled. Manifest bytecode, launch/market factory links, exclusion state, base-faucet policy and accounting verification pass against the live chain.

## Remaining production-readiness work

- Move faucet limits from process memory to native Redis before untrusted public exposure.
- Configure TLS/reverse proxy and explicit firewall policy.
- Promote immutable releases instead of running from the checkout.
- Add generation/reset tooling and off-VM state backup.
- Add gateway load/soak tests, structured metrics and alerts.
- Extend the verified session-wallet genesis trade/convert/claim journey to permissionless user-created launches, discovery and token detail pages.

These gaps keep the active production-readiness goal open.

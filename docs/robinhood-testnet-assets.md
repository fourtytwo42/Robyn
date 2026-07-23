# Robinhood Testnet asset and deployment operations

Last verified: 2026-07-23

## Current external facts

- Robinhood Testnet is chain `46630`, uses ETH, and publishes the RPC and explorer in `config/networks/robinhood-testnet.json`.
- The official faucet is `https://faucet.testnet.chain.robinhood.com`.
- Robinhood's official `/rhj/assets` response currently contains no Stock Token deployment for chain `46630`; the committed references resolve on chain `4663`.
- Uniswap's official deployment registry currently has no chain-46630 entry.

These facts are rechecked by deployment scripts and can drift.

## Candidate architecture

- Controlled devnet remains chain `31337` on LAN.
- Public testnet uses PM2 names ending in `-testnet`, ports `3012`, `3111`, and `3210`, PostgreSQL database `robyn_testnet`, Redis DB 1, queue `robyn-conversions-testnet`, and a schema-v6 manifest.
- Public HTTPS reaches named Cloudflare Tunnel, loopback Nginx `3081`, then testnet web/API. There is no public VM RPC proxy.
- `scripts/start-testnet-api.sh` loads remote-pin credentials only from `/etc/robyn/testnet-api.env`; PM2 receives paths and non-secret settings only.

## Catalog and routing

`config/assets/robinhood-testnet-curated.json` is the reviewed 23-asset stock-style snapshot. Deployment adds WETH from the Robyn-controlled test DEX as asset 24.

Each fixed test route is prefunded and becomes unavailable if paused or depleted. A V3 route is ready only when the pool exists, has minimum liquidity, has usable TWAP history, and spot/TWAP deviation is within the configured bound. The atomic coordinator calls the factory's route check before creating any contract.

The API caches resolved chain metadata and route state for 20 seconds to protect the operator RPC. Manual contracts are classified by chain plus address, not symbol. Unknown artwork is never accepted.

## No-broadcast verification

```bash
cd /home/hendo420/Robyn
scripts/check-robinhood-testnet-asset-provenance.sh
scripts/rehearse-testnet.sh
scripts/rehearse-testnet-stack.sh
scripts/measure-robinhood-testnet-deployment-gas.sh
```

The 2026-07-23 isolated result used 112 transactions and 100,625,488 execution gas. At the then-current testnet gas price, execution plus the conservative uncompressed Nitro L1-data upper bound was approximately `0.001182601277067904 ETH`. This is a point-in-time estimate; the readiness gate repeats it and requires 25 percent headroom.

## Required external inputs

The following values are intentionally absent and block broadcast:

1. A real 32-character Reown/WalletConnect project ID.
2. The stable HTTPS origin registered to that project.
3. `/etc/cloudflared/robyn-testnet.yml` for the named tunnel, routing that hostname to `http://127.0.0.1:3081`.
4. `/etc/robyn/testnet-api.env` containing remote IPFS Pinning Service API URL/token.
5. A reviewed RDAO allocation manifest with actual member wallets and shares totaling 10,000 bps, including the timelock reserve.

`scripts/check-testnet-external-inputs.sh` fails closed until all five exist. Rehearsal placeholders can never pass the real broadcast gate.

## Broadcast phases

After the exact commit is clean and pushed to `origin/main`, and only after all gates pass:

1. Run the external-input, asset-provenance, wallet, gas, protected-build, DEX, IPFS, and release checks.
2. Explicitly deploy the pinned test-only V3 suite if no official chain-46630 registry entry exists.
3. Verify and freeze its manifest.
4. Deploy protocol schema v6 with the encrypted testnet signer.
5. Verify all code, wiring, 24 routes, genesis receipt identity, exclusions, DAO allocation, and immutable metadata.
6. Start isolated PM2 processes and named tunnel; save PM2.
7. Complete wallet and real-transaction browser acceptance.

No command or authorization in this run permits Robinhood mainnet deployment.

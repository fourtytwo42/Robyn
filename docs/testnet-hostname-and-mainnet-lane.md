# Testnet hostname and mainnet release lane

## Public routing

- `testnet.sherwoodforest.trade` is the only public application hostname and routes through the remotely managed Cloudflare Tunnel to `127.0.0.1:3081`.
- `sherwoodforest.trade` and `www.sherwoodforest.trade` route to the static holding origin on `127.0.0.1:3082`. The holding origin exposes only `/`; all application and API paths return 404.
- Cloudflare Zero Trust Public Hostnames are authoritative because `cloudflared.service` runs with `/etc/cloudflared/token`. The unused local ingress file must not be treated as live routing state.

## Environment separation

Testnet uses its own immutable release, deployment manifest, PostgreSQL database, Redis namespace, PM2 processes, wallet metadata, and host-only authentication cookies. The future mainnet deployment will receive a separate set of each. No chain-connected mainnet service is started before mainnet contracts pass their independent review and deployment gates.

Feature work is promoted to testnet first. After acceptance, the exact commit may be tagged as a mainnet candidate; production activation still requires an explicit mainnet deployment and review.

## Mainnet RPC topology

The inactive Mainnet process set is configured to use the loopback gateway at
`http://127.0.0.1:18549`. The gateway designates
`http://192.168.50.173:8547` as its LAN primary and the protected Alchemy
Mainnet endpoint as comparison and failover.

- Both providers must return chain ID `4663`.
- The gateway compares provider heads every 30 seconds.
- It routes to Alchemy when the LAN endpoint is unreachable, on the wrong
  chain, or more than 50 blocks behind.
- It returns to LAN only after two consecutive probes within 10 blocks.
- Filtered Alchemy WebSocket subscriptions remain an indexer wake mechanism;
  canonical HTTP reads go through the gateway.
- Mainnet gateway state is persisted separately at
  `/var/lib/robyn/mainnet-rpc-gateway/status.json`.
- Protected configuration uses `ROBYN_MAINNET_PRIMARY_RPC_URL` for LAN,
  `ROBYN_MAINNET_SERVER_RPC_URL` for Alchemy HTTP, and
  `ROBYN_MAINNET_WS_RPC_URL` for Alchemy WebSocket.

This topology is configuration only. It does not start the Mainnet application,
deploy contracts, or authorize Mainnet transactions. A LAN node that is
reachable but outside the lag boundary is not eligible to carry application
traffic.

## Cloudflare public hostnames

Configure the existing tunnel with these routes:

1. `testnet.sherwoodforest.trade` to `http://127.0.0.1:3081`.
2. `sherwoodforest.trade` to `http://127.0.0.1:3082`.
3. `www.sherwoodforest.trade` to `http://127.0.0.1:3082`.

Keep the old apex-to-application route until the testnet hostname passes HTTPS acceptance, then switch the apex and `www` routes to the holding origin.

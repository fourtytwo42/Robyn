# Testnet hostname and mainnet release lane

## Public routing

- `testnet.sherwoodforest.trade` is the only public application hostname and routes through the remotely managed Cloudflare Tunnel to `127.0.0.1:3081`.
- `sherwoodforest.trade` and `www.sherwoodforest.trade` route to the static holding origin on `127.0.0.1:3082`. The holding origin exposes only `/`; all application and API paths return 404.
- Cloudflare Zero Trust Public Hostnames are authoritative because `cloudflared.service` runs with `/etc/cloudflared/token`. The unused local ingress file must not be treated as live routing state.

## Environment separation

Testnet uses its own immutable release, deployment manifest, PostgreSQL database, Redis namespace, PM2 processes, wallet metadata, and host-only authentication cookies. The future mainnet deployment will receive a separate set of each. No chain-connected mainnet service is started before mainnet contracts pass their independent review and deployment gates.

Feature work is promoted to testnet first. After acceptance, the exact commit may be tagged as a mainnet candidate; production activation still requires an explicit mainnet deployment and review.

## Cloudflare public hostnames

Configure the existing tunnel with these routes:

1. `testnet.sherwoodforest.trade` to `http://127.0.0.1:3081`.
2. `sherwoodforest.trade` to `http://127.0.0.1:3082`.
3. `www.sherwoodforest.trade` to `http://127.0.0.1:3082`.

Keep the old apex-to-application route until the testnet hostname passes HTTPS acceptance, then switch the apex and `www` routes to the holding origin.

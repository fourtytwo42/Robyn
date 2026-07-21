# Public preview

Robyn's feature preview can be shared through a Cloudflare Quick Tunnel without exposing a VM port or requiring a final domain.

## Topology

`trycloudflare.com -> cloudflared -> 127.0.0.1:3080 Nginx -> web preview 3003`

The same preview origin routes `/rpc` to the restricted RPC gateway on local port 8546. Browser clients therefore use same-origin HTTPS for reads, faucet calls and controlled-devnet transactions instead of attempting to reach a private LAN address.

The stable release on LAN port 3000 is not part of this route.

## Operations

- Read the current public URL: `cat /var/lib/robyn-preview/public-url`
- Check tunnel health: `sudo systemctl status robyn-preview-tunnel.service`
- Follow tunnel logs: `sudo journalctl -u robyn-preview-tunnel.service -f`
- Restart and receive a new random URL: `sudo systemctl restart robyn-preview-tunnel.service`
- Disable public access: `sudo systemctl disable --now robyn-preview-tunnel.service`

The random hostname changes whenever `cloudflared` starts a new Quick Tunnel. Quick Tunnels are for demonstrations only, have no uptime SLA, allow at most 200 concurrent in-flight requests and do not support Server-Sent Events. Use a named Cloudflare Tunnel and controlled domain before production.

## Application configuration

The preview web process must run with `NEXT_PUBLIC_ROBYN_RPC_URL=/rpc`. Production testnet builds continue to use their explicitly supplied Robinhood Chain RPC URL.

The shareable preview serves an optimized Next.js production build. It must not run `next dev`:

```sh
cd /home/hendo420/Robyn
pnpm exec pm2 stop robyn-web-preview
rm -rf apps/web/.next
ROBYN_NETWORK_MODE=devnet \
NEXT_PUBLIC_ROBYN_NETWORK_MODE=devnet \
NEXT_PUBLIC_ROBYN_RPC_URL=/rpc \
DATA_API_URL=http://127.0.0.1:3103 \
DATA_API_STATUS_URL=http://127.0.0.1:3103/status \
RPC_GATEWAY_HEALTH_URL=http://127.0.0.1:8547/health \
  pnpm --filter @robyn/web build
```

Start the built app with the same environment, `NODE_ENV=production`, `PORT=3003`, and `pnpm --filter @robyn/web start`, then run `pnpm exec pm2 save`. Verify `pm2 describe robyn-web-preview` reports script arguments `--filter @robyn/web start`, node environment `production`, and zero unstable restarts. `apps/web/.next/BUILD_ID` identifies the exact compiled output currently available to the production process.

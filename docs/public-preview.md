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

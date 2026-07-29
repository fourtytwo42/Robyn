# Robinhood RPC node operations

Last verified: 2026-07-29

## Boundary and topology

Sherwood Forest testnet uses the LAN Robinhood Testnet node as its primary
backend HTTP RPC and protected Alchemy as its comparison and failover endpoint.
The filtered Alchemy WebSocket remains the canonical ingester's low-latency wake
signal. Browser configuration never contains an Alchemy credential.

- Application VM: `192.168.50.250`
- Testnet LAN JSON-RPC edge: `http://192.168.50.117:8547`
- Application loopback failover gateway: `http://127.0.0.1:18547`
- Paid comparison and fallback: protected Alchemy Robinhood Testnet HTTPS
- Host node-exporter: `http://192.168.50.117:9100/metrics`

The gateway verifies chain ID `46630` and compares both heads every 30 seconds.
It fails over when LAN is unreachable, reports another chain, or trails Alchemy
by more than 50 blocks. It returns to LAN only after two comparisons within 10
blocks. The gateway is loopback-only and never returns either upstream URL.

## Runtime and data

The LAN node must return chain ID `0xb626` and remain close enough to Alchemy for
the gateway to select it. Its implementation, service layout, snapshot policy,
and data paths remain managed on the RPC host. The application VM depends only
on the restricted LAN JSON-RPC edge and does not require administrative access
to the node.

Useful application-side checks:

```bash
curl -sS -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  http://192.168.50.117:8547
curl -sS http://127.0.0.1:18547/health | jq \
  '{status,activeProvider,headLagBlocks,primary,fallback,paidProjectedDailyCu}'
```

The first command must return `0xb626`. The second must show both providers
healthy and `activeProvider: "primary"` during normal operation.

## Monitoring

Prometheus records LAN and Alchemy health separately, active provider, LAN head
lag, and projected paid CU. LAN unavailability or lag is a warning because the
gateway continues on Alchemy. Alchemy unavailability is critical because it
removes both the comparison authority and the configured fallback. A total
gateway outage is also visible through PM2 and application health checks.

## Testnet continuity and recovery

All protected testnet processes use `http://127.0.0.1:18547` for
`ROBYN_OPERATOR_RPC_URL`. The gateway receives the LAN primary through
`ROBYN_TESTNET_PRIMARY_RPC_URL` and the paid fallback through
`ROBYN_TESTNET_SERVER_RPC_URL`. The canonical ingester additionally uses the
protected `ROBYN_TESTNET_WS_RPC_URL` as a filtered log wake source. No
credentialed URL may be compiled into the browser.

If the LAN node fails, the gateway keeps the application on Alchemy and exposes
the degraded primary state. Do not bypass the gateway or silently switch either
endpoint to another chain.

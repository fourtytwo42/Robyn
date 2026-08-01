# Robinhood RPC resilience stack

This directory is the source-of-truth copy of the public-only resilience layer
deployed on the LAN Robinhood Chain nodes.

## Topology

- Nitro listens only on `127.0.0.1:18547`.
- `robinhood-rpc-failover` owns LAN port `8547`, preferring local Nitro and
  falling through validated free public Robinhood RPCs.
- `robinhood-feed-relay` maintains two independent WebSocket connections to
  Robinhood's sequencer feed and presents one loopback feed on port `9642`.
- `robinhood-l1-failover` presents multiple free Ethereum execution providers
  on `127.0.0.1:18545`.
- `robinhood-beacon-failover` presents multiple free Ethereum beacon APIs on
  `127.0.0.1:18546`.
- The existing two-minute Nitro watchdog observes raw Nitro on port `18547`,
  not the LAN failover gateway.

No active configuration may contain a paid provider. Each proxy refuses to
start if a provider is marked `paid: true`.

## Networks

| Network | Host | Chain ID | LAN RPC fallbacks | L1 execution | Beacon APIs |
| --- | --- | ---: | ---: | ---: | ---: |
| Testnet | `192.168.50.117` | 46630 | 3 public plus local | 4 public | 4 public |
| Mainnet | `192.168.50.173` | 4663 | 3 public plus local | 5 public | 4 public |

Public endpoints are rate-limited. Health probes verify chain ID, head lag,
sync state for local Nitro, and a canonical block hash before a provider is
eligible. When every healthy provider is unavailable, the gateway still tries
all configured providers in order as a last-resort recovery path.

## Runtime status

```bash
curl -s http://127.0.0.1:8547/__status | jq
curl -s http://127.0.0.1:18545/status | jq
curl -s http://127.0.0.1:18546/__status | jq
systemctl status robinhood-feed-relay robinhood-rpc-failover
```

The feed relay duplicates one logical upstream. It protects against a broken
or silently stalled WebSocket connection, but it cannot protect against a
network-wide outage of Robinhood's sequencer feed. During that outage, Nitro
continues canonical derivation from Ethereum while the LAN gateway can serve
reads from public Robinhood RPCs.

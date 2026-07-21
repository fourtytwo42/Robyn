# Security and capacity operations

Status: LAN edge and short-duration capacity gate verified
Last verified: 2026-07-21

## Network boundary

All application processes bind to loopback. Native Nginx is the only LAN application edge, while UFW defaults to deny incoming traffic and permits the local `192.168.50.0/24` subnet only.

| LAN port | Purpose | Loopback upstream |
|---|---|---|
| `22` | SSH administration | OpenSSH |
| `3000` | Next.js user interface | `127.0.0.1:3002` |
| `3100` | browser read API | `127.0.0.1:3101` |
| `8546` | restricted browser RPC and devnet faucet | `127.0.0.1:8547` |

Raw Anvil `8545`, Grafana `3001`, artifact service `3200`, MinIO `9000`, Prometheus `9090`, node-exporter `9100` and every application upstream are unreachable from the LAN. A Windows-side TCP test verified the four intended ports open and nine internal ports closed.

Nginx applies per-IP connection and request limits, `429` load shedding, body limits, short upstream timeouts and non-cacheable application responses. It overwrites `X-Forwarded-For` with the socket peer address. The gateway trusts forwarding data only from loopback, so a remote caller cannot choose the faucet rate-limit identity. Nginx's systemd exposure score is `3.8 OK`.

There is no public domain or certificate in scope. The controlled LAN release therefore remains HTTP. TLS is mandatory before exposing the interface outside the trusted LAN or attaching a domain.

## Install and verify

~~~bash
sudo apt-get install nginx
sudo /home/hendo420/Robyn/scripts/install-lan-edge.sh
sudo ufw status verbose
nginx -t
systemd-analyze security nginx.service
/home/hendo420/Robyn/scripts/security-smoke.sh
~~~

`install-lan-edge.sh` is idempotent. It installs the committed site and systemd drop-in, removes only the Ubuntu default-site symlink, preserves existing firewall rules, adds the four named Robyn LAN rules and verifies the three edge health routes plus loopback upstream listeners.

## Negative security checks

The reproducible edge smoke test verifies:

- security headers and `TRACE` rejection;
- privileged Anvil RPC rejection and 20-request batch bound;
- 64 KiB read-API body bound;
- invalid cursor rejection and literal SQL-injection-shaped search input;
- a 250-request burst producing only `200` or explicit `429`;
- recovery of web, API and RPC health after shedding the burst.

The accepted run passed 116 requests, shed 134 with `429`, returned no other status and recovered immediately.

## Static and supply-chain checks

Run:

~~~bash
SECURITY_AUDIT_OUTPUT=/tmp/robyn-security-audit.json \
  /home/hendo420/Robyn/scripts/security-audit.sh
~~~

The gate runs Gitleaks across full Git history, pnpm high/critical audit, license inventory, all Foundry tests and Slither against production contracts while excluding dependencies and `src/devnet`. The Gitleaks allowlist is intentionally narrow: public 20-byte EVM addresses and one exact prose false positive.

Slither initially reported four high reentrancy paths in `FeeBasketVault.convertLeg`. The vault already used OpenZeppelin's function-wide `nonReentrant` guard; an adversarial router fixture now attempts callbacks into both `convertLeg` and `recordFees`, proves both are rejected, and proves the outer conversion remains conserved. Targeted annotations document why the detector's call-site warning is false for this guarded path. The rerun has zero high findings, with ten medium, seven low and one informational item retained for the independent-review ledger rather than hidden globally.

The license inventory contains 498 packages in 16 groups. PM2 7.0.3 is AGPL-3.0; Robyn uses the unmodified process manager as an internal operator tool and does not expose PM2 itself to users. Preserve the upstream license/source notice and obtain final counsel confirmation if distribution or modification changes.

## Capacity envelope

The current controlled-LAN acceptance envelope is 25 mixed requests per second with 25 concurrent slots and a 500 ms per-endpoint p95 ceiling. Traffic is evenly split across server-rendered discovery, API status, API discovery, RPC chain ID and RPC head.

A 180-second run overlapped a forced uncached production build:

- `4,500 / 4,500` validated requests succeeded;
- slowest p95 was discovery at `12.16 ms`;
- maximum observed discovery latency was `75.67 ms`;
- no PM2 restart counter changed;
- application RSS values remained effectively flat;
- host free memory remained above 6.2 GB of 8.3 GB;
- block `102`, two launches, 169 raw logs and six completed conversion jobs reconciled afterward;
- no failed/dead-letter job appeared.

Evidence is under [`evidence/security/2026-07-21/`](../evidence/security/2026-07-21/).

## Remaining release gates

- Run the committed release candidate for a real 24-hour soak; accelerated samples do not satisfy this requirement.
- Configure a human notification receiver before real-value testnet operation.
- Complete independent protocol/security review and resolve every critical/high finding.
- Promote an immutable release artifact instead of serving from a mutable checkout.
- Add TLS if the interface leaves the trusted LAN or receives a domain.

# Monitoring operations

Status: installed and verified
Last verified: 2026-07-21

## Native topology

- Prometheus: loopback `127.0.0.1:9090`, 15-day local retention.
- node-exporter: loopback `127.0.0.1:9100` with Robyn textfile metrics.
- Grafana OSS: loopback `127.0.0.1:3001`, PostgreSQL-backed provisioned dashboard.
- Custom collector: `robyn-metrics-collector.timer` every 30 seconds as `hendo420`.

All services run natively under systemd. No monitoring UI is exposed directly to the LAN. Grafana uses PostgreSQL peer authentication and anonymous Viewer access; its generated admin credential is never committed.

## Signals and alerts

Signals cover systemd/PM2 health and restarts, web/API/gateway/keeper/artifact health, indexed last-good block and lag, King of the Forest projection checkpoint and award count, RPC divergence, queue/audit states, backup age, disk, inode, memory, CPU and load. Rules cover component loss, index lag, RPC divergence, failed/dead-letter work, stale backups/metrics and disk/memory headroom.

Every alert declares chain `31337`, component, launch/asset scope and a runbook link. Dynamic descriptions query the last-good indexed block.

## Install and verify

~~~bash
sudo /home/hendo420/Robyn/scripts/install-monitoring.sh
systemctl is-active prometheus prometheus-node-exporter grafana-server robyn-metrics-collector.timer
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS http://127.0.0.1:9090/api/v1/targets
curl -fsS http://127.0.0.1:3001/api/health
promtool check config /etc/prometheus/prometheus.yml
promtool check rules /etc/prometheus/robyn-rules.yml
promtool check metrics </var/lib/prometheus/node-exporter/robyn.prom
~~~

Use `ssh -L 3001:127.0.0.1:3001 hendo420@192.168.50.250` for operator-only Grafana, then open `http://127.0.0.1:3001/d/robyn-release-readiness`.

## Alert drill

An accepted drill creates a reversible failure in one nonfinancial component, preserves all alert scope/runbook labels, shows pending/firing state, restores the component, shows automatic resolution and verifies no accounting/queue/live-service regression. Prefer a collector fixture over stopping PostgreSQL, Anvil or the keeper.

## Verification result

Last verified 2026-07-21: both Prometheus targets were healthy; the custom series passed `promtool check metrics`; all required application components were up; indexed lag and RPC divergence were zero; failed and dead-letter counts were zero; Grafana queried its provisioned Prometheus datasource and exposed the `robyn-release-readiness` dashboard; ports 3001, 9090 and 9100 listened only on loopback. A reversible `RobynMonitoringDrill` alert fired with chain, component, launch, asset, severity, last-good-block and runbook evidence, then resolved to an empty alert set after the metric returned to zero.

## Cold-start verification

Last verified 2026-07-21: after installing explicit PM2 ordering on PostgreSQL, Redis, MinIO and Anvil, a second full VM reboot returned every required native unit active, all six PM2 processes online with zero restarts, block 102 and two launches intact, both monitoring targets healthy, the Grafana datasource healthy, no firing alerts and zero failed systemd units. In-app-browser acceptance reloaded anonymous discovery, canonical launch detail and the session wallet portfolio with live block-102 reward state and no console warnings or errors.

## Remaining gate

Configure an external human notification receiver before real-value testnet operation; the current local evaluator, dashboard and runbooks do not deliver to a person.
# IPFS signals

Operations monitor Kubo service availability, CID-gateway latency, local and
remote pin failures, stale pin jobs, CID mismatches, and prepared metadata that
remains unbound past its allowed window. Alerts must identify the chain, CID or
preparation where applicable, include the runbook link, and emit both firing
and resolved notifications through the loopback-only Alertmanager receiver.

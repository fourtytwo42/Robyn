#!/usr/bin/env bash
set -euo pipefail
if [[ "${EUID}" -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi
repo="/home/hendo420/Robyn"
wait_for_url() {
  local url="${1}"
  for _ in {1..60}; do
    curl -fsS --max-time 2 "${url}" >/dev/null && return 0
    sleep 0.5
  done
  echo "Timed out waiting for ${url}" >&2
  return 1
}
if ! command -v prometheus-alertmanager >/dev/null; then
  apt-get update
  apt-get install -y prometheus-alertmanager
fi
for tool in amtool curl grafana jq node openssl prometheus prometheus-alertmanager prometheus-node-exporter promtool runuser; do command -v "${tool}" >/dev/null; done
install -d -m 0750 -o root -g hendo420 /etc/robyn
install -d -m 0750 -o hendo420 -g hendo420 /var/lib/robyn/alerts
install -d -m 0750 -o hendo420 -g hendo420 /var/lib/robyn/monitoring
install -d -m 0750 -o hendo420 -g prometheus /var/lib/prometheus/node-exporter
install -d -m 0750 -o root -g grafana /var/lib/grafana/dashboards
install -d -m 0750 -o root -g grafana /etc/grafana/provisioning/datasources /etc/grafana/provisioning/dashboards
install -d -m 0755 /etc/systemd/system/prometheus-node-exporter.service.d
install -d -m 0755 /etc/systemd/system/grafana-server.service.d
install -m 0755 "${repo}/scripts/collect-monitoring-metrics.sh" /usr/local/sbin/robyn-collect-metrics
install -m 0644 "${repo}/infrastructure/monitoring/prometheus.yml" /etc/prometheus/prometheus.yml
install -m 0644 "${repo}/infrastructure/monitoring/prometheus-rules.yml" /etc/prometheus/robyn-rules.yml
install -m 0644 "${repo}/infrastructure/monitoring/alertmanager.yml" /etc/prometheus/alertmanager.yml
install -m 0644 "${repo}/infrastructure/monitoring/alertmanager.default" /etc/default/prometheus-alertmanager
install -m 0644 "${repo}/infrastructure/monitoring/prometheus.default" /etc/default/prometheus
install -m 0644 "${repo}/infrastructure/monitoring/node-exporter.default" /etc/default/prometheus-node-exporter
install -m 0640 -o root -g grafana "${repo}/infrastructure/monitoring/grafana-datasource.yml" /etc/grafana/provisioning/datasources/robyn.yml
install -m 0640 -o root -g grafana "${repo}/infrastructure/monitoring/grafana-dashboard-provider.yml" /etc/grafana/provisioning/dashboards/robyn.yml
install -m 0640 -o root -g grafana "${repo}/infrastructure/monitoring/grafana-dashboard.json" /var/lib/grafana/dashboards/robyn-release-readiness.json
install -m 0644 "${repo}/infrastructure/systemd/robyn-metrics-collector.service" /etc/systemd/system/robyn-metrics-collector.service
install -m 0644 "${repo}/infrastructure/systemd/robyn-metrics-collector.timer" /etc/systemd/system/robyn-metrics-collector.timer
install -m 0644 "${repo}/infrastructure/systemd/robyn-alert-receiver.service" /etc/systemd/system/robyn-alert-receiver.service
install -m 0644 "${repo}/infrastructure/systemd/prometheus-node-exporter-robyn.conf" /etc/systemd/system/prometheus-node-exporter.service.d/robyn.conf
install -m 0644 "${repo}/infrastructure/systemd/grafana-robyn.conf" /etc/systemd/system/grafana-server.service.d/robyn.conf
if ! runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_roles WHERE rolname='grafana'" postgres | grep -qx 1; then runuser -u postgres -- createuser --no-createdb --no-createrole --no-superuser grafana; fi
if ! runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname='robyn_grafana'" postgres | grep -qx 1; then runuser -u postgres -- createdb --owner=grafana robyn_grafana; fi
if [[ ! -f /etc/robyn/grafana.env ]]; then
  admin_password="$(openssl rand -hex 24)"
  umask 0077
  {
    printf 'GF_SERVER_HTTP_ADDR=%s\n' "127.0.0.1"
    printf 'GF_SERVER_HTTP_PORT=%s\n' "3001"
    printf 'GF_DATABASE_TYPE=%s\n' "postgres"
    printf 'GF_DATABASE_HOST=%s\n' "/var/run/postgresql"
    printf 'GF_DATABASE_NAME=%s\n' "robyn_grafana"
    printf 'GF_DATABASE_USER=%s\n' "grafana"
    printf 'GF_DATABASE_SSL_MODE=%s\n' "disable"
    printf 'GF_SECURITY_ADMIN_PASSWORD=%s\n' "${admin_password}"
    printf 'GF_AUTH_ANONYMOUS_ENABLED=%s\n' "true"
    printf 'GF_AUTH_ANONYMOUS_ORG_ROLE=%s\n' "Viewer"
    printf 'GF_AUTH_DISABLE_LOGIN_FORM=%s\n' "true"
    printf 'GF_USERS_ALLOW_SIGN_UP=%s\n' "false"
    printf 'GF_USERS_ALLOW_ORG_CREATE=%s\n' "false"
    printf 'GF_ANALYTICS_REPORTING_ENABLED=%s\n' "false"
    printf 'GF_ANALYTICS_CHECK_FOR_UPDATES=%s\n' "false"
    printf 'GF_SECURITY_DISABLE_GRAVATAR=%s\n' "true"
  } >/etc/robyn/grafana.env
fi
chown root:grafana /etc/robyn/grafana.env
chmod 0640 /etc/robyn/grafana.env
amtool check-config /etc/prometheus/alertmanager.yml
promtool check config /etc/prometheus/prometheus.yml
promtool check rules /etc/prometheus/robyn-rules.yml
jq -e '.uid=="robyn-release-readiness"' /var/lib/grafana/dashboards/robyn-release-readiness.json >/dev/null
systemd-analyze verify /etc/systemd/system/robyn-metrics-collector.service /etc/systemd/system/robyn-metrics-collector.timer
systemctl disable --now prometheus-node-exporter-apt.timer prometheus-node-exporter-ipmitool-sensor.timer prometheus-node-exporter-mellanox-hca-temp.timer prometheus-node-exporter-nvme.timer prometheus-node-exporter-smartmon.timer >/dev/null 2>&1 || true
systemctl disable --now openipmi.service >/dev/null 2>&1 || true
systemctl reset-failed openipmi.service >/dev/null 2>&1 || true
systemctl daemon-reload
systemctl enable --now prometheus-node-exporter.service prometheus-alertmanager.service prometheus.service grafana-server.service robyn-alert-receiver.service robyn-metrics-collector.timer
systemctl start robyn-metrics-collector.service
systemctl restart prometheus-node-exporter.service prometheus-alertmanager.service prometheus.service grafana-server.service robyn-alert-receiver.service
wait_for_url http://127.0.0.1:9090/-/ready
wait_for_url http://127.0.0.1:9093/-/ready
wait_for_url http://127.0.0.1:9094/health
wait_for_url http://127.0.0.1:9100/metrics
wait_for_url http://127.0.0.1:3001/api/health
echo "Native Robyn monitoring verified"

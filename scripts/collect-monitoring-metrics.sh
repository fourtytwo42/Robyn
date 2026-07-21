#!/usr/bin/env bash
set -euo pipefail

output="${ROBYN_METRICS_FILE:-/var/lib/prometheus/node-exporter/robyn.prom}"
repo="/home/hendo420/Robyn"
tmp="$(mktemp "${output}.XXXXXX")"
trap 'rm -f -- "${tmp}"' EXIT

metric() { printf '%s %s\n' "${1}" "${2}" >>"${tmp}"; }
json_get() { jq -r "${2} // empty" <<<"${1}" 2>/dev/null || true; }
rpc() { curl -fsS --max-time 3 -H 'content-type: application/json' --data "${2}" "${1}" 2>/dev/null || printf '{}'; }
hex_number() { local value="${1#0x}"; [[ -z "${value}" ]] && printf '0' || printf '%d' "0x${value}"; }
redis_count() {
  local key="${1}" type
  type="$(redis-cli --raw TYPE "${key}" 2>/dev/null || true)"
  case "${type}" in
    list) redis-cli --raw LLEN "${key}" 2>/dev/null || printf '0' ;;
    zset) redis-cli --raw ZCARD "${key}" 2>/dev/null || printf '0' ;;
    set) redis-cli --raw SCARD "${key}" 2>/dev/null || printf '0' ;;
    hash) redis-cli --raw HLEN "${key}" 2>/dev/null || printf '0' ;;
    *) printf '0' ;;
  esac
}

printf '# HELP robyn_monitoring_collected_timestamp_seconds Unix timestamp of the last successful collector run.\n# TYPE robyn_monitoring_collected_timestamp_seconds gauge\n' >"${tmp}"
metric "robyn_monitoring_collected_timestamp_seconds" "$(date +%s)"
printf '# HELP robyn_systemd_unit_up Whether a required native systemd unit is active.\n# TYPE robyn_systemd_unit_up gauge\n' >>"${tmp}"
for unit in postgresql redis-server minio robyn-anvil pm2-hendo420 robyn-backup.timer prometheus prometheus-node-exporter grafana-server; do
  value=0
  systemctl is-active --quiet "${unit}" && value=1
  metric "robyn_systemd_unit_up{chain_id=\"31337\",component=\"${unit}\",launch=\"all\",asset=\"all\"}" "${value}"
done

pm2_json="$(cd "${repo}" && pnpm exec pm2 jlist 2>/dev/null || printf '[]')"
printf '# HELP robyn_pm2_process_up Whether a declared PM2 process is online.\n# TYPE robyn_pm2_process_up gauge\n# HELP robyn_pm2_process_restarts PM2 restart count for a declared process.\n# TYPE robyn_pm2_process_restarts gauge\n' >>"${tmp}"
for process in robyn-web robyn-rpc-gateway robyn-api robyn-indexer robyn-keeper robyn-artifacts; do
  status="$(jq -r --arg name "${process}" '.[] | select(.name==$name) | .pm2_env.status' <<<"${pm2_json}" 2>/dev/null | head -1)"
  restarts="$(jq -r --arg name "${process}" '.[] | select(.name==$name) | .pm2_env.restart_time' <<<"${pm2_json}" 2>/dev/null | head -1)"
  [[ "${status}" == "online" ]] && up=1 || up=0
  [[ "${restarts}" =~ ^[0-9]+$ ]] || restarts=0
  metric "robyn_pm2_process_up{chain_id=\"31337\",component=\"${process}\",launch=\"all\",asset=\"all\"}" "${up}"
  metric "robyn_pm2_process_restarts{chain_id=\"31337\",component=\"${process}\"}" "${restarts}"
done

web_json="$(curl -fsS --max-time 3 http://127.0.0.1:3000/api/health 2>/dev/null || printf '{}')"
gateway_json="$(curl -fsS --max-time 3 http://127.0.0.1:8546/health 2>/dev/null || printf '{}')"
api_json="$(curl -fsS --max-time 3 http://127.0.0.1:3100/health 2>/dev/null || printf '{}')"
status_json="$(curl -fsS --max-time 3 http://127.0.0.1:3100/status 2>/dev/null || printf '{}')"
operations_json="$(curl -fsS --max-time 3 http://127.0.0.1:3100/operations 2>/dev/null || printf '{}')"
printf '# HELP robyn_component_up Whether a Robyn application component reports healthy.\n# TYPE robyn_component_up gauge\n' >>"${tmp}"
for pair in "web:${web_json}" "rpc-gateway:${gateway_json}" "api:${api_json}"; do
  component="${pair%%:*}"; body="${pair#*:}"
  [[ "$(json_get "${body}" '.status')" == "ok" ]] && up=1 || up=0
  metric "robyn_component_up{chain_id=\"31337\",component=\"${component}\",launch=\"all\",asset=\"all\"}" "${up}"
done
for component in keeper artifact; do
  field=".${component}Status"
  [[ "$(json_get "${api_json}" "${field}")" == "ok" ]] && up=1 || up=0
  metric "robyn_component_up{chain_id=\"31337\",component=\"${component}\",launch=\"all\",asset=\"all\"}" "${up}"
done

head_json="$(rpc http://127.0.0.1:8545 '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}')"
gateway_head_json="$(rpc http://127.0.0.1:8546 '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}')"
head_block="$(hex_number "$(json_get "${head_json}" '.result')")"
gateway_block="$(hex_number "$(json_get "${gateway_head_json}" '.result')")"
indexed_block="$(json_get "${status_json}" '.asOfBlock')"; [[ "${indexed_block}" =~ ^[0-9]+$ ]] || indexed_block=0
lag=$((head_block - indexed_block)); ((lag < 0)) && lag=0
divergence=$((head_block - gateway_block)); ((divergence < 0)) && divergence=$((-divergence))
printf '# HELP robyn_indexer_last_good_block Last canonical block indexed by the data plane.\n# TYPE robyn_indexer_last_good_block gauge\n' >>"${tmp}"
metric "robyn_indexer_last_good_block{chain_id=\"31337\",component=\"indexer\"}" "${indexed_block}"
printf '# HELP robyn_indexer_lag_blocks Difference between raw RPC head and indexed head.\n# TYPE robyn_indexer_lag_blocks gauge\n' >>"${tmp}"
metric "robyn_indexer_lag_blocks{chain_id=\"31337\",component=\"indexer\",launch=\"all\",asset=\"all\"}" "${lag}"
printf '# HELP robyn_rpc_divergence_blocks Difference between operator and restricted user RPC heads.\n# TYPE robyn_rpc_divergence_blocks gauge\n' >>"${tmp}"
metric "robyn_rpc_divergence_blocks{chain_id=\"31337\",component=\"rpc\",launch=\"all\",asset=\"all\"}" "${divergence}"

printf '# HELP robyn_queue_jobs Current BullMQ job counts by state.\n# TYPE robyn_queue_jobs gauge\n' >>"${tmp}"
for state in wait active delayed failed completed; do
  count="$(redis_count "bull:robyn-conversions:${state}")"
  metric "robyn_queue_jobs{chain_id=\"31337\",component=\"keeper\",queue=\"robyn-conversions\",state=\"${state}\",launch=\"all\",asset=\"all\"}" "${count}"
done
printf '# HELP robyn_job_audit_entries Durable conversion job counts by state.\n# TYPE robyn_job_audit_entries gauge\n' >>"${tmp}"
for state in queued active retrying dead_letter completed; do
  count="$(json_get "${operations_json}" ".counts.${state}")"; [[ "${count}" =~ ^[0-9]+$ ]] || count=0
  metric "robyn_job_audit_entries{chain_id=\"31337\",component=\"keeper\",state=\"${state}\",launch=\"all\",asset=\"all\"}" "${count}"
done

latest_backup="$(find /var/backups/robyn -maxdepth 1 -type f -name 'robyn-state-*.tar.zst.age' -printf '%T@\n' 2>/dev/null | sort -nr | head -1)"
latest_backup="${latest_backup%%.*}"; [[ "${latest_backup}" =~ ^[0-9]+$ ]] || latest_backup=0
printf '# HELP robyn_backup_last_success_timestamp_seconds Modification time of the newest encrypted local staging copy.\n# TYPE robyn_backup_last_success_timestamp_seconds gauge\n' >>"${tmp}"
metric "robyn_backup_last_success_timestamp_seconds{chain_id=\"31337\",component=\"backup\"}" "${latest_backup}"
printf '# HELP robyn_alert_drill Whether the reversible monitoring alert drill is active.\n# TYPE robyn_alert_drill gauge\n' >>"${tmp}"
metric "robyn_alert_drill{chain_id=\"31337\",component=\"monitoring\",launch=\"all\",asset=\"all\"}" "${ROBYN_ALERT_DRILL:-0}"
chmod 0640 "${tmp}"
mv -f "${tmp}" "${output}"
trap - EXIT

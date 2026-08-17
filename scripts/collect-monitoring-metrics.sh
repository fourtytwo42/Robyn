#!/usr/bin/env bash
set -euo pipefail

output="${ROBYN_METRICS_FILE:-/var/lib/prometheus/node-exporter/robyn.prom}"
drill_file="/etc/robyn/monitoring-drill.env"
if [[ -r "${drill_file}" ]]; then
  source "${drill_file}"
fi
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
for unit in postgresql redis-server minio robyn-ipfs robyn-anvil pm2-hendo420 robyn-backup.timer prometheus prometheus-alertmanager prometheus-node-exporter grafana-server robyn-alert-receiver; do
  value=0
  systemctl is-active --quiet "${unit}" && value=1
  metric "robyn_systemd_unit_up{chain_id=\"31337\",component=\"${unit}\",launch=\"all\",asset=\"all\"}" "${value}"
done

ipfs_local_pinned="$(psql -d robyn -Atqc "SELECT count(*) FROM ipfs_pins WHERE local_status='pinned'" 2>/dev/null || printf '0')"
ipfs_local_failed="$(psql -d robyn -Atqc "SELECT count(*) FROM ipfs_pins WHERE local_status='failed'" 2>/dev/null || printf '0')"
ipfs_remote_failed="$(psql -d robyn -Atqc "SELECT count(*) FROM ipfs_pins WHERE remote_status='failed'" 2>/dev/null || printf '0')"
remote_pin_configured=0
if [[ -r /etc/robyn/ipfs.env ]]; then
  # shellcheck disable=SC1091
  source /etc/robyn/ipfs.env
  if [[ -n "${IPFS_PINNING_ENDPOINT:-}" && -n "${IPFS_PINNING_TOKEN:-}" ]]; then
    remote_pin_configured=1
  fi
fi
if [[ "${remote_pin_configured}" == "1" ]]; then
  ipfs_stale="$(psql -d robyn -Atqc "SELECT count(*) FROM ipfs_pins WHERE (local_status<>'pinned' OR remote_status IN ('queued','pinning','failed')) AND updated_at < now() - interval '15 minutes'" 2>/dev/null || printf '0')"
else
  ipfs_stale="$(psql -d robyn -Atqc "SELECT count(*) FROM ipfs_pins WHERE (local_status<>'pinned' OR remote_status='failed') AND updated_at < now() - interval '15 minutes'" 2>/dev/null || printf '0')"
fi
prepared_stale="$(psql -d robyn -Atqc "SELECT count(*) FROM prepared_token_metadata WHERE status='ready' AND created_at < now() - interval '24 hours'" 2>/dev/null || printf '0')"
for value_name in ipfs_local_pinned ipfs_local_failed ipfs_remote_failed ipfs_stale prepared_stale; do
  value="${!value_name}"
  [[ "${value}" =~ ^[0-9]+$ ]] || printf -v "${value_name}" '0'
done
printf '# HELP robyn_ipfs_pins IPFS objects by durability state.\n# TYPE robyn_ipfs_pins gauge\n' >>"${tmp}"
metric "robyn_ipfs_pins{chain_id=\"31337\",component=\"ipfs\",scope=\"local\",state=\"pinned\"}" "${ipfs_local_pinned}"
metric "robyn_ipfs_pins{chain_id=\"31337\",component=\"ipfs\",scope=\"local\",state=\"failed\"}" "${ipfs_local_failed}"
metric "robyn_ipfs_pins{chain_id=\"31337\",component=\"ipfs\",scope=\"remote\",state=\"failed\"}" "${ipfs_remote_failed}"
metric "robyn_ipfs_stale_objects{chain_id=\"31337\",component=\"ipfs\"}" "${ipfs_stale}"
metric "robyn_ipfs_stale_preparations{chain_id=\"31337\",component=\"ipfs\"}" "${prepared_stale}"

pm2_bin="${ROBYN_PM2_BIN:-/opt/robyn/current/node_modules/.bin/pm2}"
pm2_json="$(PM2_HOME="${PM2_HOME:-/home/hendo420/.pm2}" "${pm2_bin}" jlist 2>/dev/null || printf '[]')"
printf '# HELP robyn_pm2_process_up Whether a declared PM2 process is online.\n# TYPE robyn_pm2_process_up gauge\n# HELP robyn_pm2_process_restarts PM2 restart count for a declared process.\n# TYPE robyn_pm2_process_restarts gauge\n' >>"${tmp}"
for process in robyn-web robyn-rpc-gateway robyn-api robyn-indexer robyn-keeper robyn-artifacts; do
  status="$(jq -r --arg name "${process}" '.[] | select(.name==$name) | .pm2_env.status' <<<"${pm2_json}" 2>/dev/null | head -1)"
  restarts="$(jq -r --arg name "${process}" '.[] | select(.name==$name) | .pm2_env.restart_time' <<<"${pm2_json}" 2>/dev/null | head -1)"
  [[ "${status}" == "online" ]] && up=1 || up=0
  [[ "${restarts}" =~ ^[0-9]+$ ]] || restarts=0
  metric "robyn_pm2_process_up{chain_id=\"31337\",component=\"${process}\",launch=\"all\",asset=\"all\"}" "${up}"
  metric "robyn_pm2_process_restarts{chain_id=\"31337\",component=\"${process}\"}" "${restarts}"
done
testnet_status_json="$(curl -fsS --max-time 3 http://127.0.0.1:3111/status 2>/dev/null || printf '{}')"
testnet_processes=(
  robyn-web-testnet
  robyn-rpc-gateway-testnet
  robyn-api-testnet
  robyn-indexer-testnet
  robyn-projector-testnet
  robyn-artifacts-testnet
)
if [[ "$(json_get "${testnet_status_json}" '.keeperExpected')" == "true" ]]; then
  testnet_processes+=(robyn-keeper-testnet)
fi
for process in "${testnet_processes[@]}"; do
  status="$(jq -r --arg name "${process}" '.[] | select(.name==$name) | .pm2_env.status' <<<"${pm2_json}" 2>/dev/null | head -1)"
  restarts="$(jq -r --arg name "${process}" '.[] | select(.name==$name) | .pm2_env.restart_time' <<<"${pm2_json}" 2>/dev/null | head -1)"
  [[ "${status}" == "online" ]] && up=1 || up=0
  [[ "${restarts}" =~ ^[0-9]+$ ]] || restarts=0
  metric "robyn_pm2_process_up{chain_id=\"46630\",component=\"${process}\",launch=\"all\",asset=\"all\"}" "${up}"
  metric "robyn_pm2_process_restarts{chain_id=\"46630\",component=\"${process}\"}" "${restarts}"
done

web_json="$(curl -fsS --max-time 3 http://127.0.0.1:3000/api/health 2>/dev/null || printf '{}')"
gateway_json="$(curl -fsS --max-time 3 http://127.0.0.1:8546/health 2>/dev/null || printf '{}')"
api_json="$(curl -fsS --max-time 3 http://127.0.0.1:3100/health 2>/dev/null || printf '{}')"
status_json="$(curl -fsS --max-time 3 http://127.0.0.1:3100/status 2>/dev/null || printf '{}')"
operations_json="$(curl -fsS --max-time 3 http://127.0.0.1:3100/operations 2>/dev/null || printf '{}')"
dao_json="$(curl -fsS --max-time 3 http://127.0.0.1:3100/dao 2>/dev/null || printf '{}')"
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

testnet_ingestion_lag="$(json_get "${testnet_status_json}" '.ingestionLagBlocks')"; [[ "${testnet_ingestion_lag}" =~ ^[0-9]+$ ]] || testnet_ingestion_lag=0
testnet_projection_lag="$(json_get "${testnet_status_json}" '.projectionLagBlocks')"; [[ "${testnet_projection_lag}" =~ ^[0-9]+$ ]] || testnet_projection_lag=0
testnet_ingestion_cycle="$(json_get "${testnet_status_json}" '.ingestionCycleMs')"; [[ "${testnet_ingestion_cycle}" =~ ^[0-9]+([.][0-9]+)?$ ]] || testnet_ingestion_cycle=0
testnet_projection_cycle="$(json_get "${testnet_status_json}" '.projectionCycleMs')"; [[ "${testnet_projection_cycle}" =~ ^[0-9]+([.][0-9]+)?$ ]] || testnet_projection_cycle=0
testnet_rpc_retries="$(json_get "${testnet_status_json}" '.rpcRetryCount')"; [[ "${testnet_rpc_retries}" =~ ^[0-9]+$ ]] || testnet_rpc_retries=0
testnet_ingestion_checkpoint="$(json_get "${testnet_status_json}" '.asOfBlock')"; [[ "${testnet_ingestion_checkpoint}" =~ ^[0-9]+$ ]] || testnet_ingestion_checkpoint=0
testnet_projection_checkpoint="$(json_get "${testnet_status_json}" '.projectionAsOfBlock')"; [[ "${testnet_projection_checkpoint}" =~ ^[0-9]+$ ]] || testnet_projection_checkpoint=0
[[ "$(json_get "${testnet_status_json}" '.ingestionStatus')" == "ok" ]] && testnet_ingestion_up=1 || testnet_ingestion_up=0
[[ "$(json_get "${testnet_status_json}" '.projectionStatus')" == "ok" ]] && testnet_projection_up=1 || testnet_projection_up=0
printf '# HELP robyn_testnet_ingestion_lag_blocks Difference between the observed Robinhood Testnet head and canonical ingestion checkpoint.\n# TYPE robyn_testnet_ingestion_lag_blocks gauge\n' >>"${tmp}"
metric "robyn_testnet_ingestion_lag_blocks{chain_id=\"46630\",component=\"indexer\"}" "${testnet_ingestion_lag}"
printf '# HELP robyn_testnet_projection_lag_blocks Difference between canonical ingestion and launch projection checkpoints.\n# TYPE robyn_testnet_projection_lag_blocks gauge\n' >>"${tmp}"
metric "robyn_testnet_projection_lag_blocks{chain_id=\"46630\",component=\"projector\"}" "${testnet_projection_lag}"
printf '# HELP robyn_testnet_checkpoint_block Last durable pipeline checkpoint.\n# TYPE robyn_testnet_checkpoint_block gauge\n' >>"${tmp}"
metric "robyn_testnet_checkpoint_block{chain_id=\"46630\",component=\"indexer\"}" "${testnet_ingestion_checkpoint}"
metric "robyn_testnet_checkpoint_block{chain_id=\"46630\",component=\"projector\"}" "${testnet_projection_checkpoint}"
printf '# HELP robyn_testnet_pipeline_up Whether the API observes a fresh healthy pipeline heartbeat.\n# TYPE robyn_testnet_pipeline_up gauge\n' >>"${tmp}"
metric "robyn_testnet_pipeline_up{chain_id=\"46630\",component=\"indexer\"}" "${testnet_ingestion_up}"
metric "robyn_testnet_pipeline_up{chain_id=\"46630\",component=\"projector\"}" "${testnet_projection_up}"
printf '# HELP robyn_testnet_indexer_cycle_milliseconds Last completed pipeline cycle duration.\n# TYPE robyn_testnet_indexer_cycle_milliseconds gauge\n' >>"${tmp}"
metric "robyn_testnet_indexer_cycle_milliseconds{chain_id=\"46630\",component=\"indexer\"}" "${testnet_ingestion_cycle}"
metric "robyn_testnet_indexer_cycle_milliseconds{chain_id=\"46630\",component=\"projector\"}" "${testnet_projection_cycle}"
printf '# HELP robyn_testnet_rpc_retry_count Cumulative degraded public-RPC pipeline cycles.\n# TYPE robyn_testnet_rpc_retry_count counter\n' >>"${tmp}"
metric "robyn_testnet_rpc_retry_count{chain_id=\"46630\",component=\"indexer\"}" "${testnet_rpc_retries}"

printf '# HELP robyn_queue_jobs Current BullMQ job counts by state.\n# TYPE robyn_queue_jobs gauge\n' >>"${tmp}"
for state in wait active delayed failed completed; do
  count="$(redis_count "bull:robyn-conversions:${state}")"
  metric "robyn_queue_jobs{chain_id=\"31337\",component=\"keeper\",queue=\"robyn-conversions\",state=\"${state}\",launch=\"all\",asset=\"all\"}" "${count}"
done
printf '# HELP robyn_job_audit_entries Durable conversion job counts by state.\n# TYPE robyn_job_audit_entries gauge\n' >>"${tmp}"
for state in queued active retrying dead_letter superseded completed; do
  count="$(json_get "${operations_json}" ".counts.${state}")"; [[ "${count}" =~ ^[0-9]+$ ]] || count=0
  metric "robyn_job_audit_entries{chain_id=\"31337\",component=\"keeper\",state=\"${state}\",launch=\"all\",asset=\"all\"}" "${count}"
done

latest_backup="$(find /var/backups/robyn -maxdepth 1 -type f -name 'robyn-state-*.tar.zst.age' -printf '%T@\n' 2>/dev/null | sort -nr | head -1)"
latest_backup="${latest_backup%%.*}"; [[ "${latest_backup}" =~ ^[0-9]+$ ]] || latest_backup=0
printf '# HELP robyn_backup_last_success_timestamp_seconds Modification time of the newest encrypted local staging copy.\n# TYPE robyn_backup_last_success_timestamp_seconds gauge\n' >>"${tmp}"
metric "robyn_backup_last_success_timestamp_seconds{chain_id=\"31337\",component=\"backup\"}" "${latest_backup}"
printf '# HELP robyn_alert_drill Whether the reversible monitoring alert drill is active.\n# TYPE robyn_alert_drill gauge\n' >>"${tmp}"
metric "robyn_alert_drill{chain_id=\"31337\",component=\"monitoring\",launch=\"all\",asset=\"all\"}" "${ROBYN_ALERT_DRILL:-0}"
keeper_updated="$(json_get "${api_json}" '.keeperUpdatedAt')"
keeper_epoch="$(date -d "${keeper_updated}" +%s 2>/dev/null || printf '0')"
pending_created="$(json_get "${operations_json}" '.oldestPendingCreatedAt')"
if [[ -n "${pending_created}" ]]; then
  pending_epoch="$(date -d "${pending_created}" +%s 2>/dev/null || printf '0')"
  pending_age=$(( $(date +%s) - pending_epoch ))
  ((pending_age < 0)) && pending_age=0
else
  pending_age=0
fi
accounting_drift="$(cat /var/lib/robyn/monitoring/accounting-drift 2>/dev/null || printf '0')"
restore_result="$(cat /var/lib/robyn/monitoring/restore-result 2>/dev/null || printf '1')"
soak_result="$(cat /var/lib/robyn/monitoring/soak-result 2>/dev/null || printf '1')"
for value_name in accounting_drift restore_result soak_result; do
  value="${!value_name}"
  [[ "${value}" =~ ^[0-9]+$ ]] || printf -v "${value_name}" '0'
done
printf '# HELP robyn_keeper_last_success_timestamp_seconds Keeper heartbeat timestamp.\n# TYPE robyn_keeper_last_success_timestamp_seconds gauge\n' >>"${tmp}"
metric "robyn_keeper_last_success_timestamp_seconds{chain_id=\"31337\",component=\"keeper\",launch=\"all\",asset=\"all\"}" "${keeper_epoch}"
printf '# HELP robyn_oldest_pending_conversion_age_seconds Age of the oldest visible current pending conversion.\n# TYPE robyn_oldest_pending_conversion_age_seconds gauge\n' >>"${tmp}"
metric "robyn_oldest_pending_conversion_age_seconds{chain_id=\"31337\",component=\"keeper\",launch=\"all\",asset=\"all\"}" "${pending_age}"
printf '# HELP robyn_accounting_drift Whether the latest reconciliation found accounting drift.\n# TYPE robyn_accounting_drift gauge\n' >>"${tmp}"
metric "robyn_accounting_drift{chain_id=\"31337\",component=\"protocol\",launch=\"all\",asset=\"all\"}" "${accounting_drift}"
printf '# HELP robyn_restore_last_result Whether the latest restore rehearsal passed.\n# TYPE robyn_restore_last_result gauge\n' >>"${tmp}"
metric "robyn_restore_last_result{chain_id=\"31337\",component=\"backup\",launch=\"all\",asset=\"all\"}" "${restore_result}"
printf '# HELP robyn_soak_last_result Whether the latest one-shot soak passed.\n# TYPE robyn_soak_last_result gauge\n' >>"${tmp}"
metric "robyn_soak_last_result{chain_id=\"31337\",component=\"release\",launch=\"all\",asset=\"all\"}" "${soak_result}"
creator_liability="$(json_get "${dao_json}" '.data.pendingCreatorLiability')"; [[ "${creator_liability}" =~ ^[0-9]+$ ]] || creator_liability=0
rewards_deposited="$(json_get "${dao_json}" '.data.totalRewardsDeposited')"; [[ "${rewards_deposited}" =~ ^[0-9]+$ ]] || rewards_deposited=0
rewards_claimed="$(json_get "${dao_json}" '.data.totalRewardsClaimed')"; [[ "${rewards_claimed}" =~ ^[0-9]+$ ]] || rewards_claimed=0
rdao_liability="$(awk -v deposited="${rewards_deposited}" -v claimed="${rewards_claimed}" 'BEGIN { value=deposited-claimed; if (value<0) value=0; printf "%.0f", value }')"
treasury_balance="$(json_get "${dao_json}" '.data.treasuryBalance')"; [[ "${treasury_balance}" =~ ^[0-9]+$ ]] || treasury_balance=0
pending_protocol_base="$(jq -r '[.data.launchFees[]? | ((.pendingCreatorBase|tonumber) + (.pendingDaoRewardBase|tonumber) + (.pendingTreasuryBase|tonumber))] | add // 0' <<<"${dao_json}" 2>/dev/null || printf '0')"
[[ "${pending_protocol_base}" =~ ^[0-9]+$ ]] || pending_protocol_base=0
printf '# HELP robyn_creator_native_liability_wei Claimable creator native liability in wei.\n# TYPE robyn_creator_native_liability_wei gauge\n' >>"${tmp}"
metric "robyn_creator_native_liability_wei{chain_id=\"31337\",component=\"protocol\",launch=\"all\",asset=\"native\"}" "${creator_liability}"
printf '# HELP robyn_rdao_native_liability_wei Deposited less claimed RDAO native reward liability in wei.\n# TYPE robyn_rdao_native_liability_wei gauge\n' >>"${tmp}"
metric "robyn_rdao_native_liability_wei{chain_id=\"31337\",component=\"protocol\",launch=\"all\",asset=\"native\"}" "${rdao_liability}"
printf '# HELP robyn_treasury_native_balance_wei DAO timelock native balance in wei.\n# TYPE robyn_treasury_native_balance_wei gauge\n' >>"${tmp}"
metric "robyn_treasury_native_balance_wei{chain_id=\"31337\",component=\"protocol\",launch=\"all\",asset=\"native\"}" "${treasury_balance}"
printf '# HELP robyn_pending_protocol_base_wei Protocol base assets pending native conversion in wei units.\n# TYPE robyn_pending_protocol_base_wei gauge\n' >>"${tmp}"
metric "robyn_pending_protocol_base_wei{chain_id=\"31337\",component=\"protocol\",launch=\"all\",asset=\"base\"}" "${pending_protocol_base}"
printf '# HELP robyn_assurance_drill Reversible alert-delivery fixture selected by exact alert name.\n# TYPE robyn_assurance_drill gauge\n' >>"${tmp}"
for alert in \
  RobynComponentDown RobynIndexerLag RobynRpcDivergence \
  RobynDeadLetterOrFailedJob RobynBackupStale RobynMetricsCollectorStale \
  RobynDiskHeadroomLow RobynMemoryHeadroomLow RobynKeeperStalled \
  RobynConversionStale RobynAccountingDrift RobynServiceRestart \
  RobynRestoreFailure RobynSoakFailure; do
  value=0
  [[ "${ROBYN_ALERT_DRILL_NAME:-}" == "${alert}" ]] && value=1
  metric "robyn_assurance_drill{alert=\"${alert}\",chain_id=\"31337\",component=\"monitoring-drill\",launch=\"all\",asset=\"all\"}" "${value}"
done
chmod 0640 "${tmp}"
mv -f "${tmp}" "${output}"
trap - EXIT

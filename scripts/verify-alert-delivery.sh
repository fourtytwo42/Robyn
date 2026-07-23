#!/usr/bin/env bash
set -euo pipefail
if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo so the drill fixture cannot be modified by app users." >&2
  exit 1
fi

repo="/home/hendo420/Robyn"
log="/var/lib/robyn/alerts/deliveries.jsonl"
evidence_root="${ALERT_EVIDENCE_ROOT:-/var/backups/robyn/alert-validation}"
run_id="${ALERT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
output="${evidence_root}/${run_id}"
mkdir -p "${output}"
touch "${log}"
chown hendo420:hendo420 "${log}"
chmod 0640 "${log}"
baseline_lines="$(wc -l <"${log}")"

cleanup() {
  true
}
trap cleanup EXIT

wait_for_delivery() {
  local alert="$1" status="$2" start="$3"
  for _ in {1..30}; do
    if tail -n "+$((start + 1))" "${log}" |
      jq -e --arg alert "${alert}" --arg status "${status}" \
        'select(.alertname==$alert and .status==$status)' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for ${alert} ${status}" >&2
  return 1
}

send_alert() {
  local alert="$1" component="$2" runbook="$3" status="$4"
  local now ends_at
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "${status}" == "resolved" ]]; then
    ends_at="${now}"
  else
    ends_at="$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)"
  fi
  jq -n \
    --arg alert "${alert}" \
    --arg component "${component}" \
    --arg runbook "${runbook}" \
    --arg startsAt "${now}" \
    --arg endsAt "${ends_at}" \
    '[{
      labels:{
        alertname:$alert,severity:"warning",chain_id:"31337",
        component:$component,launch:"all",asset:"all",runbook:$runbook,
        drill:"local-release-assurance"
      },
      annotations:{
        summary:("Reversible delivery drill for "+$alert),
        description:"Synthetic loopback-only assurance alert.",
        runbook_url:("https://github.com/fourtytwo42/Robyn/blob/main/docs/incident-response.md#"+$runbook)
      },
      startsAt:$startsAt,
      endsAt:$endsAt,
      generatorURL:"http://127.0.0.1:9090/graph"
    }]' |
    curl -fsS -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:9093/api/v2/alerts >/dev/null
}

alerts=(
  RobynComponentDown
  RobynIndexerLag
  RobynRpcDivergence
  RobynDeadLetterOrFailedJob
  RobynBackupStale
  RobynMetricsCollectorStale
  RobynDiskHeadroomLow
  RobynMemoryHeadroomLow
  RobynKeeperStalled
  RobynConversionStale
  RobynAccountingDrift
  RobynServiceRestart
  RobynRestoreFailure
  RobynSoakFailure
)

components=(
  runtime indexer rpc keeper backup monitoring vm-disk vm-memory
  keeper keeper protocol runtime backup release
)

runbooks=(
  component-down indexer-lag rpc-divergence conversion-failure backup-stale
  monitoring-stale capacity capacity conversion-failure conversion-failure
  accounting-drift component-down backup-stale release-soak
)

for alert in "${alerts[@]}"; do
  index=0
  for candidate in "${alerts[@]}"; do
    [[ "${candidate}" == "${alert}" ]] && break
    index=$((index + 1))
  done
  start="$(wc -l <"${log}")"
  send_alert "${alert}" "${components[$index]}" "${runbooks[$index]}" firing
  wait_for_delivery "${alert}" firing "${start}"

  resolved_start="$(wc -l <"${log}")"
  send_alert "${alert}" "${components[$index]}" "${runbooks[$index]}" resolved
  wait_for_delivery "${alert}" resolved "${resolved_start}"
done

tail -n "+$((baseline_lines + 1))" "${log}" >"${output}/deliveries.jsonl"
jq -s \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg gitSha "$(git -C "${repo}" rev-parse HEAD)" \
  --argjson expected "${#alerts[@]}" \
  '{
    schemaVersion:1,
    generatedAt:$generatedAt,
    gitSha:$gitSha,
    expectedAlerts:$expected,
    firing:([.[]|select(.status=="firing")|.alertname]|unique),
    resolved:([.[]|select(.status=="resolved")|.alertname]|unique),
    labelsComplete:all(.[]; .labels.chain_id=="31337" and .labels.component and .labels.launch and .labels.asset and .labels.runbook),
    runbooksComplete:all(.[]; (.annotations.runbook_url|type)=="string"),
    passed:(
      ([.[]|select(.status=="firing")|.alertname]|unique|length)==$expected and
      ([.[]|select(.status=="resolved")|.alertname]|unique|length)==$expected
    )
  }' "${output}/deliveries.jsonl" >"${output}/summary.json"
jq -e '.passed and .labelsComplete and .runbooksComplete' "${output}/summary.json" >/dev/null
(cd "${output}" && sha256sum deliveries.jsonl summary.json >SHA256SUMS)
printf 'alertValidation=passed\nalerts=%s\nsummary=%s\n' \
  "${#alerts[@]}" "${output}/summary.json"

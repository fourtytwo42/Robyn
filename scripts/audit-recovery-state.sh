#!/usr/bin/env bash
set -euo pipefail

expected_sha=""
previous_boot_id=""
allow_same_boot=false
allow_active_soak=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expected-sha)
      expected_sha="${2:-}"
      shift 2
      ;;
    --previous-boot-id)
      previous_boot_id="${2:-}"
      shift 2
      ;;
    --allow-same-boot)
      allow_same_boot=true
      shift
      ;;
    --allow-active-soak)
      allow_active_soak=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root so firewall and complete service state can be audited." >&2
  exit 1
fi
if [[ ! "${expected_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "--expected-sha must be a full lowercase Git SHA." >&2
  exit 2
fi
if [[ ! "${previous_boot_id}" =~ ^[0-9a-f-]{36}$ ]]; then
  echo "--previous-boot-id must be a boot UUID captured before reboot." >&2
  exit 2
fi

for tool in curl jq runuser ss systemctl ufw; do
  command -v "${tool}" >/dev/null
done

expected_release="/opt/robyn/releases/${expected_sha}"
current_release="$(readlink -f /opt/robyn/current)"
boot_id="$(tr -d '\r\n' </proc/sys/kernel/random/boot_id)"
if [[ "${current_release}" != "${expected_release}" ]]; then
  echo "Current release drifted: ${current_release}" >&2
  exit 1
fi
if [[ "${allow_same_boot}" != true && "${boot_id}" == "${previous_boot_id}" ]]; then
  echo "Boot ID did not change; this is not post-reboot evidence." >&2
  exit 1
fi

work_dir="$(mktemp -d /var/tmp/robyn-recovery-audit.XXXXXX)"
cleanup() {
  rm -rf -- "${work_dir}"
}
trap cleanup EXIT

required_services=(
  grafana-server.service
  minio.service
  nginx.service
  pm2-hendo420.service
  postgresql.service
  postgresql@16-main.service
  prometheus-node-exporter.service
  prometheus.service
  redis-server.service
  robyn-anvil.service
)
required_timers=(robyn-backup.timer robyn-metrics-collector.timer)

for unit in "${required_services[@]}" "${required_timers[@]}"; do
  if [[ "$(systemctl is-active "${unit}")" != "active" ]]; then
    echo "Required unit is not active: ${unit}" >&2
    exit 1
  fi
done
for unit in "${required_services[@]}" "${required_timers[@]}"; do
  enabled_state="$(systemctl is-enabled "${unit}")"
  if [[ "${enabled_state}" != "enabled" && "${enabled_state}" != "enabled-runtime" && "${enabled_state}" != "indirect" ]]; then
    echo "Required unit is not enabled: ${unit} (${enabled_state})" >&2
    exit 1
  fi
done

failed_units="$(systemctl --failed --no-legend --plain | sed '/^[[:space:]]*$/d' || true)"
if [[ -n "${failed_units}" ]]; then
  echo "Systemd has failed units:" >&2
  printf '%s\n' "${failed_units}" >&2
  exit 1
fi

soak_state="$(systemctl is-active robyn-soak.service || true)"
if [[ "${allow_active_soak}" != true && "${soak_state}" != "inactive" ]]; then
  echo "Soak service must be inactive after successful completion: ${soak_state}" >&2
  exit 1
fi
if [[ "${allow_active_soak}" == true && "${soak_state}" != "active" ]]; then
  echo "Pre-reboot rehearsal expected the soak to remain active." >&2
  exit 1
fi

for unit in docker.service docker.socket containerd.service; do
  active_state="$(systemctl is-active "${unit}" || true)"
  enabled_state="$(systemctl is-enabled "${unit}" 2>/dev/null || true)"
  if [[ "${active_state}" != "inactive" || "${enabled_state}" != "disabled" ]]; then
    echo "Prohibited container unit is not disabled/inactive: ${unit}" >&2
    exit 1
  fi
done

runuser -u hendo420 -- env \
  HOME=/home/hendo420 \
  PM2_HOME=/home/hendo420/.pm2 \
  "${expected_release}/scripts/verify-release.sh" "${expected_release}" \
  >"${work_dir}/release.json"
jq -e \
  --arg sha "${expected_sha}" \
  --arg release "${expected_release}" \
  '.gitSha == $sha and .releasePath == $release and .appCount == 6 and .immutability.passed == true' \
  "${work_dir}/release.json" >/dev/null

runuser -u hendo420 -- env HOME=/home/hendo420 \
  "${expected_release}/scripts/verify-devnet-deployment.sh" \
  "${expected_release}/deployments/31337.json" \
  >"${work_dir}/deployment.txt"
grep -Eq '^Verified devnet deployment at block [0-9]+$' "${work_dir}/deployment.txt"

runuser -u hendo420 -- env \
  HOME=/home/hendo420 \
  PM2_HOME=/home/hendo420/.pm2 \
  "${expected_release}/node_modules/.bin/pm2" jlist \
  >"${work_dir}/pm2.json"
jq -e \
  --arg release "${expected_release}" \
  'length == 6 and all(.[];
    .pm2_env.status == "online" and
    .pm2_env.restart_time == 0 and
    (.pm2_env.pm_cwd | startswith($release)))' \
  "${work_dir}/pm2.json" >/dev/null

curl -fsS http://127.0.0.1:3000/ >"${work_dir}/web.html"
grep -Eq 'Controlled development network|Development network only' "${work_dir}/web.html"
curl -fsS http://127.0.0.1:3100/health >"${work_dir}/api-health.json"
curl -fsS http://127.0.0.1:3100/status >"${work_dir}/status.json"
curl -fsS http://127.0.0.1:8546/health >"${work_dir}/rpc-health.json"
curl -fsS http://127.0.0.1:3200/health >"${work_dir}/artifact-health.json"
curl -fsS http://127.0.0.1:9090/-/healthy >"${work_dir}/prometheus-health.txt"
curl -fsS http://127.0.0.1:9090/api/v1/targets >"${work_dir}/targets.json"
curl -fsS http://127.0.0.1:9090/api/v1/alerts >"${work_dir}/alerts.json"
curl -fsS \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
  http://127.0.0.1:8546 >"${work_dir}/block.json"

jq -e '.status == "ok"' "${work_dir}/api-health.json" >/dev/null
jq -e '.status == "ok"' "${work_dir}/rpc-health.json" >/dev/null
jq -e '.status == "ok"' "${work_dir}/artifact-health.json" >/dev/null
jq -e '[.data.activeTargets[] | select(.health == "up")] | length >= 2' \
  "${work_dir}/targets.json" >/dev/null
jq -e '[.data.activeTargets[] | select(.health != "up")] | length == 0' \
  "${work_dir}/targets.json" >/dev/null
jq -e '[.data.alerts[] | select(.state == "firing")] | length == 0' \
  "${work_dir}/alerts.json" >/dev/null

chain_block="$(jq -r '.result | ltrimstr("0x") | if . == "" then "0" else . end' "${work_dir}/block.json")"
chain_block="$((16#${chain_block}))"
indexed_block="$(jq -r '.asOfBlock | tonumber' "${work_dir}/status.json")"
launch_count="$(jq -r '.launchCount | tonumber' "${work_dir}/status.json")"
raw_log_count="$(jq -r '.rawLogCount | tonumber' "${work_dir}/status.json")"
if (( indexed_block > chain_block || indexed_block < 156 || launch_count < 6 || raw_log_count < 573 )); then
  echo "Recovered indexed state is incomplete or inconsistent." >&2
  exit 1
fi
jq -e '.keeperStatus == "ok" and .artifactStatus == "ok"' \
  "${work_dir}/status.json" >/dev/null

for port in 22 3000 3100 8546; do
  if ! ss -H -lnt "sport = :${port}" | grep -Eq "(0\.0\.0\.0|\[::\]):${port}[[:space:]]"; then
    echo "Expected LAN listener is missing on port ${port}." >&2
    exit 1
  fi
done
for port in 3001 3002 3101 3200 5432 6379 8545 8547 9000 9090 9100; do
  listeners="$(ss -H -lnt "sport = :${port}")"
  if [[ -z "${listeners}" ]]; then
    echo "Expected private listener is missing on port ${port}." >&2
    exit 1
  fi
  if awk '{print $4}' <<<"${listeners}" | grep -Evq '^(127\.0\.0\.1|\[::1\]):[0-9]+$'; then
    echo "Private port ${port} is exposed beyond loopback." >&2
    exit 1
  fi
done

ufw status numbered >"${work_dir}/ufw.txt"
grep -Fq 'Status: active' "${work_dir}/ufw.txt"
if [[ "$(grep -c 'ALLOW IN' "${work_dir}/ufw.txt")" -ne 4 ]]; then
  echo "Unexpected UFW allow-rule count." >&2
  exit 1
fi
for port in 22 3000 3100 8546; do
  grep -Eq "${port}/tcp[[:space:]]+ALLOW IN[[:space:]]+192\.168\.50\.0/24" \
    "${work_dir}/ufw.txt"
done

active_services_json="$(printf '%s\n' "${required_services[@]}" | jq -Rsc 'split("\n")[:-1]')"
active_timers_json="$(printf '%s\n' "${required_timers[@]}" | jq -Rsc 'split("\n")[:-1]')"
pm2_json="$(jq '[.[] | {name, status:.pm2_env.status, restartCount:.pm2_env.restart_time, cwd:.pm2_env.pm_cwd}]' "${work_dir}/pm2.json")"
release_json="$(cat "${work_dir}/release.json")"
status_json="$(cat "${work_dir}/status.json")"
target_count="$(jq '.data.activeTargets | length' "${work_dir}/targets.json")"

jq -n \
  --arg auditedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg expectedSha "${expected_sha}" \
  --arg expectedRelease "${expected_release}" \
  --arg previousBootId "${previous_boot_id}" \
  --arg bootId "${boot_id}" \
  --arg soakState "${soak_state}" \
  --argjson allowSameBoot "${allow_same_boot}" \
  --argjson allowActiveSoak "${allow_active_soak}" \
  --argjson services "${active_services_json}" \
  --argjson timers "${active_timers_json}" \
  --argjson pm2 "${pm2_json}" \
  --argjson release "${release_json}" \
  --argjson status "${status_json}" \
  --argjson chainBlock "${chain_block}" \
  --argjson targetCount "${target_count}" \
  '{
    schemaVersion:1,
    auditedAt:$auditedAt,
    expectedSha:$expectedSha,
    expectedRelease:$expectedRelease,
    previousBootId:$previousBootId,
    bootId:$bootId,
    rebootProven:($bootId != $previousBootId),
    rehearsalOverrides:{allowSameBoot:$allowSameBoot,allowActiveSoak:$allowActiveSoak},
    soakState:$soakState,
    failedUnits:0,
    activeEnabledServices:$services,
    activeEnabledTimers:$timers,
    containerServicesDisabled:true,
    releaseVerification:$release,
    pm2:$pm2,
    chainBlock:$chainBlock,
    indexedStatus:$status,
    healthyPrometheusTargets:$targetCount,
    firingAlerts:0,
    expectedLanListeners:[22,3000,3100,8546],
    loopbackOnlyListeners:[3001,3002,3101,3200,5432,6379,8545,8547,9000,9090,9100],
    ufwActiveWithExactLanRules:true,
    passed:true
  }'

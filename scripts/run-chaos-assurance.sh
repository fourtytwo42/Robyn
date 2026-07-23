#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root; this runner interrupts native services one at a time." >&2
  exit 1
fi

repo="/home/hendo420/Robyn"
evidence_root="${CHAOS_EVIDENCE_ROOT:-/var/backups/robyn/chaos}"
run_id="${CHAOS_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
output="${evidence_root}/${run_id}"
events="${output}/events.jsonl"
summary="${output}/summary.json"
pm2="${repo}/node_modules/.bin/pm2"
export PM2_HOME=/home/hendo420/.pm2
mkdir -p "${output}"
chmod 0700 "${output}"
touch "${events}"
chmod 0600 "${events}"

git_sha="$(git -C "${repo}" rev-parse HEAD)"
if [[ -n "$(git -C "${repo}" status --porcelain)" ]]; then
  echo "Refusing chaos against a dirty exact release." >&2
  exit 1
fi
if [[ "$(git -C "${repo}" rev-parse '@{u}')" != "${git_sha}" ]]; then
  echo "Refusing chaos against an unpushed commit." >&2
  exit 1
fi

active_service=""
isolated_pid=""
cleanup() {
  if [[ -n "${active_service}" ]]; then
    systemctl start "${active_service}" >/dev/null 2>&1 || true
  fi
  systemctl start pm2-hendo420.service >/dev/null 2>&1 || true
  systemctl start nginx.service >/dev/null 2>&1 || true
  if [[ -n "${isolated_pid}" ]]; then
    kill "${isolated_pid}" >/dev/null 2>&1 || true
    wait "${isolated_pid}" >/dev/null 2>&1 || true
  fi
  rm -f /var/tmp/robyn-chaos-pressure.bin
}
trap cleanup EXIT

event() {
  local scenario="$1" phase="$2" result="$3" detail="$4"
  jq -nc \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg gitSha "${git_sha}" \
    --arg scenario "${scenario}" \
    --arg phase "${phase}" \
    --arg result "${result}" \
    --arg detail "${detail}" \
    '{schemaVersion:1,timestamp:$timestamp,gitSha:$gitSha,scenario:$scenario,phase:$phase,result:$result,detail:$detail}' \
    >>"${events}"
}

wait_url() {
  local url="$1"
  for _ in {1..80}; do
    curl -fsS --max-time 2 "${url}" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}

wait_pm2() {
  local name="$1"
  for _ in {1..80}; do
    status="$(runuser -u hendo420 -- env PM2_HOME="${PM2_HOME}" "${pm2}" jlist |
      jq -r --arg name "${name}" '.[]|select(.name==$name)|.pm2_env.status')"
    [[ "${status}" == "online" ]] && return 0
    sleep 0.5
  done
  return 1
}

reconcile() {
  wait_url http://127.0.0.1:3000/api/health
  runuser -u hendo420 -- env HOME=/home/hendo420 \
    "${repo}/scripts/verify-devnet-deployment.sh" \
    "${repo}/deployments/31337.json" >"${output}/reconcile-$1.log"
  event "$1" reconcile passed "authoritative deployment and application health passed"
}

event baseline start pending "capturing exact release and protocol state"
runuser -u hendo420 -- env HOME=/home/hendo420 \
  "${repo}/scripts/verify-devnet-deployment.sh" \
  "${repo}/deployments/31337.json" >"${output}/baseline-verifier.log"
curl -fsS http://127.0.0.1:3000/api/status >"${output}/baseline-status.json"
curl -fsS http://127.0.0.1:3000/api/operations >"${output}/baseline-operations.json"
event baseline finish passed "baseline captured"

mapfile -t processes < <(
  runuser -u hendo420 -- env PM2_HOME="${PM2_HOME}" "${pm2}" jlist |
    jq -r '.[].name'
)
for process in "${processes[@]}"; do
  scenario="pm2-${process}"
  before_pid="$(runuser -u hendo420 -- env PM2_HOME="${PM2_HOME}" "${pm2}" jlist |
    jq -r --arg name "${process}" '.[]|select(.name==$name)|.pid')"
  event "${scenario}" inject pending "SIGKILL pid ${before_pid}; PM2 must resurrect"
  kill -9 "${before_pid}"
  wait_pm2 "${process}"
  after_pid="$(runuser -u hendo420 -- env PM2_HOME="${PM2_HOME}" "${pm2}" jlist |
    jq -r --arg name "${process}" '.[]|select(.name==$name)|.pid')"
  if [[ "${before_pid}" == "${after_pid}" ]]; then
    event "${scenario}" recover failed "PID did not change"
    exit 1
  fi
  reconcile "${scenario}"
done

for service in redis-server postgresql minio robyn-anvil; do
  scenario="systemd-${service}"
  active_service="${service}"
  event "${scenario}" inject pending "stop one native dependency"
  systemctl stop "${service}"
  if systemctl is-active --quiet "${service}"; then
    event "${scenario}" degrade failed "service remained active"
    exit 1
  fi
  event "${scenario}" degrade passed "service interruption observed"
  systemctl start "${service}"
  active_service=""
  for _ in {1..80}; do
    systemctl is-active --quiet "${service}" && break
    sleep 0.5
  done
  systemctl is-active --quiet "${service}"
  if ! systemctl is-active --quiet pm2-hendo420.service; then
    systemctl start pm2-hendo420.service
  fi
  if ! systemctl is-active --quiet nginx.service; then
    systemctl start nginx.service
  fi
  systemctl is-active --quiet pm2-hendo420.service nginx.service
  reconcile "${scenario}"
done

scenario="bounded-disk-pressure"
event "${scenario}" inject pending "allocate bounded 128 MiB pressure file"
dd if=/dev/zero of=/var/tmp/robyn-chaos-pressure.bin bs=1M count=128 \
  status=none
test "$(stat -c %s /var/tmp/robyn-chaos-pressure.bin)" = "134217728"
rm -f /var/tmp/robyn-chaos-pressure.bin
reconcile "${scenario}"

scenario="isolated-anvil-reorg"
isolated_dir="$(mktemp -d /var/tmp/robyn-chaos-anvil.XXXXXX)"
anvil --host 127.0.0.1 --port 28545 --chain-id 31337 --silent \
  >"${isolated_dir}/anvil.log" 2>&1 &
isolated_pid="$!"
for _ in {1..40}; do
  curl -fsS -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
    http://127.0.0.1:28545 >/dev/null 2>&1 && break
  sleep 0.25
done
for depth in 1 5 20; do
  snapshot="$(curl -fsS -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"evm_snapshot","params":[]}' \
    http://127.0.0.1:28545 | jq -er '.result')"
  for _ in $(seq 1 "${depth}"); do
    curl -fsS -H 'content-type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"evm_mine","params":[]}' \
      http://127.0.0.1:28545 >/dev/null
  done
  head_before="$(curl -fsS -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
    http://127.0.0.1:28545 | jq -er '.result')"
  reverted="$(curl -fsS -H 'content-type: application/json' \
    --data "$(jq -nc --arg snapshot "${snapshot}" '{jsonrpc:"2.0",id:1,method:"evm_revert",params:[$snapshot]}')" \
    http://127.0.0.1:28545 | jq -er '.result')"
  [[ "${reverted}" == "true" ]]
  head_after="$(curl -fsS -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
    http://127.0.0.1:28545 | jq -er '.result')"
  event "${scenario}-${depth}" recover passed "head ${head_before} reverted to ${head_after}"
done
kill "${isolated_pid}"
wait "${isolated_pid}" 2>/dev/null || true
isolated_pid=""
rm -rf -- "${isolated_dir}"
reconcile "${scenario}"

backup="$(find /var/backups/robyn -maxdepth 1 -type f \
  -name 'robyn-state-*.tar.zst.age' -printf '%T@ %p\n' |
  sort -nr | head -1 | cut -d' ' -f2-)"
test -n "${backup}"
scenario="corrupt-backup-input"
corrupt="${output}/corrupt-backup.age"
cp "${backup}" "${corrupt}"
printf '\x00' | dd of="${corrupt}" bs=1 seek=32 conv=notrunc status=none
sha256sum "${corrupt}" >"${corrupt}.sha256"
if "${repo}/scripts/rehearse-restore.sh" "${corrupt}" \
  >"${output}/corrupt-restore.log" 2>&1; then
  event "${scenario}" reject failed "corrupt encrypted input was accepted"
  exit 1
fi
event "${scenario}" reject passed "corrupt encrypted input rejected fail-closed"
reconcile "${scenario}"

finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
scenario_count="$(jq -s '[.[].scenario]|unique|length' "${events}")"
failed_count="$(jq -s '[.[]|select(.result=="failed")]|length' "${events}")"
jq -n \
  --arg generatedAt "${finished_at}" \
  --arg gitSha "${git_sha}" \
  --argjson scenarioCount "${scenario_count}" \
  --argjson failedCount "${failed_count}" \
  --arg events "${events}" \
  '{
    schemaVersion:1,generatedAt:$generatedAt,gitSha:$gitSha,
    scenarioCount:$scenarioCount,failedCount:$failedCount,
    liveFinancialStateReconciled:($failedCount==0),
    destructiveChainAndBackupTestsIsolated:true,
    events:$events,passed:($failedCount==0)
  }' >"${summary}"
jq -e '.passed' "${summary}" >/dev/null
(cd "${output}" && sha256sum ./* >SHA256SUMS)
printf 'chaos=passed\nscenarios=%s\nsummary=%s\n' \
  "${scenario_count}" "${summary}"

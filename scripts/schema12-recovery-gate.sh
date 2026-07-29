#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "run as root" >&2; exit 1; }
run_id="${1:?usage: schema12-recovery-gate.sh RUN_ID}"
[[ "${run_id}" =~ ^[a-z0-9][a-z0-9-]{2,63}$ ]]
release="$(readlink -f /opt/robyn/testnet-current)"
[[ "${release}" == /opt/robyn/testnet-releases/* ]]
evidence="/var/lib/robyn/testnet-recovery/${run_id}"
backup_root="/var/backups/robyn"
work="$(mktemp -d /var/tmp/robyn-schema12-recovery.XXXXXX)"
database_restore_dump="$(mktemp /var/tmp/robyn-schema12-database.XXXXXX)"
restore_db="robyn_schema12_restore_$(date -u +%Y%m%d%H%M%S)_${RANDOM}"
redis_pid=""
minio_pid=""
ipfs_pid=""
blocked_rules=()
writers_quiesced=false
writer_processes=(
  robyn-rpc-gateway-testnet
  robyn-api-testnet
  robyn-indexer-testnet
  robyn-projector-testnet
  robyn-keeper-testnet
  robyn-artifacts-testnet
)
mkdir -p "${evidence}" "${backup_root}"
chmod 0700 "${evidence}"
chmod 0711 "${work}"

pm2="${release}/node_modules/.bin/pm2"
export PM2_HOME=/home/hendo420/.pm2
database="$(
  runuser -u hendo420 -- env PM2_HOME="${PM2_HOME}" "${pm2}" jlist |
    jq -er \
      '.[] | select(.name=="robyn-indexer-testnet") | .pm2_env.env.PGDATABASE'
)"
[[ "${database}" =~ ^robyn_testnet_schema12_[A-Za-z0-9_]+$ ]] || {
  echo "refusing non-schema-12 active database: ${database}" >&2
  exit 1
}
jq -e '.schemaVersion == 12 and .chainId == 46630' \
  "${release}/deployments/46630-v4.json" >/dev/null

resume_writers() {
  if [[ "${writers_quiesced}" == true ]]; then
    runuser -u hendo420 -- env PM2_HOME="${PM2_HOME}" "${pm2}" restart "${writer_processes[@]}" >/dev/null
    writers_quiesced=false
  fi
}

restore_application_stack() {
  systemctl reset-failed pm2-hendo420 nginx
  if ! systemctl is-active --quiet pm2-hendo420; then
    if ! systemctl start pm2-hendo420; then
      runuser -u hendo420 -- env PM2_HOME="${PM2_HOME}" "${pm2}" kill >/dev/null 2>&1 || true
      systemctl reset-failed pm2-hendo420
      systemctl start pm2-hendo420
    fi
  fi
  systemctl start nginx
}

cleanup() {
  resume_writers || true
  for rule in "${blocked_rules[@]:-}"; do
    ip="${rule%%:*}"
    port="${rule##*:}"
    iptables -D OUTPUT -p tcp -d "${ip}" --dport "${port}" -j REJECT >/dev/null 2>&1 || true
  done
  [[ -z "${redis_pid}" ]] || kill "${redis_pid}" >/dev/null 2>&1 || true
  [[ -z "${minio_pid}" ]] || kill "${minio_pid}" >/dev/null 2>&1 || true
  [[ -z "${ipfs_pid}" ]] || kill "${ipfs_pid}" >/dev/null 2>&1 || true
  wait "${redis_pid:-}" "${minio_pid:-}" "${ipfs_pid:-}" >/dev/null 2>&1 || true
  runuser -u postgres -- dropdb --if-exists "${restore_db}" >/dev/null 2>&1 || true
  rm -f -- "${database_restore_dump}"
  rm -rf -- "${work}"
}
trap cleanup EXIT

for tool in age curl getent gh iptables jq pg_dump pg_restore psql redis-cli sha256sum tar zstd /usr/local/bin/mcli; do
  command -v "${tool}" >/dev/null
 done
[[ -r /etc/robyn/backup-age-recipient.txt ]]
[[ -r /etc/robyn/backup-age-identity.txt ]]
[[ -r /etc/robyn/backup.env ]]

status_json() {
  curl -skf --max-time 10 https://testnet.sherwoodforest.trade/admin/health/status
}
gateway_json() {
  curl -s --max-time 10 http://127.0.0.1:18548/health
}

wait_gateway() {
  local label="$1"
  local expression="$2"
  for _ in {1..150}; do
    if gateway_json >"${evidence}/gateway-${label}.json.tmp" 2>/dev/null ||
      [[ -s "${evidence}/gateway-${label}.json.tmp" ]]; then
      if jq -e "${expression}" "${evidence}/gateway-${label}.json.tmp" >/dev/null 2>&1; then
        mv "${evidence}/gateway-${label}.json.tmp" "${evidence}/gateway-${label}.json"
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

block_endpoint() {
  local host="$1"
  local port="$2"
  local ips=()
  mapfile -t ips < <(getent ahostsv4 "${host}" | awk '{print $1}' | sort -u)
  [[ "${#ips[@]}" -gt 0 ]]
  for ip in "${ips[@]}"; do
    iptables -I OUTPUT -p tcp -d "${ip}" --dport "${port}" -j REJECT
    blocked_rules+=("${ip}:${port}")
  done
}

unblock_endpoints() {
  for rule in "${blocked_rules[@]:-}"; do
    ip="${rule%%:*}"
    port="${rule##*:}"
    iptables -D OUTPUT -p tcp -d "${ip}" --dport "${port}" -j REJECT
  done
  blocked_rules=()
}

wait_healthy() {
  local label="$1"
  for _ in {1..120}; do
    if status_json >"${evidence}/health-${label}.json.tmp" 2>/dev/null &&
      jq -e '.overall=="ok" and .protocol.status=="ok" and .protocol.routerSolvent==true and .protocol.daoStreamConserved==true and .protocol.creatorStreamConserved==true and (.protocol.rewardStreamMismatchCount|tonumber)==0 and (.indexer.ingestionLagBlocks|tonumber)<=100 and (.indexer.projectionLagBlocks|tonumber)<=100' "${evidence}/health-${label}.json.tmp" >/dev/null; then
      mv "${evidence}/health-${label}.json.tmp" "${evidence}/health-${label}.json"
      return 0
    fi
    sleep 1
  done
  return 1
}

database_fingerprint() {
  local db="$1"
  runuser -u hendo420 -- psql -X -d "${db}" -At <<'SQL' | sha256sum | cut -d' ' -f1
SELECT format(
  'SELECT %L || E''\t'' || count(*)::text || E''\t'' || md5(coalesce(string_agg(md5(to_jsonb(t)::text), '''' ORDER BY md5(to_jsonb(t)::text)), '''')) FROM public.%I t;',
  tablename,
  tablename
)
FROM pg_tables
WHERE schemaname='public'
ORDER BY tablename
\gexec
SQL
}

wait_healthy baseline
served_sha="$(jq -er .gitSha "${release}/testnet-release-manifest.json")"
manifest_sha="$(sha256sum "${release}/deployments/46630-v4.json" | cut -d' ' -f1)"
runuser -u hendo420 -- env PM2_HOME="${PM2_HOME}" "${pm2}" jlist >"${evidence}/pm2-before.json"
status_json >"${evidence}/status-before.json"
runuser -u hendo420 -- psql -d "${database}" -Atqc "select count(*) from job_audit where state='failed'" >"${evidence}/failed-jobs-before.txt"

snapshot="${work}/snapshot"
mkdir -p "${snapshot}/database" "${snapshot}/redis" "${snapshot}/artifacts" "${snapshot}/ipfs" "${snapshot}/configuration" "${snapshot}/journals"
runuser -u hendo420 -- env PM2_HOME="${PM2_HOME}" "${pm2}" stop "${writer_processes[@]}" >/dev/null
writers_quiesced=true
source_fingerprint="$(database_fingerprint "${database}")"
runuser -u hendo420 -- pg_dump --format=custom --no-owner --no-acl "${database}" >"${snapshot}/database/database.dump"
runuser -u hendo420 -- psql -X -d "${database}" -At <<'SQL' >"${snapshot}/database/table-counts.tsv"
SELECT format(
  'SELECT %L || E''\t'' || count(*)::text FROM public.%I;',
  tablename,
  tablename
)
FROM pg_tables
WHERE schemaname='public'
ORDER BY tablename
\gexec
SQL
redis-cli SAVE >/dev/null
cp /var/lib/redis/dump.rdb "${snapshot}/redis/dump.rdb"
redis-cli INFO keyspace >"${snapshot}/redis/keyspace.txt"

# shellcheck disable=SC1091
source /etc/robyn/backup.env
mc_config="${work}/mc"
mkdir -p "${mc_config}"
/usr/local/bin/mcli --config-dir "${mc_config}" alias set source "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" >/dev/null
/usr/local/bin/mcli --config-dir "${mc_config}" mirror --overwrite --preserve "source/${MINIO_BUCKET}" "${snapshot}/artifacts" >/dev/null
curl -fsS -X POST http://127.0.0.1:5001/api/v0/pin/ls?type=recursive | jq -r '.Keys|keys[]' | sort >"${snapshot}/ipfs/pins.txt"
runuser -u hendo420 -- psql -d "${database}" -Atqc "select cid||E'\t'||artifact_sha256 from ipfs_pins where local_status='pinned' order by cid" >"${snapshot}/ipfs/pin-artifacts.tsv"
cp "${release}/deployments/46630-v4.json" "${snapshot}/configuration/"
cp "${release}/testnet-release-manifest.json" "${snapshot}/configuration/"
sed -E 's#=.*#=<redacted>#' /home/hendo420/.config/robyn/testnet/release.env >"${snapshot}/configuration/release-env-inventory.txt"
systemctl cat pm2-hendo420.service postgresql.service redis-server.service minio.service robyn-ipfs.service nginx.service >"${snapshot}/configuration/systemd-units.txt"
for journal_root in \
  /home/hendo420/.local/state/robyn-testnet-campaigns \
  /var/lib/robyn/testnet-endurance; do
  [[ -d "${journal_root}" ]] || continue
  find "${journal_root}" -type f \
    \( -name 'state.json' -o -name 'evidence.json' -o -name '*.jsonl' -o -name '*journal*' \) \
    -exec cp --parents {} "${snapshot}/journals" \;
done
resume_writers
wait_healthy backup-resumed
jq -n --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg gitSha "${served_sha}" --arg manifestSha256 "${manifest_sha}" --arg database "${database}" --arg databaseFingerprint "${source_fingerprint}" '{schemaVersion:1,createdAt:$createdAt,gitSha:$gitSha,manifestSha256:$manifestSha256,chainId:46630,database:$database,databaseFingerprint:$databaseFingerprint,secretsIncluded:false}' >"${snapshot}/manifest.json"
(cd "${snapshot}" && find . -type f -print0 | sort -z | xargs -0 sha256sum >"${work}/snapshot.SHA256SUMS")
mv "${work}/snapshot.SHA256SUMS" "${snapshot}/SHA256SUMS"
archive="${backup_root}/schema12-${run_id}.tar.zst"
encrypted="${archive}.age"
tar --zstd -cf "${archive}" -C "${snapshot}" .
age -r "$(tr -d '\r\n' </etc/robyn/backup-age-recipient.txt)" -o "${encrypted}" "${archive}"
rm -f "${archive}"
chmod 0600 "${encrypted}"
sha256sum "${encrypted}" >"${encrypted}.sha256"
cp "${encrypted}.sha256" "${evidence}/encrypted-backup.sha256"

restored="${work}/restored"
mkdir -p "${restored}"
(cd "$(dirname "${encrypted}")" && sha256sum -c "$(basename "${encrypted}.sha256")")
age -d -i /etc/robyn/backup-age-identity.txt -o "${work}/restore.tar.zst" "${encrypted}"
tar --zstd -xf "${work}/restore.tar.zst" -C "${restored}"
(cd "${restored}" && sha256sum -c SHA256SUMS)
install -o postgres -g postgres -m 0600 "${restored}/database/database.dump" "${database_restore_dump}"
runuser -u postgres -- createdb "${restore_db}"
runuser -u postgres -- pg_restore --no-owner --no-acl -d "${restore_db}" "${database_restore_dump}"
runuser -u postgres -- psql -d "${restore_db}" -c 'GRANT USAGE ON SCHEMA public TO hendo420; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO hendo420;' >/dev/null
restored_fingerprint="$(database_fingerprint "${restore_db}")"
[[ "${source_fingerprint}" == "${restored_fingerprint}" ]]

redis_dir="${work}/redis"
mkdir -p "${redis_dir}"
cp "${restored}/redis/dump.rdb" "${redis_dir}/dump.rdb"
chown -R hendo420:hendo420 "${redis_dir}"
runuser -u hendo420 -- redis-server --bind 127.0.0.1 --port 16379 --dir "${redis_dir}" --dbfilename dump.rdb --appendonly no >"${evidence}/redis-restore.log" 2>&1 &
redis_pid=$!
for _ in {1..60}; do redis-cli -p 16379 ping 2>/dev/null | grep -q PONG && break; sleep 0.25; done
redis-cli -p 16379 ping | grep -q PONG
redis-cli -p 16379 INFO keyspace >"${evidence}/redis-restored-keyspace.txt"

minio_dir="${work}/minio"
mkdir -p "${minio_dir}"
chown -R hendo420:hendo420 "${minio_dir}"
runuser -u hendo420 -- env MINIO_ROOT_USER=restoreuser MINIO_ROOT_PASSWORD=restore-password-isolated minio server "${minio_dir}" --address 127.0.0.1:19000 --console-address 127.0.0.1:19001 >"${evidence}/minio-restore.log" 2>&1 &
minio_pid=$!
for _ in {1..120}; do curl -fsS http://127.0.0.1:19000/minio/health/ready >/dev/null 2>&1 && break; sleep 0.25; done
curl -fsS http://127.0.0.1:19000/minio/health/ready >/dev/null
for _ in {1..60}; do
  if /usr/local/bin/mcli --config-dir "${mc_config}" alias set restored http://127.0.0.1:19000 restoreuser restore-password-isolated >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
/usr/local/bin/mcli --config-dir "${mc_config}" admin info restored >/dev/null
/usr/local/bin/mcli --config-dir "${mc_config}" mb --ignore-existing restored/robyn-artifacts >/dev/null
/usr/local/bin/mcli --config-dir "${mc_config}" mirror --overwrite "${restored}/artifacts" restored/robyn-artifacts >/dev/null
source_count="$(find "${restored}/artifacts" -type f | wc -l)"
restored_count="$(/usr/local/bin/mcli --config-dir "${mc_config}" --json du restored/robyn-artifacts | jq -er '.objects')"
printf '%s\n' "${source_count}" >"${evidence}/minio-source-object-count.txt"
printf '%s\n' "${restored_count}" >"${evidence}/minio-restored-object-count.txt"
if [[ "${source_count}" != "${restored_count}" ]]; then
  echo "MinIO restored object count mismatch: source=${source_count} restored=${restored_count}" >&2
  exit 1
fi

ipfs_dir="${work}/ipfs"
mkdir -p "${ipfs_dir}"
chown -R hendo420:hendo420 "${ipfs_dir}"
runuser -u hendo420 -- env IPFS_PATH="${ipfs_dir}" ipfs init --profile=server >/dev/null
runuser -u hendo420 -- env IPFS_PATH="${ipfs_dir}" ipfs config Addresses.API /ip4/127.0.0.1/tcp/15001
runuser -u hendo420 -- env IPFS_PATH="${ipfs_dir}" ipfs config Addresses.Gateway /ip4/127.0.0.1/tcp/18080
runuser -u hendo420 -- env IPFS_PATH="${ipfs_dir}" ipfs config --json Addresses.Swarm '[]'
runuser -u hendo420 -- env IPFS_PATH="${ipfs_dir}" ipfs daemon --offline >"${evidence}/ipfs-restore.log" 2>&1 &
ipfs_pid=$!
for _ in {1..60}; do curl -fsS -X POST http://127.0.0.1:15001/api/v0/version >/dev/null 2>&1 && break; sleep 0.25; done
curl -fsS -X POST http://127.0.0.1:15001/api/v0/version >/dev/null
while IFS=$'\t' read -r cid sha; do
  [[ -n "${cid}" ]] || continue
  object="$(find "${restored}/artifacts" -type f -name "${sha}" -print -quit)"
  [[ -n "${object}" ]]
  actual="$(curl -fsS -X POST -F "file=@${object};filename=${sha};type=application/octet-stream" 'http://127.0.0.1:15001/api/v0/add?cid-version=1&hash=sha2-256&pin=true&raw-leaves=true&wrap-with-directory=false' | tail -1 | jq -er .Hash)"
  [[ "${actual}" == "${cid}" ]]
done <"${restored}/ipfs/pin-artifacts.tsv"

if ! runuser -u hendo420 -- env HOME=/home/hendo420 gh release view schema12-recovery-backups -R fourtytwo42/Robyn >/dev/null 2>&1; then
  runuser -u hendo420 -- env HOME=/home/hendo420 gh release create schema12-recovery-backups -R fourtytwo42/Robyn --target main --title 'Schema-12 encrypted recovery backups' --notes 'Encrypted testnet recovery artifacts. No secret or recovery identity is included.' >/dev/null
fi
upload_encrypted="${work}/$(basename "${encrypted}")"
install -o hendo420 -g hendo420 -m 0600 "${encrypted}" "${upload_encrypted}"
(
  cd "${work}"
  sha256sum "$(basename "${upload_encrypted}")" >"$(basename "${upload_encrypted}").sha256"
)
chown hendo420:hendo420 "${upload_encrypted}.sha256"
runuser -u hendo420 -- env HOME=/home/hendo420 gh release upload schema12-recovery-backups "${upload_encrypted}" "${upload_encrypted}.sha256" -R fourtytwo42/Robyn --clobber >/dev/null

# Stop isolated restore services before live one-fault drills.
kill "${redis_pid}" "${minio_pid}" "${ipfs_pid}" >/dev/null 2>&1 || true
wait "${redis_pid}" "${minio_pid}" "${ipfs_pid}" >/dev/null 2>&1 || true
redis_pid=""; minio_pid=""; ipfs_pid=""

for process in robyn-rpc-gateway-testnet robyn-api-testnet robyn-indexer-testnet robyn-projector-testnet robyn-keeper-testnet; do
  before="$(runuser -u hendo420 -- env PM2_HOME="${PM2_HOME}" "${pm2}" jlist | jq -r --arg n "${process}" '.[]|select(.name==$n)|.pid')"
  kill -9 "${before}"
  for _ in {1..60}; do
    after="$(runuser -u hendo420 -- env PM2_HOME="${PM2_HOME}" "${pm2}" jlist | jq -r --arg n "${process}" '.[]|select(.name==$n)|select(.pm2_env.status=="online")|.pid')"
    [[ -n "${after}" && "${after}" != "${before}" ]] && break
    sleep 1
  done
  [[ -n "${after}" && "${after}" != "${before}" ]]
  wait_healthy "pm2-${process}"
done

for service in redis-server postgresql minio robyn-ipfs nginx; do
  systemctl stop "${service}"
  if systemctl is-active --quiet "${service}"; then
    echo "${service} did not stop" >&2
    exit 1
  fi
  systemctl start "${service}"
  for _ in {1..60}; do systemctl is-active --quiet "${service}" && break; sleep 1; done
  systemctl is-active --quiet "${service}"
  restore_application_stack
  wait_healthy "systemd-${service}"
done

(cd "${release}" && runuser -u hendo420 -- \
  ./apps/rpc-gateway/node_modules/.bin/vitest run \
  apps/rpc-gateway/test --no-file-parallelism) \
  >"${evidence}/rpc-gateway-integration-fixture.txt"

block_endpoint 192.168.50.117 8547
wait_gateway lan-interrupted '.status=="degraded" and .activeProvider=="fallback" and .primary.healthy==false and .fallback.healthy==true'
status_json >"${evidence}/lan-interruption-status.json"
unblock_endpoints
wait_gateway lan-recovered '.status=="ok" and .activeProvider=="primary" and .primary.healthy==true and .fallback.healthy==true'

block_endpoint robinhood-testnet.g.alchemy.com 443
wait_gateway alchemy-interrupted '.status=="degraded" and .activeProvider=="primary" and .primary.healthy==true and .fallback.healthy==false'
status_json >"${evidence}/alchemy-interruption-status.json"

block_endpoint 192.168.50.117 8547
wait_gateway both-interrupted '.status=="unavailable" and .primary.healthy==false and .fallback.healthy==false'
status_json >"${evidence}/both-rpc-interruption-status.json" || true
curl -sS --max-time 10 -o "${evidence}/both-rpc-response.json" -w '%{http_code}\n' -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:18548/ >"${evidence}/both-rpc-http-status.txt" || true
[[ "$(cat "${evidence}/both-rpc-http-status.txt")" == "503" ]]

unblock_endpoints
wait_gateway rpc-recovered '.status=="ok" and .activeProvider=="primary" and .primary.healthy==true and .fallback.healthy==true'
wait_healthy rpc-recovered

runuser -u hendo420 -- psql -d "${database}" -Atqc "select count(*) from job_audit where state='failed'" >"${evidence}/failed-jobs-after.txt"
[[ "$(cat "${evidence}/failed-jobs-after.txt")" == "0" ]]
runuser -u hendo420 -- psql -d "${database}" -Atqc "select count(*) from raw_logs" >"${evidence}/raw-log-count.txt"
runuser -u hendo420 -- psql -d "${database}" -Atqc "select count(*)-count(distinct (chain_id,transaction_hash,log_index)) from raw_logs" >"${evidence}/duplicate-raw-logs.txt"
[[ "$(cat "${evidence}/duplicate-raw-logs.txt")" == "0" ]]
status_json >"${evidence}/status-after.json"
runuser -u hendo420 -- env PM2_HOME="${PM2_HOME}" "${pm2}" jlist >"${evidence}/pm2-after.json"

jq -n --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg releaseSha "${served_sha}" --arg manifestSha256 "${manifest_sha}" --arg encryptedBackup "${encrypted}" --arg sourceDatabase "${database}" --arg restoredDatabase "${restore_db}" --arg sourceFingerprint "${source_fingerprint}" --arg restoredFingerprint "${restored_fingerprint}" --argjson artifactCount "${source_count}" '{schemaVersion:1,completedAt:$completedAt,releaseSha:$releaseSha,manifestSha256:$manifestSha256,encryptedBackup:$encryptedBackup,sourceDatabase:$sourceDatabase,restoredDatabase:$restoredDatabase,databaseFingerprintMatch:($sourceFingerprint==$restoredFingerprint),sourceFingerprint:$sourceFingerprint,restoredFingerprint:$restoredFingerprint,artifactCount:$artifactCount,redisRestored:true,minioRestored:true,ipfsReproduced:true,pm2Recovery:true,nativeServiceRecovery:true,rpcRecovery:true,noDuplicateCanonicalLogs:true,noFailedFinancialJobs:true,offVmBackup:true,passed:true}' >"${evidence}/summary.json"
(cd "${evidence}" && find . -type f -print0 | sort -z | xargs -0 sha256sum >"${work}/evidence.SHA256SUMS")
mv "${work}/evidence.SHA256SUMS" "${evidence}/SHA256SUMS"
printf 'recovery=passed\nsummary=%s\nbackup=%s\n' "${evidence}/summary.json" "${encrypted}"

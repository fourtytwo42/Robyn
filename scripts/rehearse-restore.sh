#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root to access the recovery identity." >&2
  exit 1
fi
if [[ "${1:-}" == "" ]]; then
  echo "Usage: sudo scripts/rehearse-restore.sh /var/backups/robyn/robyn-state-*.tar.zst.age" >&2
  exit 1
fi

encrypted="$(readlink -f "${1}")"
checksum="${encrypted}.sha256"
identity="/etc/robyn/backup-age-identity.txt"
work="$(mktemp -d /var/tmp/robyn-restore.XXXXXX)"
chmod 0711 "${work}"
bundle="${work}/state.tar.zst"
restore="${work}/restore"
database="robyn_restore_$(date -u +%Y%m%d%H%M%S)_${RANDOM}"
anvil_pid=""
redis_pid=""
minio_pid=""
edge_pid=""
app_pids=()
live_current="$(readlink -f /opt/robyn/current)"
live_deployment_sha="$(sha256sum /home/hendo420/Robyn/deployments/31337.json | cut -d' ' -f1)"
live_chain_state_sha="$(
  curl -fsS -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"anvil_dumpState","params":[]}' \
    http://127.0.0.1:8545 | jq -er '.result' | sha256sum | cut -d' ' -f1
)"

database_fingerprint() {
  local database_name="$1"
  local table_name
  local table_digest
  while IFS= read -r table_name; do
    table_digest="$(
      runuser -u hendo420 -- psql -X -v ON_ERROR_STOP=1 \
        -d "${database_name}" -Atqc "
          SELECT coalesce(
            md5(string_agg(row_json, '' ORDER BY row_json)),
            md5('')
          )
          FROM (
            SELECT to_jsonb(source_row)::text AS row_json
            FROM public.\"${table_name}\" AS source_row
          ) AS canonical_rows
        "
    )"
    printf '%s\t%s\n' "${table_name}" "${table_digest}"
  done < <(
    runuser -u hendo420 -- psql -X -v ON_ERROR_STOP=1 \
      -d "${database_name}" -Atqc "
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN ('service_heartbeats', 'indexer_checkpoints')
        ORDER BY tablename
      "
  ) | sha256sum | cut -d' ' -f1
}

# Heartbeats and the indexer's last-poll timestamp are intentionally volatile.
# Every durable financial, audit, queue, profile, media, and chain projection row
# remains inside this order-independent semantic fingerprint.
live_database_sha="$(database_fingerprint robyn)"

cleanup() {
  if [[ -n "${edge_pid}" ]]; then
    kill "${edge_pid}" 2>/dev/null || true
    wait "${edge_pid}" 2>/dev/null || true
  fi
  for app_pid in "${app_pids[@]}"; do
    kill "${app_pid}" 2>/dev/null || true
  done
  for app_pid in "${app_pids[@]}"; do
    wait "${app_pid}" 2>/dev/null || true
  done
  if [[ -n "${minio_pid}" ]]; then
    kill "${minio_pid}" 2>/dev/null || true
    wait "${minio_pid}" 2>/dev/null || true
  fi
  if [[ -n "${redis_pid}" ]]; then
    kill "${redis_pid}" 2>/dev/null || true
    wait "${redis_pid}" 2>/dev/null || true
  fi
  if [[ -n "${anvil_pid}" ]]; then
    kill "${anvil_pid}" 2>/dev/null || true
    wait "${anvil_pid}" 2>/dev/null || true
  fi
  runuser -u postgres -- dropdb --if-exists "${database}" >/dev/null 2>&1 || true
  rm -rf -- "${work}"
}
trap cleanup EXIT

test -r "${encrypted}"
test -r "${checksum}"
test -r "${identity}"
for tool in age anvil curl file git jq minio mcli nginx node pg_dump pg_restore pnpm psql redis-server runuser sha256sum tar zstd; do
  command -v "${tool}" >/dev/null
done

(cd "$(dirname "${encrypted}")" && sha256sum -c "$(basename "${checksum}")")
age -d -i "${identity}" -o "${bundle}" "${encrypted}"
install -d -m 0700 "${restore}"
tar --zstd -xf "${bundle}" -C "${restore}"
(cd "${restore}" && sha256sum -c SHA256SUMS)
git_sha="$(jq -er '.gitSha' "${restore}/manifest.json")"

runuser -u postgres -- createdb "${database}"
runuser -u postgres -- pg_restore --no-owner --no-acl -d "${database}" <"${restore}/database/robyn.dump"
runuser -u postgres -- psql -d "${database}" -v ON_ERROR_STOP=1 <<'SQL'
GRANT USAGE ON SCHEMA public TO hendo420;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hendo420;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO hendo420;
SQL
while IFS=$'\t' read -r table expected; do
  actual="$(runuser -u postgres -- psql -d "${database}" -Atqc "SELECT count(*) FROM \"public\".\"${table}\"")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Database row-count mismatch for ${table}: ${actual} != ${expected}" >&2
    exit 1
  fi
done <"${restore}/database/table-counts.tsv"

artifact_count=0
while IFS= read -r -d '' object; do
  digest="$(sha256sum "${object}" | cut -d' ' -f1)"
  expected="$(basename "${object}")"
  if [[ "${expected}" != "${digest}" ]]; then
    echo "Restored artifact hash mismatch: ${object}" >&2
    exit 1
  fi
  artifact_count=$((artifact_count + 1))
done < <(find "${restore}/artifacts" -type f -print0)
manifest_artifacts="$(jq -r '.artifactCount' "${restore}/manifest.json")"
if [[ "${artifact_count}" != "${manifest_artifacts}" ]]; then
  echo "Restored artifact count mismatch." >&2
  exit 1
fi

anvil \
  --host 127.0.0.1 \
  --port 18545 \
  --chain-id 31337 \
  --no-request-size-limit \
  --silent >"${work}/anvil.log" 2>&1 &
anvil_pid=$!
for _ in {1..30}; do
  if curl -fsS -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:18545 >"${work}/chain.json" 2>/dev/null; then
    break
  fi
  sleep 0.25
done
if ! kill -0 "${anvil_pid}" 2>/dev/null; then
  cat "${work}/anvil.log" >&2
  exit 1
fi
jq -n --rawfile state "${restore}/anvil/state.json" '{jsonrpc:"2.0",id:1,method:"anvil_loadState",params:[($state | rtrimstr("\n"))]}' >"${work}/load-request.json"
curl -fsS -H 'content-type: application/json' --data-binary @"${work}/load-request.json" http://127.0.0.1:18545 >"${work}/load-result.json"
if [[ "$(jq -r '.result' "${work}/load-result.json")" != "true" ]]; then
  echo "Anvil rejected the restored RPC state." >&2
  exit 1
fi
chain_id="$(jq -r '.result' "${work}/chain.json")"
if [[ "${chain_id}" != "0x7a69" ]]; then
  echo "Restored Anvil chain ID mismatch: ${chain_id}" >&2
  exit 1
fi
factory="$(jq -r '.contracts.factory' "${restore}/anvil/deployment.json")"
curl -fsS -H 'content-type: application/json' --data "$(jq -nc --arg address "${factory}" '{jsonrpc:"2.0",id:1,method:"eth_getCode",params:[$address,"latest"]}')" http://127.0.0.1:18545 >"${work}/code.json"
if [[ "$(jq -r '.result' "${work}/code.json")" == "0x" ]]; then
  echo "Restored factory bytecode is missing." >&2
  exit 1
fi

source_dir="${work}/source"
install -d -o hendo420 -g hendo420 -m 0700 "${source_dir}"
runuser -u hendo420 -- git clone --quiet --no-checkout \
  /home/hendo420/Robyn "${source_dir}"
runuser -u hendo420 -- git -C "${source_dir}" checkout \
  --quiet --detach "${git_sha}"
if [[ -n "$(runuser -u hendo420 -- git -C "${source_dir}" status --porcelain)" ]]; then
  echo "Recovery source checkout is dirty." >&2
  exit 1
fi
source_epoch="$(
  runuser -u hendo420 -- git -C "${source_dir}" show \
    -s --format=%ct "${git_sha}"
)"
if ! runuser -u hendo420 -- env \
  HOME=/home/hendo420 \
  TZ=UTC \
  LC_ALL=C \
  SOURCE_DATE_EPOCH="${source_epoch}" \
  ROBYN_BUILD_ID="${git_sha}" \
  bash -lc "
      cd '${source_dir}'
      export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=\"\$(node scripts/prepare-next-build-inputs.mjs '${source_dir}' /home/hendo420/.config/robyn/next-build-secrets.json)\"
      pnpm install --frozen-lockfile --package-import-method=copy
      pnpm build
    " >"${work}/recovery-build.log" 2>&1; then
  cat "${work}/recovery-build.log" >&2
  exit 1
fi

install -d -o hendo420 -g hendo420 -m 0700 "${work}/redis" "${work}/minio"
runuser -u hendo420 -- redis-server \
  --bind 127.0.0.1 --port 16379 --dir "${work}/redis" \
  --save '' --appendonly no >"${work}/redis.log" 2>&1 &
redis_pid=$!
runuser -u hendo420 -- env \
  MINIO_ROOT_USER=robynrestore \
  MINIO_ROOT_PASSWORD=robyn-restore-isolated-only \
  minio server "${work}/minio" \
  --address 127.0.0.1:19000 --console-address 127.0.0.1:19001 \
  >"${work}/minio.log" 2>&1 &
minio_pid=$!
for _ in {1..60}; do
  if redis-cli -p 16379 ping 2>/dev/null | grep -q PONG &&
    curl -fsS http://127.0.0.1:19000/minio/health/live >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
redis-cli -p 16379 ping | grep -q PONG
curl -fsS http://127.0.0.1:19000/minio/health/live >/dev/null
mcli alias set robyn-restore http://127.0.0.1:19000 \
  robynrestore robyn-restore-isolated-only >/dev/null
mcli mb --ignore-existing robyn-restore/robyn-artifacts >/dev/null
mcli mirror --overwrite "${restore}/artifacts" \
  robyn-restore/robyn-artifacts >/dev/null

common_env=(
  HOME=/home/hendo420
  NODE_ENV=production
  PGHOST=/var/run/postgresql
  PGDATABASE="${database}"
  PGUSER=hendo420
  REDIS_URL=redis://127.0.0.1:16379
  ROBYN_OPERATOR_RPC_URL=http://127.0.0.1:18545
  ROBYN_MANIFEST="${source_dir}/deployments/31337.json"
)
runuser -u hendo420 -- env "${common_env[@]}" \
  HOST=127.0.0.1 PORT=13200 \
  S3_ENDPOINT=http://127.0.0.1:19000 S3_REGION=us-east-1 \
  S3_BUCKET=robyn-artifacts S3_ACCESS_KEY_ID=robynrestore \
  S3_SECRET_ACCESS_KEY=robyn-restore-isolated-only \
  node "${source_dir}/apps/artifacts/dist/server.js" \
  >"${work}/artifacts.log" 2>&1 &
app_pids+=("$!")
runuser -u hendo420 -- env "${common_env[@]}" \
  HOST=127.0.0.1 PORT=13101 CHAIN_ID=31337 \
  ROBYN_QUEUE_NAME=robyn-restore-conversions \
  ROBYN_AUTH_ORIGINS=http://127.0.0.1:13000 \
  ROBYN_ARTIFACT_SERVICE_URL=http://127.0.0.1:13200 \
  node "${source_dir}/apps/api/dist/server.js" \
  >"${work}/api.log" 2>&1 &
app_pids+=("$!")
runuser -u hendo420 -- env "${common_env[@]}" \
  ROBYN_ENV=robyn-devnet ROBYN_QUEUE_NAME=robyn-restore-conversions \
  KEEPER_SCAN_MS=5000 \
  node "${source_dir}/apps/keeper/dist/server.js" \
  >"${work}/keeper.log" 2>&1 &
app_pids+=("$!")
runuser -u hendo420 -- env "${common_env[@]}" \
  INDEXER_POLL_MS=3000 \
  node "${source_dir}/apps/indexer/dist/server.js" \
  >"${work}/indexer.log" 2>&1 &
app_pids+=("$!")
runuser -u hendo420 -- env \
  HOME=/home/hendo420 NODE_ENV=production HOSTNAME=127.0.0.1 PORT=13002 \
  ROBYN_ENV=robyn-devnet \
  DATA_API_URL=http://127.0.0.1:13101 \
  DATA_API_STATUS_URL=http://127.0.0.1:13101/status \
  RPC_GATEWAY_HEALTH_URL=http://127.0.0.1:18545 \
  bash -lc "cd '${source_dir}/apps/web' && exec node node_modules/next/dist/bin/next start --hostname 127.0.0.1" \
  >"${work}/web.log" 2>&1 &
app_pids+=("$!")

install -d -m 0700 "${work}/nginx"
cat >"${work}/nginx/recovery.conf" <<EOF
pid ${work}/nginx/nginx.pid;
error_log ${work}/nginx/error.log info;
events {
  worker_connections 128;
}
http {
  include /etc/nginx/mime.types;
  access_log ${work}/nginx/access.log;
  server {
    listen 127.0.0.1:13000;
    server_name _;
    client_max_body_size 2m;
    location /api/ {
      proxy_pass http://127.0.0.1:13101/;
      proxy_set_header Host \$host:\$server_port;
      proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location / {
      proxy_pass http://127.0.0.1:13002;
      proxy_set_header Host \$host:\$server_port;
      proxy_set_header X-Forwarded-Proto \$scheme;
    }
  }
}
EOF
nginx -c "${work}/nginx/recovery.conf" -p "${work}/nginx" \
  -g 'daemon off;' >"${work}/nginx/stdout.log" 2>&1 &
edge_pid=$!

for _ in {1..120}; do
  if curl -fsS http://127.0.0.1:13200/health >/dev/null 2>&1 &&
    curl -fsS http://127.0.0.1:13101/health >/dev/null 2>&1 &&
    curl -fsS http://127.0.0.1:13000/discover \
      >"${work}/restored-discover.html" 2>/dev/null; then
    break
  fi
  sleep 0.5
done
curl -fsS http://127.0.0.1:13200/health >"${work}/artifact-health.json"
curl -fsS http://127.0.0.1:13101/status >"${work}/api-status.json"
curl -fsS http://127.0.0.1:13101/launches?limit=5 \
  >"${work}/launches.json"
curl -fsS http://127.0.0.1:13000/discover \
  >"${work}/restored-discover.html"
grep -Eq 'Development network only|Controlled development network' \
  "${work}/restored-discover.html"
media_id="$(
  runuser -u postgres -- psql -d "${database}" -Atqc \
    "SELECT media_id FROM media_assets WHERE status='active' ORDER BY created_at,media_id LIMIT 1"
)"
test -n "${media_id}"
curl -fsS "http://127.0.0.1:13000/api/media/${media_id}" \
  >"${work}/restored-media.webp"
file "${work}/restored-media.webp" | grep -q 'Web/P image'
HOME=/home/hendo420 ROBYN_OPERATOR_RPC_URL=http://127.0.0.1:18545 \
  ROBYN_DEVNET_MANIFEST="${source_dir}/deployments/31337.json" \
  "${source_dir}/scripts/verify-devnet-deployment.sh" \
  "${source_dir}/deployments/31337.json" \
  >"${work}/contract-smoke.log"
sleep 6
jq -e '
  .service == "robyn-api" and
  .chainId == 31337 and
  .keeperStatus == "ok" and
  .artifactStatus == "ok"
' "${work}/api-status.json" >/dev/null
for app_pid in "${app_pids[@]}"; do
  kill -0 "${app_pid}"
done
kill -0 "${edge_pid}"

if [[ "${ROBYN_RESTORE_HOLD_SECONDS:-0}" =~ ^[0-9]+$ ]] &&
  [[ "${ROBYN_RESTORE_HOLD_SECONDS:-0}" -gt 0 ]]; then
  printf 'restoreBrowserUrl=http://127.0.0.1:13000/discover\n'
  sleep "${ROBYN_RESTORE_HOLD_SECONDS}"
fi

post_live_current="$(readlink -f /opt/robyn/current)"
post_live_deployment_sha="$(
  sha256sum /home/hendo420/Robyn/deployments/31337.json | cut -d' ' -f1
)"
post_live_chain_state_sha="$(
  curl -fsS -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"anvil_dumpState","params":[]}' \
    http://127.0.0.1:8545 | jq -er '.result' | sha256sum | cut -d' ' -f1
)"
post_live_database_sha="$(database_fingerprint robyn)"
if [[ "${post_live_current}" != "${live_current}" ||
  "${post_live_deployment_sha}" != "${live_deployment_sha}" ||
  "${post_live_chain_state_sha}" != "${live_chain_state_sha}" ||
  "${post_live_database_sha}" != "${live_database_sha}" ]]; then
  echo "Live deployment changed during isolated recovery." >&2
  exit 1
fi

table_count="$(wc -l <"${restore}/database/table-counts.tsv" | tr -d ' ')"
printf 'restore=passed\ndatabaseTables=%s\nartifacts=%s\nchainId=%s\nfactory=%s\ngitSha=%s\napiSmoke=passed\nkeeperSmoke=passed\nbrowserHttpSmoke=passed\nliveStateTouched=false\n' "${table_count}" "${artifact_count}" "${chain_id}" "${factory}" "${git_sha}"

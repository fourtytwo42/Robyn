#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo "run as root" >&2; exit 1; }
release_id="${1:?usage: promote-testnet-release.sh RELEASE_ID}"
root=/opt/robyn
target="$root/testnet-releases/$release_id"
current="$root/testnet-current"
previous="$root/testnet-previous"
history=/var/lib/robyn/testnet-release-history
operator=hendo420
pm2_home=/home/hendo420/.pm2
release_env=/home/hendo420/.config/robyn/testnet/release.env
requested_database="${ROBYN_TESTNET_DATABASE:-}"
create_database="${ROBYN_TESTNET_CREATE_DATABASE:-false}"
campaign_token_file="${ROBYN_CAMPAIGN_OPERATOR_TOKEN_FILE:-/home/hendo420/.config/robyn/testnet/campaign-operator-token}"
operator_key=/home/hendo420/.config/robyn/testnet/operator.key
[[ -d "$target" && -r "$release_env" && -r "$campaign_token_file" ]]
(cd "$target" && sha256sum -c testnet-release-manifest.json.sha256 >/dev/null && sha256sum -c testnet-release-files.sha256 >/dev/null)
for required_runtime_file in \
  apps/web/.next/BUILD_ID \
  apps/web/.next/prerender-manifest.json \
  apps/web/.next/required-server-files.json \
  apps/web/.next/routes-manifest.json; do
  [[ -s "$target/$required_runtime_file" ]] || {
    echo "refusing incomplete testnet release: $required_runtime_file" >&2
    exit 1
  }
done
install -d -o root -g root -m 0755 /var/www/sherwoodforest-coming-soon
install -o root -g root -m 0644 \
  "$target/infrastructure/coming-soon/index.html" \
  /var/www/sherwoodforest-coming-soon/index.html

old=""
old_database=""
old_manifest=""
[[ -L "$current" ]] && old="$(readlink -f "$current")"
link_atomically() { local next="$2.next.$$"; ln -s "$1" "$next"; mv -Tf "$next" "$2"; }
as_operator() { runuser -u "$operator" -- env PM2_HOME="$pm2_home" "$@"; }
if [[ -n "$old" ]]; then
  old_database="$(
    as_operator "$old/node_modules/.bin/pm2" jlist |
      jq -r '.[] | select(.name=="robyn-indexer-testnet") | (.pm2_env.PGDATABASE // .pm2_env.env.PGDATABASE // empty)' |
      head -n 1
  )"
  old_manifest="$(
    as_operator "$old/node_modules/.bin/pm2" jlist |
      jq -r '.[] | select(.name=="robyn-indexer-testnet") | (.pm2_env.env.ROBYN_TESTNET_MANIFEST // empty)' |
      head -n 1
  )"
fi
database="$requested_database"
if [[ -z "$database" ]]; then
  [[ -n "$old_database" ]] || {
    echo "set ROBYN_TESTNET_DATABASE when no active testnet database can be inherited" >&2
    exit 1
  }
  database="$old_database"
fi
[[ "$database" =~ ^[A-Za-z0-9_]+$ ]] || {
  echo "invalid testnet database name: $database" >&2
  exit 1
}
[[ "$create_database" == true || "$create_database" == false ]] || {
  echo "ROBYN_TESTNET_CREATE_DATABASE must be true or false" >&2
  exit 1
}
database_exists() {
  runuser -u postgres -- psql -Atqc \
    "SELECT 1 FROM pg_database WHERE datname='$database'" postgres |
    grep -qx 1
}
prepare_database() {
  if [[ "$create_database" == true ]]; then
    if database_exists; then
      echo "refusing to reuse database requested as fresh: $database" >&2
      exit 1
    fi
    runuser -u postgres -- createdb --owner="$operator" "$database"
    if ! as_operator env \
      PGHOST=/var/run/postgresql \
      PGDATABASE="$database" \
      PGUSER="$operator" \
      /opt/node-v24.18.0-linux-x64/bin/node \
      "$target/packages/db/dist/migrate.js"; then
      echo "fresh database migration failed; preserving $database for diagnosis" >&2
      exit 1
    fi
    migration_count="$(
      as_operator psql -h /var/run/postgresql -d "$database" -Atqc \
        "SELECT count(*) FROM schema_migrations"
    )"
    expected_migrations="$(find "$target/packages/db/migrations" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*.sql' | wc -l)"
    [[ "$migration_count" == "$expected_migrations" ]] || {
      echo "expected $expected_migrations migrations in $database, found $migration_count" >&2
      exit 1
    }
  elif ! database_exists; then
    echo "selected testnet database does not exist: $database" >&2
    exit 1
  fi
}
start_stack() {
  local selected="$1"
  local selected_database="$2"
  local selected_manifest="$3"
  local pm2="$selected/node_modules/.bin/pm2"
  for name in robyn-web-testnet robyn-rpc-gateway-testnet robyn-api-testnet robyn-indexer-testnet robyn-projector-testnet robyn-keeper-testnet robyn-artifacts-testnet; do
    as_operator "$pm2" delete "$name" >/dev/null 2>&1 || true
  done
  set -a
  # shellcheck disable=SC1090
  source "$release_env"
  set +a
  install -d -o "$operator" -g "$operator" -m 0750 \
    /var/lib/robyn/testnet-rpc-gateway
  as_operator env \
    ROBYN_TESTNET_PRIMARY_RPC_URL="${ROBYN_TESTNET_PRIMARY_RPC_URL:-http://192.168.50.117:8547}" \
    ROBYN_TESTNET_SERVER_RPC_URL="${ROBYN_TESTNET_SERVER_RPC_URL:-https://rpc.testnet.chain.robinhood.com}" \
    ROBYN_TESTNET_WS_RPC_URL="" \
    ROBYN_TESTNET_RPC_ACTIVE_PROVIDER="primary" \
    ROBYN_TESTNET_RPC_FALLBACK_TRAFFIC_AUTHORIZED="false" \
    ROBYN_TESTNET_RELEASE_ROOT="$selected" \
    ROBYN_TESTNET_MANIFEST="$selected_manifest" \
    ROBYN_TESTNET_DATABASE="$selected_database" \
    ROBYN_OPERATOR_KEY_FILE="$operator_key" \
    ROBYN_TESTNET_AUTH_ORIGINS="https://testnet.sherwoodforest.trade" \
    ROBYN_TESTNET_REQUIRE_REMOTE_PIN=false \
    ROBYN_CAMPAIGN_OPERATOR_TOKEN_FILE="$campaign_token_file" \
    "$pm2" start "$selected/infrastructure/pm2/ecosystem.testnet.config.cjs"
}
rollback() {
  if [[ -n "$old" ]]; then
    link_atomically "$old" "$current"
    [[ -n "$old_manifest" && -r "$old_manifest" ]] || {
      echo "cannot safely restore previous release without its recorded manifest: $old_manifest" >&2
      return 1
    }
    start_stack \
      "$old" \
      "${old_database:-robyn_testnet_schema8_abe90dc}" \
      "$old_manifest"
  fi
  as_operator "$target/node_modules/.bin/pm2" save --force
}

prepare_database
link_atomically "$target" "$current"
target_manifest="$target/$(jq -r '.deploymentManifestPath' "$target/testnet-release-manifest.json")"
[[ -r "$target_manifest" ]]
if ! start_stack "$target" "$database" "$target_manifest"; then rollback; exit 1; fi
healthy=false
for _ in $(seq 1 60); do
  if as_operator "$target/scripts/verify-testnet-release.sh" "$current" >/tmp/robyn-testnet-release-verify.json 2>/dev/null; then healthy=true; break; fi
  sleep 5
done
if [[ "$healthy" != true ]]; then
  echo "testnet promotion failed; restoring previous release" >&2
  rollback
  exit 1
fi
if [[ -n "$old" && "$old" != "$target" ]]; then link_atomically "$old" "$previous"; fi
as_operator "$target/node_modules/.bin/pm2" save --force
mkdir -p "$history"
history_file="$history/$(date -u +%Y%m%dT%H%M%SZ)-promote-$release_id.json"
jq --arg action promote --arg previous "$old" '.+{action:$action,previousRelease:$previous}' /tmp/robyn-testnet-release-verify.json >"$history_file"
rm -f /tmp/robyn-testnet-release-verify.json
cat "$history_file"

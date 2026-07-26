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
database="${ROBYN_TESTNET_DATABASE:-robyn_testnet_schema9_3b0f907}"
campaign_token_file="${ROBYN_CAMPAIGN_OPERATOR_TOKEN_FILE:-/home/hendo420/.local/state/robyn-testnet-deployments/schema8-abe90dc-final/campaign-operator-token}"
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
[[ -L "$current" ]] && old="$(readlink -f "$current")"
link_atomically() { local next="$2.next.$$"; ln -s "$1" "$next"; mv -Tf "$next" "$2"; }
as_operator() { runuser -u "$operator" -- env PM2_HOME="$pm2_home" "$@"; }
if [[ -n "$old" ]]; then
  old_database="$(
    as_operator "$old/node_modules/.bin/pm2" jlist |
      jq -r '.[] | select(.name=="robyn-indexer-testnet") | .pm2_env.env.PGDATABASE' |
      head -n 1
  )"
fi
start_stack() {
  local selected="$1"
  local selected_database="$2"
  local pm2="$selected/node_modules/.bin/pm2"
  for name in robyn-web-testnet robyn-api-testnet robyn-indexer-testnet robyn-projector-testnet robyn-keeper-testnet robyn-artifacts-testnet; do
    as_operator "$pm2" delete "$name" >/dev/null 2>&1 || true
  done
  set -a
  # shellcheck disable=SC1090
  source "$release_env"
  set +a
  as_operator env \
    ROBYN_TESTNET_SERVER_RPC_URL="${ROBYN_TESTNET_SERVER_RPC_URL:-https://rpc.testnet.chain.robinhood.com}" \
    ROBYN_TESTNET_RELEASE_ROOT="$selected" \
    ROBYN_TESTNET_MANIFEST="$selected/deployments/46630-v4.json" \
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
    start_stack "$old" "${old_database:-robyn_testnet_schema8_abe90dc}"
  fi
  as_operator "$target/node_modules/.bin/pm2" save --force
}

link_atomically "$target" "$current"
if ! start_stack "$target" "$database"; then rollback; exit 1; fi
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

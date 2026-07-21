#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"
work="$(mktemp -d)"
database="robyn_testnet_rehearsal"
rpc_url="http://127.0.0.1:18545"
pm2="$repo_root/node_modules/.bin/pm2"
app_selector="robyn-web-testnet,robyn-api-testnet,robyn-indexer-testnet,robyn-keeper-testnet,robyn-artifacts-testnet"
app_names=(robyn-web-testnet robyn-api-testnet robyn-indexer-testnet robyn-keeper-testnet robyn-artifacts-testnet)
anvil --host 127.0.0.1 --port 18545 --chain-id 46630 --config-out "$work/anvil.json" --silent >"$work/anvil.log" 2>&1 &
anvil_pid=$!
cleanup() {
  "$pm2" delete "${app_names[@]}" >/dev/null 2>&1 || true
  if [[ "$database" == "robyn_testnet_rehearsal" ]]; then
    psql -d "$database" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public" >/dev/null 2>&1 || true
  fi
  kill "$anvil_pid" 2>/dev/null || true
  wait "$anvil_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
for _ in $(seq 1 100); do
  if cast chain-id --rpc-url "$rpc_url" >/dev/null 2>&1 && [[ -s "$work/anvil.json" ]]; then break; fi
  sleep 0.1
done
[[ "$(cast chain-id --rpc-url "$rpc_url")" == "46630" ]]

manifest="$work/46630.json"
ROBYN_TESTNET_RPC_URL="$rpc_url" ROBYN_TESTNET_MANIFEST="$manifest" ROBYN_TESTNET_REHEARSAL=true ROBYN_ALLOW_UNLOCKED_REHEARSAL=true ROBYN_TESTNET_BROADCAST=true scripts/deploy-testnet.sh >/dev/null
jq -er '.private_keys[0]' "$work/anvil.json" > "$work/operator.key"
chmod 600 "$work/operator.key"

pnpm --filter @robyn/db build >/dev/null
pnpm --filter @robyn/api build >/dev/null
pnpm --filter @robyn/indexer build >/dev/null
pnpm --filter @robyn/keeper build >/dev/null
pnpm --filter @robyn/artifacts build >/dev/null
ROBYN_TESTNET_RPC_URL="$rpc_url" ROBYN_TESTNET_BUILD_OUTPUT="$work/web-build" scripts/build-testnet-candidate.sh "$manifest" >/dev/null
rm -rf apps/web/.next
cp -a "$work/web-build/.next" apps/web/.next
[[ "$database" == "robyn_testnet_rehearsal" ]] || { echo "Unsafe rehearsal database name" >&2; exit 1; }
psql -d "$database" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public" >/dev/null
PGHOST=/var/run/postgresql PGDATABASE="$database" PGUSER=hendo420 pnpm --filter @robyn/db migrate >/dev/null

ROBYN_TESTNET_RELEASE_ROOT="$repo_root" \
ROBYN_TESTNET_MANIFEST="$manifest" \
ROBYN_TESTNET_RPC_URL="$rpc_url" \
ROBYN_OPERATOR_KEY_FILE="$work/operator.key" \
ROBYN_TESTNET_DATABASE="$database" \
  "$pm2" start infrastructure/pm2/ecosystem.testnet.config.cjs --only "$app_selector" --update-env >/dev/null

healthy=false
for _ in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:3012/api/health >/dev/null 2>&1 && \
     curl -fsS http://127.0.0.1:3111/health >/dev/null 2>&1 && \
     curl -fsS http://127.0.0.1:3210/health >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 0.25
done
[[ "$healthy" == "true" ]] || { "$pm2" logs --nostream --lines 80; exit 1; }
status="$(curl -fsS http://127.0.0.1:3111/status)"
jq -e '.chainId == 46630 and (.launchCount | tonumber) >= 1 and .keeperStatus == "ok" and .artifactStatus == "ok"' <<<"$status" >/dev/null

accounts="$(cast rpc eth_accounts --rpc-url "$rpc_url")"
user="$(jq -er '.[1]' <<<"$accounts")"
base="$(jq -er '.contracts.baseAsset' "$manifest")"
market="$(jq -er '.contracts.genesisMarket' "$manifest")"
vault="$(jq -er '.contracts.genesisVault' "$manifest")"
token="$(jq -er '.contracts.genesisToken' "$manifest")"
send_user() {
  cast send --rpc-url "$rpc_url" --from "$user" --unlocked --json "$@" | jq -e '.status == "0x1" or .status == 1' >/dev/null
}
send_user "$base" 'claimFaucet(address)' "$user"
send_user "$base" 'approve(address,uint256)' "$market" 1000000000000000000000
send_user "$market" 'buy(uint256,uint256)' 1000000000000000000000 990000000000000000000000

converted=false
for _ in $(seq 1 120); do
  pending="$(cast call "$vault" 'totalPendingBase()(uint256)' --rpc-url "$rpc_url" --json | jq -er '.[0]')"
  completed="$(psql -At -d "$database" -c "select count(*) from job_audit where queue='robyn-conversions-testnet' and state='completed'")"
  if [[ "$pending" == "0" && "$completed" == "3" ]]; then converted=true; break; fi
  sleep 0.25
done
[[ "$converted" == "true" ]]
for i in 0 1 2; do
  received="$(cast call "$token" 'totalRewardsReceived(uint256)(uint256)' "$i" --rpc-url "$rpc_url" --json | jq -er '.[0]')"
  [[ "$received" != "0" ]]
done

processes="$(PM2_HOME=/home/hendo420/.pm2 "$pm2" jlist)"
for name in "${app_names[@]}"; do
  jq -e --arg name "$name" '.[] | select(.name == $name and .pm2_env.status == "online")' <<<"$processes" >/dev/null
done
curl -fsS http://127.0.0.1:3000/api/health >/dev/null
"$pm2" delete "${app_names[@]}" >/dev/null
processes_after_cleanup="$(PM2_HOME=/home/hendo420/.pm2 "$pm2" jlist)"
for name in "${app_names[@]}"; do
  if jq -e --arg name "$name" '.[] | select(.name == $name)' <<<"$processes_after_cleanup" >/dev/null; then
    echo "Testnet process survived cleanup: $name" >&2
    exit 1
  fi
done

summary="$(jq -n \
  --arg testedAt "$(date -u +%FT%TZ)" \
  --arg gitSha "$(git rev-parse HEAD)" \
  --argjson chainId 46630 \
  --argjson indexedBlock "$(jq -r '.asOfBlock' <<<"$status")" \
  --arg database "$database" \
  '{schemaVersion: 1, testedAt: $testedAt, gitSha: $gitSha, chainId: $chainId, passed: true, isolatedDatabase: $database, services: {web: true, api: true, indexer: true, keeper: true, artifacts: true}, keeper: {signedWithRestrictedKeyFile: true, convertedLegs: 3}, rollback: {testnetProcessesRemoved: true, devnetHealthPreserved: true}, indexedBlock: $indexedBlock}')"
if [[ -n "${ROBYN_TESTNET_STACK_EVIDENCE:-}" ]]; then
  mkdir -p "$(dirname "$ROBYN_TESTNET_STACK_EVIDENCE")"
  printf '%s\n' "$summary" > "$ROBYN_TESTNET_STACK_EVIDENCE"
fi
printf '%s\n' "$summary"
#!/usr/bin/env bash
set -euo pipefail
release_path="${1:-/opt/robyn/testnet-current}"
release_real="$(readlink -f "$release_path")"
[[ "$release_real" == /opt/robyn/testnet-releases/* ]]
cd "$release_real"
sha256sum -c testnet-release-manifest.json.sha256 >/dev/null
sha256sum -c testnet-release-files.sha256 >/dev/null
git_sha="$(jq -r .gitSha testnet-release-manifest.json)"
manifest="$release_real/deployments/46630-v4-schema17.json"
jq -e '.schemaVersion == 17 and .chainId == 46630 and .launchControl.initialMode == "Paused"' "$manifest" >/dev/null

pm2_json="$(PM2_HOME=/home/hendo420/.pm2 "$release_real/node_modules/.bin/pm2" jlist)"
testnet="$(jq '[.[]|select(.name|endswith("-testnet"))]' <<<"$pm2_json")"
[[ "$(jq length <<<"$testnet")" -eq 7 ]]
[[ "$(jq '[.[]|select(.pm2_env.status=="online")]|length' <<<"$testnet")" -eq 7 ]]
[[ "$(jq --arg root "$release_real" '[.[]|select((.name=="robyn-web-testnet" and .pm2_env.pm_cwd!=($root+"/apps/web")) or (.name!="robyn-web-testnet" and .pm2_env.pm_cwd!=$root))]|length' <<<"$testnet")" -eq 0 ]]
[[ "$(jq -r '.[]|select(.name=="robyn-indexer-testnet")|.pm2_env.env.ROBYN_INDEXER_ROLE' <<<"$testnet")" == "ingester" ]]
[[ "$(jq -r '.[]|select(.name=="robyn-projector-testnet")|.pm2_env.env.ROBYN_INDEXER_ROLE' <<<"$testnet")" == "projector" ]]
indexer_ws_url="$(jq -r '.[]|select(.name=="robyn-indexer-testnet")|.pm2_env.env.ROBYN_OPERATOR_WS_RPC_URL // ""' <<<"$testnet")"
[[ -z "$indexer_ws_url" ]]
[[ "$(jq -r '.[]|select(.name=="robyn-indexer-testnet")|.pm2_env.env.INDEXER_RECONCILIATION_MS' <<<"$testnet")" == "900000" ]]
[[ "$(jq -r '.[]|select(.name=="robyn-indexer-testnet")|.pm2_env.env.INDEXER_HEARTBEAT_MS' <<<"$testnet")" == "5000" ]]
[[ "$(jq -r '.[]|select(.name=="robyn-indexer-testnet")|.pm2_env.env.INDEXER_MAXIMUM_OBSERVED_LAG_BLOCKS' <<<"$testnet")" == "25" ]]
[[ "$(jq -r '.[]|select(.name=="robyn-indexer-testnet")|.pm2_env.env.INDEXER_WS_DEBOUNCE_MS' <<<"$testnet")" == "500" ]]

server_rpc_url="$(jq -r '.[]|select(.name=="robyn-indexer-testnet")|.pm2_env.env.ROBYN_OPERATOR_RPC_URL' <<<"$testnet")"
[[ "$server_rpc_url" == "http://127.0.0.1:18548" ]]
for process_name in robyn-api-testnet robyn-indexer-testnet robyn-projector-testnet robyn-keeper-testnet; do
  [[ "$(jq -r --arg name "$process_name" '.[]|select(.name==$name)|.pm2_env.env.ROBYN_OPERATOR_RPC_URL' <<<"$testnet")" == "$server_rpc_url" ]]
done
primary_rpc_url="$(jq -r '.[]|select(.name=="robyn-rpc-gateway-testnet")|.pm2_env.env.PRIMARY_RPC_URL' <<<"$testnet")"
fallback_rpc_url="$(jq -r '.[]|select(.name=="robyn-rpc-gateway-testnet")|.pm2_env.env.FALLBACK_RPC_URL' <<<"$testnet")"
[[ "$primary_rpc_url" == "http://192.168.50.117:8547" ]]
[[ "$fallback_rpc_url" == https://robinhood-testnet.g.alchemy.com/v2/* ]]
[[ "$(jq -r '.[]|select(.name=="robyn-rpc-gateway-testnet")|.pm2_env.env.EXPECTED_CHAIN_ID' <<<"$testnet")" == "46630" ]]
[[ "$(jq -r '.[]|select(.name=="robyn-rpc-gateway-testnet")|.pm2_env.env.RPC_PROBE_INTERVAL_MS' <<<"$testnet")" == "30000" ]]
gateway_health="$(curl -fsS http://127.0.0.1:18548/health)"
[[ "$(jq -r .expectedChainId <<<"$gateway_health")" -eq 46630 ]]
[[ "$(jq -r .activeProvider <<<"$gateway_health")" == "primary" ]]
[[ "$(jq -r .fallbackTrafficAuthorized <<<"$gateway_health")" == "false" ]]
[[ "$(jq -r .primary.healthy <<<"$gateway_health")" == "true" ]]
[[ "$(jq -r .fallback.healthy <<<"$gateway_health")" == "true" ]]
[[ "$(jq -r .headLagBlocks <<<"$gateway_health")" -le 50 ]]
[[ "$(jq -r .paidProjectedDailyCu <<<"$gateway_health")" -le 250000 ]]

database="$(
  jq -r \
    '.[]|select(.name=="robyn-indexer-testnet")|.pm2_env.env.PGDATABASE' \
    <<<"$testnet"
)"
active_database_indexers=()
for process_environment in /proc/[0-9]*/environ; do
  process_id="${process_environment#/proc/}"
  process_id="${process_id%/environ}"
  command_line="/proc/$process_id/cmdline"
  [[ -r "$process_environment" && -r "$command_line" ]] || continue
  grep -azq 'apps/indexer/dist/server.js' "$command_line" || continue
  grep -azqx "PGDATABASE=$database" "$process_environment" || continue
  role="$(
    tr '\0' '\n' <"$process_environment" |
      sed -n 's/^ROBYN_INDEXER_ROLE=//p'
  )"
  active_database_indexers+=("$process_id:${role:-combined}")
done
[[ "${#active_database_indexers[@]}" -eq 2 ]]
[[ "$(printf '%s\n' "${active_database_indexers[@]}" | grep -c ':ingester$')" -eq 1 ]]
[[ "$(printf '%s\n' "${active_database_indexers[@]}" | grep -c ':projector$')" -eq 1 ]]

curl -fsS http://127.0.0.1:3012/api/health >/dev/null
status="$(curl -fsS http://127.0.0.1:3111/status)"
curl -fsS http://127.0.0.1:3210/health >/dev/null
public_status="$(curl -fsS https://testnet.sherwoodforest.trade/api/status)"
[[ "$(jq -r .chainId <<<"$status")" -eq 46630 ]]
[[ "$(jq -r .launchCount <<<"$status")" -ge 0 ]]
[[ "$(jq -r .launchCount <<<"$public_status")" -ge 0 ]]
[[ "$(jq -r .launchCount <<<"$status")" == \
   "$(jq -r .launchCount <<<"$public_status")" ]]
[[ "$(jq -r .chainId <<<"$public_status")" -eq 46630 ]]
for observed in "$status" "$public_status"; do
  observed_head="$(jq -r .observedHeadBlock <<<"$observed")"
  canonical_checkpoint="$(jq -r .asOfBlock <<<"$observed")"
  indexed_at="$(jq -r .indexedAt <<<"$observed")"
  [[ "$observed_head" =~ ^[0-9]+$ ]]
  [[ "$canonical_checkpoint" =~ ^[0-9]+$ ]]
  [[ "$observed_head" -ge "$canonical_checkpoint" ]]
  indexed_at_epoch="$(date -u -d "$indexed_at" +%s)"
  [[ $(( $(date -u +%s) - indexed_at_epoch )) -le 120 ]]
  [[ "$(jq -r .ingestionStatus <<<"$observed")" == "ok" ]]
  [[ "$(jq -r .projectionStatus <<<"$observed")" == "ok" ]]
  [[ "$(jq -r .projectionAsOfBlock <<<"$observed")" =~ ^[0-9]+$ ]]
  [[ "$(jq -r .projectionLagBlocks <<<"$observed")" -le 100 ]]
  jq -e '.ingestionCycleMs >= 0 and .projectionCycleMs >= 0 and .rpcRetryCount >= 0' \
    <<<"$observed" >/dev/null
done
local_observed_head="$(jq -r .observedHeadBlock <<<"$status")"
public_observed_head="$(jq -r .observedHeadBlock <<<"$public_status")"
observed_head_gap=$(( local_observed_head - public_observed_head ))
[[ "$observed_head_gap" -lt 0 ]] && observed_head_gap=$(( -observed_head_gap ))
[[ "$observed_head_gap" -le 100 ]]
ROBYN_TESTNET_RPC_URL="$server_rpc_url" \
  ROBYN_VERIFY_ALLOW_LIFECYCLE_PROGRESS=true \
  node scripts/verify-schema17-deployment.mjs "$manifest" \
  > /tmp/robyn-testnet-deployment-verify.json
jq -e '.passed == true' /tmp/robyn-testnet-deployment-verify.json >/dev/null

jq -n \
  --arg verifiedAt "$(date -u +%FT%TZ)" \
  --arg releasePath "$release_real" \
  --arg gitSha "$git_sha" \
  --arg serverRpcProvider "lan-only-alchemy-probe" \
  --arg database "$database" \
  --argjson activeDatabaseIndexers "$(
    printf '%s\n' "${active_database_indexers[@]}" |
      jq -Rsc 'split("\n")|map(select(length>0))'
  )" \
  --argjson gatewayHealth "$gateway_health" \
  --argjson status "$status" \
  --argjson publicStatus "$public_status" \
  --argjson verifierChecks "$(jq '.contractsVerified' /tmp/robyn-testnet-deployment-verify.json)" \
  '{verifiedAt:$verifiedAt,releasePath:$releasePath,gitSha:$gitSha,serverRpcProvider:$serverRpcProvider,database:$database,activeDatabaseIndexers:$activeDatabaseIndexers,gatewayHealth:$gatewayHealth,status:$status,publicStatus:$publicStatus,verifierChecks:$verifierChecks}'
rm -f /tmp/robyn-testnet-deployment-verify.json

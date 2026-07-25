#!/usr/bin/env bash
set -euo pipefail
release_path="${1:-/opt/robyn/testnet-current}"
release_real="$(readlink -f "$release_path")"
[[ "$release_real" == /opt/robyn/testnet-releases/* ]]
cd "$release_real"
sha256sum -c testnet-release-manifest.json.sha256 >/dev/null
sha256sum -c testnet-release-files.sha256 >/dev/null
git_sha="$(jq -r .gitSha testnet-release-manifest.json)"
manifest="$release_real/deployments/46630-v4.json"
jq -e '.schemaVersion == 8 and .chainId == 46630' "$manifest" >/dev/null

pm2_json="$(PM2_HOME=/home/hendo420/.pm2 "$release_real/node_modules/.bin/pm2" jlist)"
testnet="$(jq '[.[]|select(.name|endswith("-testnet"))]' <<<"$pm2_json")"
[[ "$(jq length <<<"$testnet")" -eq 5 ]]
[[ "$(jq '[.[]|select(.pm2_env.status=="online")]|length' <<<"$testnet")" -eq 5 ]]
[[ "$(jq --arg root "$release_real" '[.[]|select((.name=="robyn-web-testnet" and .pm2_env.pm_cwd!=($root+"/apps/web")) or (.name!="robyn-web-testnet" and .pm2_env.pm_cwd!=$root))]|length' <<<"$testnet")" -eq 0 ]]

curl -fsS http://127.0.0.1:3012/api/health >/dev/null
status="$(curl -fsS http://127.0.0.1:3111/status)"
curl -fsS http://127.0.0.1:3210/health >/dev/null
public_status="$(curl -fsS https://sherwoodforest.trade/api/status)"
[[ "$(jq -r .chainId <<<"$status")" -eq 46630 ]]
[[ "$(jq -r .launchCount <<<"$status")" -ge 9 ]]
[[ "$(jq -r .launchCount <<<"$public_status")" -ge 9 ]]
[[ "$(jq -r .chainId <<<"$public_status")" -eq 46630 ]]
ROBYN_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com \
  node scripts/verify-testnet-v4-deployment.mjs "$manifest" \
  > /tmp/robyn-testnet-deployment-verify.json
jq -e '.failures|length==0' /tmp/robyn-testnet-deployment-verify.json >/dev/null

jq -n \
  --arg verifiedAt "$(date -u +%FT%TZ)" \
  --arg releasePath "$release_real" \
  --arg gitSha "$git_sha" \
  --argjson status "$status" \
  --argjson publicStatus "$public_status" \
  --argjson verifierChecks "$(jq '.checks|length' /tmp/robyn-testnet-deployment-verify.json)" \
  '{verifiedAt:$verifiedAt,releasePath:$releasePath,gitSha:$gitSha,status:$status,publicStatus:$publicStatus,verifierChecks:$verifierChecks}'
rm -f /tmp/robyn-testnet-deployment-verify.json

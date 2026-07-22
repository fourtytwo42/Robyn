#!/usr/bin/env bash
set -euo pipefail

base_url="${ROBYN_WEB_URL:-http://192.168.50.250:3000}/api"
rpc_url="${ROBYN_OPERATOR_RPC_URL:-http://127.0.0.1:8545}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="${ROBYN_MEDIA_FIXTURE:-${repo_root}/apps/web/public/assets/launchpad/token-robyn.webp}"
export PATH="$HOME/.foundry/bin:$PATH"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

address="$(cast rpc eth_accounts --rpc-url "$rpc_url" | jq -r '.[0]' | tr '[:upper:]' '[:lower:]')"
curl -fsS -H 'content-type: application/json' --data "$(jq -cn --arg address "$address" '{address:$address}')" "$base_url/auth/nonce" >"$work/nonce.json"
message="$(jq -er '.data.message' "$work/nonce.json")"
signature="$(cast rpc eth_sign "$address" "$(cast from-utf8 "$message")" --rpc-url "$rpc_url" | jq -er '.')"
curl -fsS -c "$work/cookies" -H 'content-type: application/json' --data "$(jq -cn --arg message "$message" --arg signature "$signature" '{message:$message,signature:$signature}')" "$base_url/auth/verify" >/dev/null

media_id="$(curl -fsS -b "$work/cookies" -H 'content-type: image/webp' --data-binary "@$fixture" "$base_url/media?purpose=token" | jq -er '.data.media_id')"
launches="$(curl -fsS "$base_url/launches?limit=50")"
owned_bound="$(jq -er --arg address "$address" '.data[] | select(.creator==$address and .metadata.media_id!=null) | .token' <<<"$launches" | head -1)"
other_creator="$(jq -er --arg address "$address" '.data[] | select(.creator!=$address) | .token' <<<"$launches" | head -1)"
body="$(jq -cn --arg mediaId "$media_id" '{mediaId:$mediaId}')"

immutable_status="$(curl -sS -o "$work/immutable.json" -w '%{http_code}' -b "$work/cookies" -H 'content-type: application/json' --data "$body" "$base_url/launches/$owned_bound/metadata")"
test "$immutable_status" = "409"
test "$(jq -r '.error' "$work/immutable.json")" = "launch_metadata_immutable"

unauthorized_status="$(curl -sS -o "$work/unauthorized.json" -w '%{http_code}' -b "$work/cookies" -H 'content-type: application/json' --data "$body" "$base_url/launches/$other_creator/metadata")"
test "$unauthorized_status" = "403"
test "$(jq -r '.error' "$work/unauthorized.json")" = "canonical_creator_required"

echo "Creator metadata immutable-binding and canonical-owner rejection passed"

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base_url="${ROBYN_WEB_URL:-http://192.168.50.250:3000}/api"
rpc_url="${ROBYN_OPERATOR_RPC_URL:-http://127.0.0.1:8545}"
manifest="${ROBYN_DEVNET_MANIFEST:-$repo_root/deployments/31337.json}"
export PATH="$HOME/.foundry/bin:$PATH"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

test "$(cast chain-id --rpc-url "$rpc_url")" = "31337"
address="$(cast rpc eth_accounts --rpc-url "$rpc_url" | jq -r '.[0]' | tr '[:upper:]' '[:lower:]')"
curl -fsS -H 'content-type: application/json' \
  --data "$(jq -cn --arg address "$address" '{address:$address}')" \
  "$base_url/auth/nonce" >"$work/nonce.json"
message="$(jq -er '.data.message' "$work/nonce.json")"
signature="$(cast rpc eth_sign "$address" "$(cast from-utf8 "$message")" --rpc-url "$rpc_url" | jq -er '.')"
curl -fsS -c "$work/cookies" -H 'content-type: application/json' \
  --data "$(jq -cn --arg message "$message" --arg signature "$signature" '{message:$message,signature:$signature}')" \
  "$base_url/auth/verify" >/dev/null

upload() {
  local purpose="$1" path="$2"
  curl -fsS -b "$work/cookies" -H 'content-type: image/webp' --data-binary "@$path" \
    "$base_url/media?purpose=$purpose" | jq -er '.data.media_id'
}

avatar_id="$(upload avatar "$repo_root/apps/web/public/assets/brand/robyn-logo.webp")"
profile="$(jq -cn --arg avatar "$avatar_id" '{displayName:"Robyn Devnet Demo",bio:"Controlled devnet demo creator profile. Wallet control is proven; external identity is not verified.",avatarMediaId:$avatar}')"
curl -fsS -b "$work/cookies" -H 'content-type: application/json' -X PUT --data "$profile" "$base_url/profile" >"$work/profile.json"
test "$(jq -r '.data.display_name' "$work/profile.json")" = "Robyn Devnet Demo"

declare -A art=(
  [ROBYN]="token-robyn.webp"
  [SOAK]="token-soak.webp"
  [ONE]="token-orbit.webp"
  [EVID]="token-signal.webp"
  [MYCO]="token-lucky.webp"
)

first_media=""
while IFS=$'\t' read -r token symbol name; do
  if curl -fsS "$base_url/launches/$token/metadata" >/dev/null 2>&1; then
    continue
  fi
  media_id="$(upload token "$repo_root/apps/web/public/assets/launchpad/${art[$symbol]}")"
  [[ -n "$first_media" ]] || first_media="$media_id"
  prepare_body="$(jq -cn --arg mediaId "$media_id" --arg name "$name" --arg symbol "$symbol" --arg description "$([[ "$symbol" == "ROBYN" ]] && printf '%s' 'The original Robyn reward-basket community token.' || printf '%s' 'A curated Robyn controlled-devnet reward-basket token.')" '{mediaId:$mediaId,name:$name,symbol:$symbol,description:$description}')"
  preparation_id="$(curl -fsS -b "$work/cookies" -H 'content-type: application/json' --data "$prepare_body" \
    "$base_url/launch-metadata/prepare" | jq -er '.data.preparation_id')"
  bind_body="$(jq -cn --arg mediaId "$media_id" --arg preparationId "$preparation_id" '{mediaId:$mediaId,preparationId:$preparationId}')"
  curl -fsS -b "$work/cookies" -H 'content-type: application/json' --data "$bind_body" \
    "$base_url/launches/$token/metadata" >"$work/binding.json"
  test "$(jq -r '.data.media_id' "$work/binding.json")" = "$media_id"
done < <(jq -r '.demoLaunches[] | [.token,.symbol,.name] | @tsv' "$manifest")

test "$(curl -fsS "$base_url/profiles/$address" | jq -r '.data.avatar_media_id')" = "$avatar_id"
if [[ -n "$first_media" ]]; then
  test "$(curl -fsS -o "$work/media.webp" -w '%{http_code}' "$base_url/media/$first_media")" = "200"
  file "$work/media.webp" | grep -q 'Web/P image'
  report='{"reason":"Integration test report; recording must not hide the image."}'
  test "$(curl -fsS -H 'content-type: application/json' --data "$report" "$base_url/media/$first_media/reports" | jq -r '.status')" = "recorded_not_hidden"
fi

echo "Seeded the devnet demo creator profile and immutable curated launch artwork"

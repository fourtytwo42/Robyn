#!/usr/bin/env bash
set -euo pipefail

base_url="${ROBYN_WEB_URL:-http://192.168.50.250:3000}/api"
rpc_url="${ROBYN_OPERATOR_RPC_URL:-http://127.0.0.1:8545}"
export PATH="$HOME/.foundry/bin:$PATH"
address="$(cast rpc eth_accounts --rpc-url "$rpc_url" | jq -r '.[0]' | tr '[:upper:]' '[:lower:]')"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

curl -fsS -H 'content-type: application/json' \
  --data "$(jq -cn --arg address "$address" '{address:$address}')" \
  "$base_url/auth/nonce" >"$work/nonce.json"
message="$(jq -er '.data.message' "$work/nonce.json")"
message_hex="$(cast from-utf8 "$message")"
signature="$(cast rpc eth_sign "$address" "$message_hex" --rpc-url "$rpc_url" | jq -er '.')"
verify_body="$(jq -cn --arg message "$message" --arg signature "$signature" '{message:$message,signature:$signature}')"

curl -fsS -c "$work/cookies" -H 'content-type: application/json' \
  --data "$verify_body" "$base_url/auth/verify" >"$work/verified.json"
test "$(jq -r '.data.address' "$work/verified.json")" = "$address"
test "$(curl -sS -o "$work/replay.json" -w '%{http_code}' -H 'content-type: application/json' --data "$verify_body" "$base_url/auth/verify")" = "401"
test "$(curl -fsS -b "$work/cookies" "$base_url/auth/session" | jq -r '.data.address')" = "$address"
curl -fsS -b "$work/cookies" -c "$work/cookies" -X POST "$base_url/auth/logout" >/dev/null
test "$(curl -fsS -b "$work/cookies" "$base_url/auth/session" | jq -r '.data')" = "null"

echo "Creator SIWE session, replay rejection and logout passed for $address"

#!/usr/bin/env bash
set -euo pipefail

release_root="${ROBYN_TESTNET_RELEASE_ROOT:?ROBYN_TESTNET_RELEASE_ROOT is required}"
environment_file="${ROBYN_TESTNET_API_ENV_FILE:-/etc/robyn/testnet-api.env}"
node_binary="${ROBYN_NODE_BINARY:-/opt/node-v24.18.0-linux-x64/bin/node}"

if [[ -r "$environment_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$environment_file"
  set +a
elif [[ "${ROBYN_TESTNET_REQUIRE_REMOTE_PIN:-true}" == "true" ]]; then
  echo "Protected testnet API environment is not readable: $environment_file" >&2
  exit 1
fi
campaign_token_file="${ROBYN_CAMPAIGN_OPERATOR_TOKEN_FILE:-}"
if [[ -n "$campaign_token_file" ]]; then
  [[ -r "$campaign_token_file" ]] || {
    echo "Campaign operator token file is not readable" >&2
    exit 1
  }
  ROBYN_CAMPAIGN_OPERATOR_TOKEN="$(<"$campaign_token_file")"
  export ROBYN_CAMPAIGN_OPERATOR_TOKEN
fi
if [[ "${ROBYN_TESTNET_REQUIRE_REMOTE_PIN:-true}" == "true" ]]; then
  [[ -n "${ROBYN_REMOTE_PIN_URL:-}" && -n "${ROBYN_REMOTE_PIN_TOKEN:-}" ]] || {
    echo "Protected testnet API requires remote IPFS pinning credentials" >&2
    exit 1
  }
fi

exec "$node_binary" "$release_root/apps/api/dist/server.js"

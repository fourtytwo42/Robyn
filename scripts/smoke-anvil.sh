#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.foundry/bin:$PATH"

port="$(printenv ROBYN_ANVIL_PORT || true)"
if [[ -z "$port" ]]; then
  port="9545"
fi
rpc_url="http://127.0.0.1:$port"
log_file="$(mktemp)"
anvil_pid=""

cleanup() {
  if [[ -n "$anvil_pid" ]] && kill -0 "$anvil_pid" 2>/dev/null; then
    kill "$anvil_pid"
    wait "$anvil_pid" 2>/dev/null || true
  fi
  rm -f "$log_file"
}
trap cleanup EXIT

anvil --host 127.0.0.1 --port "$port" --chain-id 31337 --accounts 2 --silent >"$log_file" 2>&1 &
anvil_pid="$!"

for _ in {1..50}; do
  if cast chain-id --rpc-url "$rpc_url" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

chain_id="$(cast chain-id --rpc-url "$rpc_url")"
if [[ "$chain_id" != "31337" ]]; then
  echo "unexpected Anvil chain ID: $chain_id" >&2
  exit 1
fi

block_number="$(cast block-number --rpc-url "$rpc_url")"
if [[ "$block_number" != "0" ]]; then
  echo "unexpected fresh-chain block number: $block_number" >&2
  exit 1
fi

echo "Anvil smoke test passed on chain ID $chain_id"

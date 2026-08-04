#!/usr/bin/env bash
set -euo pipefail

state_dir=/home/hendo420/robyn-devnet/schema20-marketing
state_file="$state_dir/state.json"
load_request="$state_dir/load-request.json"
dump_response="$state_dir/state.next.json"
rpc_url=http://127.0.0.1:28549

mkdir -p "$state_dir"
chmod 700 "$state_dir"
jq -e 'type == "string" and startswith("0x")' "$state_file" >/dev/null
jq -n --slurpfile snapshot "$state_file" \
  '{jsonrpc:"2.0",id:1,method:"anvil_loadState",params:[$snapshot[0]]}' \
  > "$load_request"
chmod 600 "$load_request"

/home/hendo420/.foundry/bin/anvil \
  --host 127.0.0.1 \
  --port 28549 \
  --chain-id 31337 \
  --no-request-size-limit \
  --silent &
anvil_pid=$!
loaded_successfully=false

persist_and_stop() {
  trap - EXIT INT TERM
  if kill -0 "$anvil_pid" 2>/dev/null; then
    curl --fail --silent --show-error \
      -H 'content-type: application/json' \
      --data '{"jsonrpc":"2.0","id":2,"method":"anvil_dumpState","params":[]}' \
      "$rpc_url" > "$dump_response" || true
    if [[ "$loaded_successfully" == true ]] && jq -e '.result | type == "string" and startswith("0x")' "$dump_response" >/dev/null 2>&1; then
      jq '.result' "$dump_response" > "$state_file.tmp"
      chmod 600 "$state_file.tmp"
      mv "$state_file.tmp" "$state_file"
    fi
    kill "$anvil_pid" 2>/dev/null || true
    wait "$anvil_pid" 2>/dev/null || true
  fi
  rm -f "$load_request" "$dump_response"
}
trap persist_and_stop EXIT INT TERM

for _ in $(seq 1 100); do
  if curl --fail --silent \
    -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
    "$rpc_url" >/dev/null; then
    break
  fi
  sleep 0.1
done

curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  --data-binary "@$load_request" \
  "$rpc_url" | jq -e '.result == true' >/dev/null

loaded_block=$(/home/hendo420/.foundry/bin/cast block-number --rpc-url "$rpc_url")
if [[ "$loaded_block" -le 0 ]]; then
  echo "Schema-20 state load did not restore a nonzero block" >&2
  exit 1
fi
loaded_successfully=true

wait "$anvil_pid"

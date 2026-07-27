#!/usr/bin/env bash
set -euo pipefail

LOCAL_RPC=${ROBINHOOD_MAINNET_LOCAL_RPC:-http://127.0.0.1:18547}
PUBLIC_RPC=${ROBINHOOD_MAINNET_PUBLIC_RPC:-https://rpc.mainnet.chain.robinhood.com}
OUTPUT_ROOT=${ROBINHOOD_MAINNET_ACCEPTANCE_ROOT:-/var/lib/robinhood/mainnet-acceptance}

rpc() {
  local endpoint=$1 method=$2 params=$3
  curl -fsS --max-time 30 -H 'content-type: application/json' \
    --data "$(jq -cn --arg method "$method" --argjson params "$params" \
      '{jsonrpc:"2.0",id:1,method:$method,params:$params}')" "$endpoint"
}

result() {
  rpc "$1" "$2" "$3" | jq -ce '.result'
}

compare() {
  local label=$1 method=$2 params=$3
  local local_result public_result
  local_result=$(result "$LOCAL_RPC" "$method" "$params" | jq -cS .)
  public_result=$(result "$PUBLIC_RPC" "$method" "$params" | jq -cS .)
  if [[ "$local_result" != "$public_result" ]]; then
    echo "$label mismatch" >&2
    return 1
  fi
  jq -cn --arg label "$label" --arg method "$method" \
    '{label:$label,method:$method,status:"match"}' >> "$checks"
}

local_chain=$(result "$LOCAL_RPC" eth_chainId '[]')
public_chain=$(result "$PUBLIC_RPC" eth_chainId '[]')
syncing=$(result "$LOCAL_RPC" eth_syncing '[]')
[[ "$local_chain" == '"0x1237"' && "$public_chain" == '"0x1237"' && "$syncing" == false ]]

local_head_hex=$(result "$LOCAL_RPC" eth_blockNumber '[]' | jq -r .)
public_head_hex=$(result "$PUBLIC_RPC" eth_blockNumber '[]' | jq -r .)
local_head=$((local_head_hex))
public_head=$((public_head_hex))
lag=$((public_head > local_head ? public_head - local_head : 0))
((lag <= 50))
common=$((local_head < public_head ? local_head - 20 : public_head - 20))

run_id=$(date -u +%Y%m%dT%H%M%SZ)
run_dir="$OUTPUT_ROOT/$run_id"
install -d -m 0750 "$run_dir"
checks="$run_dir/checks.jsonl"
common_hex=$(printf '0x%x' "$common")

compare block eth_getBlockByNumber "[\"$common_hex\",false]"
compare logs eth_getLogs "[{\"fromBlock\":\"$common_hex\",\"toBlock\":\"$common_hex\"}]"
compare fee_history eth_feeHistory "[\"0x4\",\"$common_hex\",[25,50,75]]"
compare balance eth_getBalance "[\"0x0000000000000000000000000000000000000000\",\"$common_hex\"]"
compare bytecode eth_getCode "[\"0x0000000000000000000000000000000000000064\",\"$common_hex\"]"
compare call eth_call "[{\"to\":\"0x0000000000000000000000000000000000000000\",\"data\":\"0x\"},\"$common_hex\"]"

tx_hash=
for ((block=common; block > common - 200 && block >= 0; block--)); do
  block_hex=$(printf '0x%x' "$block")
  tx_hash=$(result "$LOCAL_RPC" eth_getBlockByNumber "[\"$block_hex\",false]" | jq -r '.transactions[0] // empty')
  [[ -n "$tx_hash" ]] && break
done
[[ -n "$tx_hash" ]]
compare receipt eth_getTransactionReceipt "[\"$tx_hash\"]"

tx=$(result "$LOCAL_RPC" eth_getTransactionByHash "[\"$tx_hash\"]")
from=$(jq -r '.from' <<<"$tx")
compare gas_estimate eth_estimateGas "[{\"from\":\"$from\",\"to\":\"0x0000000000000000000000000000000000000000\",\"value\":\"0x0\"},\"$common_hex\"]"

jq -cn --arg status pass --argjson localHead "$local_head" \
  --argjson publicHead "$public_head" --argjson lag "$lag" \
  --arg commonBlock "$common_hex" --arg transaction "$tx_hash" \
  '{status:$status,localHead:$localHead,publicHead:$publicHead,lagBlocks:$lag,commonBlock:$commonBlock,transaction:$transaction,transactionBroadcasts:0}' \
  > "$run_dir/result.json"
sha256sum "$checks" "$run_dir/result.json" > "$run_dir/SHA256SUMS"
ln -sfn "$run_dir" "$OUTPUT_ROOT/latest"
cat "$run_dir/result.json"

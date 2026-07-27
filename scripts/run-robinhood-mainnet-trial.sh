#!/usr/bin/env bash
set -euo pipefail

DURATION_SECONDS=${ROBINHOOD_MAINNET_TRIAL_DURATION_SECONDS:-172800}
INTERVAL_SECONDS=${ROBINHOOD_MAINNET_TRIAL_INTERVAL_SECONDS:-60}
STATE_ROOT=${ROBINHOOD_MAINNET_TRIAL_STATE_ROOT:-/var/lib/robinhood/mainnet-trial}
LOCAL_RPC=${ROBINHOOD_MAINNET_LOCAL_RPC:-http://127.0.0.1:18547}
PUBLIC_RPC=${ROBINHOOD_MAINNET_PUBLIC_RPC:-https://rpc.mainnet.chain.robinhood.com}

rpc() {
  local endpoint=$1 payload=$2
  curl -fsS --max-time 15 -H 'content-type: application/json' --data "$payload" "$endpoint"
}

hex_to_dec() {
  local value=$1
  printf '%d' "$((value))"
}

if (( DURATION_SECONDS < 3600 || INTERVAL_SECONDS < 30 )); then
  echo 'Trial duration must be at least one hour and interval at least 30 seconds' >&2
  exit 1
fi

chain_id=$(rpc "$LOCAL_RPC" '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | jq -r '.result // empty')
syncing=$(rpc "$LOCAL_RPC" '{"jsonrpc":"2.0","id":1,"method":"eth_syncing","params":[]}' | jq -c '.result')
if [[ "$chain_id" != 0x1237 || "$syncing" != false ]]; then
  echo "Refusing to start acceptance trial before full mainnet sync: chain=$chain_id syncing=$syncing" >&2
  exit 1
fi

run_id=$(date -u +%Y%m%dT%H%M%SZ)
run_dir="$STATE_ROOT/$run_id"
install -d -m 0750 "$run_dir"
ln -sfn "$run_dir" "$STATE_ROOT/active"
samples="$run_dir/samples.jsonl"
status="$run_dir/status.json"
start_epoch=$(date +%s)
end_epoch=$((start_epoch + DURATION_SECONDS))
start_data_bytes=$(du -sb /srv/robinhood/mainnet/data | awk '{print $1}')
start_restarts=$(systemctl show robinhood-mainnet-node.service -p NRestarts --value)
sequence=0

while (( $(date +%s) < end_epoch )); do
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  failures=()
  chain_id=$(rpc "$LOCAL_RPC" '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | jq -r '.result // empty' || true)
  syncing=$(rpc "$LOCAL_RPC" '{"jsonrpc":"2.0","id":1,"method":"eth_syncing","params":[]}' | jq -c '.result' || true)
  local_head_hex=$(rpc "$LOCAL_RPC" '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | jq -r '.result // empty' || true)
  public_head_hex=$(rpc "$PUBLIC_RPC" '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | jq -r '.result // empty' || true)
  [[ "$chain_id" == 0x1237 ]] || failures+=("chain_id")
  [[ "$syncing" == false ]] || failures+=("syncing")
  local_head=0; public_head=0; lag=0; common_hash_match=false
  [[ -n "$local_head_hex" ]] && local_head=$(hex_to_dec "$local_head_hex") || failures+=("local_head")
  [[ -n "$public_head_hex" ]] && public_head=$(hex_to_dec "$public_head_hex") || failures+=("public_head")
  (( public_head > local_head )) && lag=$((public_head - local_head))
  (( lag <= 50 )) || failures+=("head_lag")
  if (( local_head > 20 && public_head > 20 )); then
    common=$(( local_head < public_head ? local_head - 20 : public_head - 20 ))
    common_hex=$(printf '0x%x' "$common")
    local_hash=$(rpc "$LOCAL_RPC" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBlockByNumber\",\"params\":[\"$common_hex\",false]}" | jq -r '.result.hash // empty' || true)
    public_hash=$(rpc "$PUBLIC_RPC" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBlockByNumber\",\"params\":[\"$common_hex\",false]}" | jq -r '.result.hash // empty' || true)
    [[ -n "$local_hash" && "$local_hash" == "$public_hash" ]] && common_hash_match=true || failures+=("canonical_hash")
  else
    failures+=("common_block")
  fi

  latency_file=$(mktemp)
  success=0
  for payload in \
    '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
    '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["latest",false]}' \
    '{"jsonrpc":"2.0","id":1,"method":"eth_feeHistory","params":["0x4","latest",[25,50,75]]}' \
    '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0x0000000000000000000000000000000000000000","latest"]}' \
    '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["0x0000000000000000000000000000000000000000","latest"]}' \
    '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"fromBlock":"latest","toBlock":"latest"}]}'
  do
    result=$(curl -sS --max-time 15 -o /tmp/robinhood-mainnet-trial-rpc.json -w '%{http_code} %{time_total}' -H 'content-type: application/json' --data "$payload" "$LOCAL_RPC" || true)
    code=${result%% *}; elapsed=${result#* }
    if [[ "$code" == 200 ]] && jq -e 'has("result")' /tmp/robinhood-mainnet-trial-rpc.json >/dev/null 2>&1; then
      awk -v seconds="$elapsed" 'BEGIN { printf "%.3f\n", seconds * 1000 }' >> "$latency_file"
      success=$((success + 1))
    fi
  done
  if (( success == 6 )); then
    p95_ms=$(sort -n "$latency_file" | awk '{v[NR]=$1} END {i=int((NR*95+99)/100); if(i<1)i=1; print v[i]}')
  else
    p95_ms=999999
    failures+=("rpc_read_mix")
  fi
  rm -f "$latency_file" /tmp/robinhood-mainnet-trial-rpc.json
  awk -v p="$p95_ms" 'BEGIN { exit !(p <= 500) }' || failures+=("rpc_p95")

  memory_available=$(awk '/MemAvailable:/ {print $2*1024}' /proc/meminfo)
  swap_total=$(awk '/SwapTotal:/ {print $2*1024}' /proc/meminfo)
  swap_free=$(awk '/SwapFree:/ {print $2*1024}' /proc/meminfo)
  swap_used=$((swap_total - swap_free))
  disk_available=$(df --output=avail -B1 /srv/robinhood/mainnet/data | tail -1 | tr -d ' ')
  disk_size=$(df --output=size -B1 /srv/robinhood/mainnet/data | tail -1 | tr -d ' ')
  disk_percent=$((disk_available * 100 / disk_size))
  filesystem_used_bytes=$((disk_size - disk_available))
  restarts=$(systemctl show robinhood-mainnet-node.service -p NRestarts --value)
  oom_killed=$(docker inspect robinhood-mainnet-node --format '{{.State.OOMKilled}}' 2>/dev/null || echo true)
  (( memory_available >= 2147483648 )) || failures+=("memory")
  (( swap_used <= 2147483648 )) || failures+=("swap")
  (( disk_available >= 100000000000 && disk_percent >= 20 )) || failures+=("disk")
  [[ "$restarts" == "$start_restarts" ]] || failures+=("service_restart")
  [[ "$oom_killed" == false ]] || failures+=("oom")

  failure_json=$(printf '%s\n' "${failures[@]:-}" | jq -R . | jq -s 'map(select(length > 0))')
  jq -cn \
    --arg ts "$ts" --arg chainId "$chain_id" --arg syncing "$syncing" \
    --argjson sequence "$sequence" --argjson localHead "$local_head" --argjson publicHead "$public_head" \
    --argjson lag "$lag" --argjson hashMatch "$common_hash_match" --argjson p95 "$p95_ms" \
    --argjson memory "$memory_available" --argjson swap "$swap_used" --argjson disk "$disk_available" \
    --argjson diskPercent "$disk_percent" --argjson filesystemUsed "$filesystem_used_bytes" --argjson restarts "$restarts" \
    --argjson failures "$failure_json" \
    '{timestamp:$ts,sequence:$sequence,chainId:$chainId,syncing:$syncing,localHead:$localHead,publicHead:$publicHead,lagBlocks:$lag,canonicalHashMatch:$hashMatch,rpcP95Ms:$p95,memoryAvailableBytes:$memory,swapUsedBytes:$swap,diskAvailableBytes:$disk,diskAvailablePercent:$diskPercent,filesystemUsedBytes:$filesystemUsed,restarts:$restarts,failures:$failures}' \
    | tee -a "$samples" > "$status.tmp"
  mv "$status.tmp" "$status"
  if ((${#failures[@]})); then
    echo "Mainnet trial failed at $ts: ${failures[*]}" >&2
    exit 1
  fi
  sequence=$((sequence + 1))
  sleep "$INTERVAL_SECONDS"
done

end_data_bytes=$(du -sb /srv/robinhood/mainnet/data | awk '{print $1}')
elapsed=$(( $(date +%s) - start_epoch ))
growth=$((end_data_bytes - start_data_bytes))
(( growth < 0 )) && growth=0
growth_per_day=0
(( elapsed > 0 )) && growth_per_day=$((growth * 86400 / elapsed))
disk_available=$(df --output=avail -B1 /srv/robinhood/mainnet/data | tail -1 | tr -d ' ')
runway_days=0
(( growth_per_day > 0 )) && runway_days=$((disk_available / growth_per_day))
if (( growth_per_day > 0 && runway_days < 60 )); then
  echo "Mainnet trial failed disk runway: ${runway_days} days" >&2
  exit 1
fi
jq -cn --arg status complete --argjson samples "$sequence" --argjson elapsed "$elapsed" --argjson growth "$growth" --argjson growthPerDay "$growth_per_day" --argjson runwayDays "$runway_days" '{status:$status,samples:$samples,elapsedSeconds:$elapsed,dataGrowthBytes:$growth,growthBytesPerDay:$growthPerDay,projectedRunwayDays:$runwayDays}' > "$run_dir/final.json"
sha256sum "$samples" "$run_dir/final.json" > "$run_dir/SHA256SUMS"

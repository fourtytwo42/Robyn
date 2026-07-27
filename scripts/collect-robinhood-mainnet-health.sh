#!/usr/bin/env bash
set -u
source /etc/robinhood/mainnet/node.env
out_dir=/var/lib/prometheus/node-exporter
out="$out_dir/robinhood-mainnet.prom"
tmp="$out.tmp"
rpc(){ curl -fsS --max-time 8 -H 'content-type: application/json' --data "$2" "$1" 2>/dev/null || true; }
local_chain=$(rpc http://127.0.0.1:18547 '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | jq -r '.result // empty' 2>/dev/null)
local_head_hex=$(rpc http://127.0.0.1:18547 '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | jq -r '.result // empty' 2>/dev/null)
syncing_raw=$(rpc http://127.0.0.1:18547 '{"jsonrpc":"2.0","id":1,"method":"eth_syncing","params":[]}' | jq -c '.result' 2>/dev/null)
public_head_hex=$(rpc https://rpc.mainnet.chain.robinhood.com '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | jq -r '.result // empty' 2>/dev/null)
l1_chain=$(rpc "$L1_EXECUTION_URL" '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | jq -r '.result // empty' 2>/dev/null)
beacon=$(curl -fsS --max-time 8 "$L1_BEACON_URL/eth/v1/node/version" 2>/dev/null | jq -r '.data.version // empty' 2>/dev/null)
rpc_up=0; chain_ok=0; syncing=1; local_head=0; public_head=0; lag=0; l1_up=0; beacon_up=0
chain_num=0; [[ -n "$local_chain" ]] && chain_num=$((local_chain))
[[ -n "$local_head_hex" ]] && { local_head=$((local_head_hex)); rpc_up=1; }
[[ "$local_chain" == 0x1237 ]] && chain_ok=1
[[ "$syncing_raw" == false ]] && syncing=0
[[ -n "$public_head_hex" ]] && public_head=$((public_head_hex))
(( public_head > local_head )) && lag=$((public_head-local_head))
[[ "$l1_chain" == 0x1 ]] && l1_up=1
[[ -n "$beacon" ]] && beacon_up=1
filesystem_used_bytes=$(df --output=used -B1 /srv/robinhood/mainnet/data 2>/dev/null | tail -1 | tr -d ' ' || echo 0)
restarts=$(systemctl show robinhood-mainnet-node.service -p NRestarts --value 2>/dev/null || echo 0)
oom_killed=0
[[ "$(docker inspect robinhood-mainnet-node --format '{{.State.OOMKilled}}' 2>/dev/null || true)" == true ]] && oom_killed=1
cat > "$tmp" <<EOF
# TYPE robinhood_mainnet_rpc_up gauge
robinhood_mainnet_rpc_up $rpc_up
# TYPE robinhood_mainnet_chain_id gauge
robinhood_mainnet_chain_id $chain_num
# TYPE robinhood_mainnet_chain_id_ok gauge
robinhood_mainnet_chain_id_ok $chain_ok
# TYPE robinhood_mainnet_syncing gauge
robinhood_mainnet_syncing $syncing
# TYPE robinhood_mainnet_head_block gauge
robinhood_mainnet_head_block $local_head
# TYPE robinhood_mainnet_public_head_block gauge
robinhood_mainnet_public_head_block $public_head
# TYPE robinhood_mainnet_head_lag_blocks gauge
robinhood_mainnet_head_lag_blocks $lag
# TYPE robinhood_mainnet_l1_execution_up gauge
robinhood_mainnet_l1_execution_up $l1_up
# TYPE robinhood_mainnet_l1_beacon_up gauge
robinhood_mainnet_l1_beacon_up $beacon_up
# TYPE robinhood_mainnet_filesystem_used_bytes gauge
robinhood_mainnet_filesystem_used_bytes ${filesystem_used_bytes:-0}
# TYPE robinhood_mainnet_service_restarts_total gauge
robinhood_mainnet_service_restarts_total ${restarts:-0}
# TYPE robinhood_mainnet_oom_killed gauge
robinhood_mainnet_oom_killed $oom_killed
# TYPE robinhood_mainnet_health_sample_timestamp_seconds gauge
robinhood_mainnet_health_sample_timestamp_seconds $(date +%s)
EOF
chmod 0644 "$tmp"
mv "$tmp" "$out"

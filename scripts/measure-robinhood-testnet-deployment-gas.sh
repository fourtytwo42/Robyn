#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${ROBYN_TESTNET_GAS_MEASUREMENT_PORT:-18546}"
local_rpc="http://127.0.0.1:$port"
public_rpc="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

if cast chain-id --rpc-url "$local_rpc" >/dev/null 2>&1; then
  echo "Gas-measurement port $port is already in use" >&2
  exit 1
fi

work="$(mktemp -d /tmp/robyn-testnet-gas.XXXXXX)"
anvil --host 127.0.0.1 --port "$port" --chain-id 46630 --silent >"$work/anvil.log" 2>&1 &
anvil_pid=$!
cleanup() {
  kill "$anvil_pid" 2>/dev/null || true
  wait "$anvil_pid" 2>/dev/null || true
  case "$work" in
    /tmp/robyn-testnet-gas.*) rm -rf -- "$work" ;;
    *) exit 98 ;;
  esac
}
trap cleanup EXIT

for _ in $(seq 1 100); do
  if cast chain-id --rpc-url "$local_rpc" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
[[ "$(cast chain-id --rpc-url "$local_rpc")" == "46630" ]]

manifest="$work/46630.json"
dex_manifest="$work/46630-uniswap-v3.json"
ROBYN_TESTNET_RPC_URL="$local_rpc" \
ROBYN_TESTNET_DEX_MANIFEST="$dex_manifest" \
ROBYN_TESTNET_REHEARSAL=true \
ROBYN_ALLOW_UNLOCKED_REHEARSAL=true \
ROBYN_TESTNET_DEX_BROADCAST=true \
  scripts/deploy-testnet-uniswap-v3.sh >/dev/null
ROBYN_TESTNET_RPC_URL="$local_rpc" \
ROBYN_TESTNET_MANIFEST="$manifest" \
ROBYN_TESTNET_DEX_MANIFEST="$dex_manifest" \
ROBYN_TESTNET_REHEARSAL=true \
ROBYN_ALLOW_UNLOCKED_REHEARSAL=true \
ROBYN_TESTNET_BROADCAST=true \
  scripts/deploy-testnet.sh >/dev/null

latest_block="$(cast block-number --rpc-url "$local_rpc")"
total_gas=0
transaction_count=0
for ((block = 1; block <= latest_block; block++)); do
  block_json="$(cast block "$block" --rpc-url "$local_rpc" --json)"
  while IFS= read -r transaction; do
    [[ -n "$transaction" ]] || continue
    receipt="$(cast receipt "$transaction" --rpc-url "$local_rpc" --json)"
    gas_used="$(jq -r .gasUsed <<<"$receipt")"
    total_gas=$((total_gas + gas_used))
    transaction_count=$((transaction_count + 1))
  done < <(jq -r '.transactions[]?' <<<"$block_json")
done

gas_price_wei="$(cast gas-price --rpc-url "$public_rpc")"
execution_cost_wei=$((total_gas * gas_price_wei))
coordinator="$(jq -er '.contracts.atomicLaunchCoordinator' "$manifest")"
launch_topic="$(cast keccak 'AtomicLaunchCreated(uint256,address,address,address,address,address,address,address,bytes32,bytes32,bytes32)')"
launch_filter="$(jq -nc --arg address "$coordinator" --arg topic "$launch_topic" '{fromBlock:"0x0",toBlock:"latest",address:$address,topics:[$topic]}')"
launch_tx="$(cast rpc eth_getLogs "$launch_filter" --rpc-url "$local_rpc" | jq -er '.[0].transactionHash')"
atomic_launch_gas_raw="$(cast receipt "$launch_tx" --rpc-url "$local_rpc" --json | jq -er '.gasUsed')"
atomic_launch_gas=$((atomic_launch_gas_raw))
jq -n \
  --argjson chainId 46630 \
  --argjson transactionCount "$transaction_count" \
  --argjson deploymentGasUsed "$total_gas" \
  --arg gasPriceWei "$gas_price_wei" \
  --arg executionCostWei "$execution_cost_wei" \
  --arg executionCostEth "$(cast from-wei "$execution_cost_wei")" \
  --argjson atomicLaunchGasUsed "$atomic_launch_gas" \
  '{schemaVersion: 2, chainId: $chainId, transactionCount: $transactionCount, deploymentGasUsed: $deploymentGasUsed, atomicLaunchGasUsed: $atomicLaunchGasUsed, gasPriceWei: $gasPriceWei, executionCostWei: $executionCostWei, executionCostEth: $executionCostEth, includesArbitrumL1DataFee: false}'

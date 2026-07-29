#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
pricing_rpc_url="${ROBYN_TESTNET_PRICING_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
manifest="${ROBYN_TESTNET_V4_PROTOCOL_MANIFEST:?ROBYN_TESTNET_V4_PROTOCOL_MANIFEST is required}"
output="${ROBYN_TESTNET_V4_GAS_EVIDENCE:-$repo_root/evidence/46630-v4-gas.json}"
deployer="${ROBYN_TESTNET_DEPLOYER_ADDRESS:-0xecc5d6d032ADc9ca9E0F4042128067b8366da17A}"
headroom_bps="${ROBYN_TESTNET_V4_GAS_HEADROOM_BPS:-2500}"
reserve_wei="${ROBYN_TESTNET_V4_RESERVE_WEI:-1500000000000000}"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

[[ -f "$manifest" ]] || { echo "Deployment manifest not found: $manifest" >&2; exit 1; }
[[ "$(jq -r '.chainId' "$manifest")" == "46630" ]] || { echo "Manifest chain mismatch" >&2; exit 1; }
[[ "$(cast chain-id --rpc-url "$rpc_url")" == "46630" ]] || { echo "RPC chain mismatch" >&2; exit 1; }
[[ "$(cast chain-id --rpc-url "$pricing_rpc_url")" == "46630" ]] || {
  echo "Pricing RPC chain mismatch" >&2
  exit 1
}
[[ "$headroom_bps" -ge 2500 ]] || { echo "At least 25% headroom is required" >&2; exit 1; }

transactions="$(
  jq -r '[
      .deploymentTransactions[]?,
      .configurationTransactions[]?,
      (
        .assetRoutes[]?
        | .seedTransaction?,
          .assetCreationTransaction?,
          .adapterCreationTransaction?,
          .priceGuardCreationTransaction?
      ),
      .genesis.transactionHash?
    ]
    | map(select(type == "string" and length > 0)) | unique[]' "$manifest"
)"
[[ -n "$transactions" ]] || { echo "No deployment transactions in manifest" >&2; exit 1; }

receipts='[]'
total_gas=0
total_calldata_bytes=0
while IFS= read -r transaction; do
  receipt="$(cast receipt "$transaction" --rpc-url "$rpc_url" --json)"
  status="$(jq -r '.status' <<<"$receipt")"
  [[ "$status" == "0x1" || "$status" == "1" ]] || { echo "Failed transaction $transaction" >&2; exit 1; }
  gas_hex="$(jq -er '.gasUsed' <<<"$receipt")"
  gas_used="$((gas_hex))"
  input="$(cast tx "$transaction" --rpc-url "$rpc_url" --json | jq -er '.input')"
  calldata_bytes="$(( (${#input} - 2) / 2 ))"
  total_gas=$((total_gas + gas_used))
  total_calldata_bytes=$((total_calldata_bytes + calldata_bytes))
  receipts="$(jq --arg transaction "$transaction" --arg gasUsed "$gas_used" \
    --arg calldataBytes "$calldata_bytes" \
    '. + [{transaction:$transaction,gasUsed:$gasUsed,calldataBytes:$calldataBytes}]' <<<"$receipts")"
done <<<"$transactions"

gas_price="$(cast gas-price --rpc-url "$pricing_rpc_url")"
base_execution_wei="$(node -e \
  'console.log((BigInt(process.argv[1])*BigInt(process.argv[2])).toString())' "$total_gas" "$gas_price")"
execution_with_headroom="$(node -e \
  'const b=BigInt(process.argv[1]),h=BigInt(process.argv[2]); console.log(((b*(10000n+h)+9999n)/10000n).toString())' \
  "$base_execution_wei" "$headroom_bps")"

# Robinhood Chain uses Nitro. Use the live chain's L1 base-fee estimate and a
# conservative uncompressed upper bound with 140 bytes of envelope overhead.
l1_base_fee="$(cast call 0x000000000000000000000000000000000000006C \
  'getL1BaseFeeEstimate()(uint256)' --rpc-url "$pricing_rpc_url" | awk '{print $1}')"
transaction_count="$(wc -l <<<"$transactions" | tr -d ' ')"
l1_data_gas="$(( (total_calldata_bytes + transaction_count * 140) * 16 ))"
l1_data_wei="$(node -e \
  'console.log((BigInt(process.argv[1])*BigInt(process.argv[2])).toString())' "$l1_data_gas" "$l1_base_fee")"
l1_with_headroom="$(node -e \
  'const b=BigInt(process.argv[1]),h=BigInt(process.argv[2]); console.log(((b*(10000n+h)+9999n)/10000n).toString())' \
  "$l1_data_wei" "$headroom_bps")"
required_wei="$(node -e \
  'console.log((BigInt(process.argv[1])+BigInt(process.argv[2])).toString())' \
  "$execution_with_headroom" "$l1_with_headroom")"
balance="$(cast balance "$deployer" --rpc-url "$pricing_rpc_url")"
required_with_reserve_wei="$(node -e \
  'console.log((BigInt(process.argv[1])+BigInt(process.argv[2])).toString())' "$required_wei" "$reserve_wei")"
sufficient="$(node -e \
  'console.log(BigInt(process.argv[1])>=BigInt(process.argv[2]))' "$balance" "$required_with_reserve_wei")"

mkdir -p "$(dirname "$output")"
tmp="$(mktemp "$(dirname "$output")/.v4-gas.XXXXXX")"
jq -n \
  --argjson chainId 46630 \
  --arg gitCommit "$(jq -r '.gitCommit' "$manifest")" \
  --arg manifestSha256 "$(sha256sum "$manifest" | awk '{print $1}')" \
  --arg deployer "$deployer" \
  --argjson headroomBps "$headroom_bps" \
  --arg totalGas "$total_gas" \
  --arg transactionCount "$transaction_count" \
  --arg totalCalldataBytes "$total_calldata_bytes" \
  --arg gasPriceWei "$gas_price" \
  --arg l1BaseFeeEstimateWei "$l1_base_fee" \
  --arg l1DataGasUpperBound "$l1_data_gas" \
  --arg executionWei "$base_execution_wei" \
  --arg executionWithHeadroomWei "$execution_with_headroom" \
  --arg l1DataWei "$l1_data_wei" \
  --arg l1DataWithHeadroomWei "$l1_with_headroom" \
  --arg requiredWei "$required_wei" \
  --arg reserveWei "$reserve_wei" \
  --arg requiredWithReserveWei "$required_with_reserve_wei" \
  --arg balanceWei "$balance" \
  --argjson sufficientBalance "$sufficient" \
  --argjson transactions "$receipts" \
  '{
    chainId:$chainId,gitCommit:$gitCommit,manifestSha256:$manifestSha256,
    deployer:$deployer,headroomBps:$headroomBps,totalGas:$totalGas,
    transactionCount:$transactionCount,totalCalldataBytes:$totalCalldataBytes,
    gasPriceWei:$gasPriceWei,l1BaseFeeEstimateWei:$l1BaseFeeEstimateWei,
    l1DataGasUpperBound:$l1DataGasUpperBound,
    executionWei:$executionWei,executionWithHeadroomWei:$executionWithHeadroomWei,
    l1DataWei:$l1DataWei,l1DataWithHeadroomWei:$l1DataWithHeadroomWei,
    requiredWei:$requiredWei,reserveWei:$reserveWei,
    requiredWithReserveWei:$requiredWithReserveWei,balanceWei:$balanceWei,
    sufficientBalance:$sufficientBalance,transactions:$transactions
  }' >"$tmp"
mv "$tmp" "$output"
sha256sum "$output" >"$output.sha256"
jq . "$output"

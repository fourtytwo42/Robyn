#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_OPERATOR_RPC_URL:-http://127.0.0.1:8545}"
manifest="${1:-${ROBYN_DEVNET_MANIFEST:-$repo_root/deployments/31337.json}}"
export PATH="$HOME/.foundry/bin:$PATH"

test -f "$manifest"
test "$(jq -r '.environment' "$manifest")" = "robyn-devnet"
test "$(jq -r '.chainId' "$manifest")" = "31337"
test "$(cast chain-id --rpc-url "$rpc_url")" = "31337"

readarray -t addresses < <(
  jq -r '
    .contracts.baseAsset,
    .contracts.rewardAssets[],
    .contracts.conversionRouter,
    .contracts.factory,
    .contracts.genesisToken,
    .contracts.genesisVault,
    .contracts.genesisMarket
  ' "$manifest"
)
for address in "${addresses[@]}"; do
  if [[ "$(cast code "$address" --rpc-url "$rpc_url")" == "0x" ]]; then
    echo "Missing bytecode at $address" >&2
    exit 1
  fi
done

base="$(jq -r '.contracts.baseAsset' "$manifest")"
router="$(jq -r '.contracts.conversionRouter' "$manifest")"
factory="$(jq -r '.contracts.factory' "$manifest")"
token="$(jq -r '.contracts.genesisToken' "$manifest")"
vault="$(jq -r '.contracts.genesisVault' "$manifest")"
market="$(jq -r '.contracts.genesisMarket' "$manifest")"

test "$(cast call "$factory" "chainId()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')" = "31337"
test "$(cast call "$factory" "vaultByToken(address)(address)" "$token" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$vault" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$vault" "launchToken()(address)" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$token" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$vault" "baseAsset()(address)" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$base" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$vault" "conversionRouter()(address)" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$router" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$token" "exclusionsSealed()(bool)" --rpc-url "$rpc_url")" = "true"
test "$(cast call "$token" "isExcluded(address)(bool)" "$market" --rpc-url "$rpc_url")" = "true"
test "$(cast call "$base" "faucetAmount()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')" = "10000000000000000000000"
test "$(cast call "$vault" "legCount()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')" = "3"
pending="$(cast call "$vault" "totalPendingBase()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')"
consumed="$(cast call "$vault" "totalBaseConsumed()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')"
received="$(cast call "$vault" "totalFeesReceived()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')"
test "$(python3 -c 'import sys; print(int(sys.argv[1]) + int(sys.argv[2]) == int(sys.argv[3]))' "$pending" "$consumed" "$received")" = "True"

for index in 0 1 2; do
  asset="$(jq -r ".contracts.rewardAssets[$index]" "$manifest")"
  actual="$(cast call "$token" "rewardAsset(uint256)(address)" "$index" --rpc-url "$rpc_url")"
  test "$(echo "$actual" | tr '[:upper:]' '[:lower:]')" = "$(echo "$asset" | tr '[:upper:]' '[:lower:]')"
done

test "$(cast call "$market" "feeBps()(uint16)" --rpc-url "$rpc_url" | awk '{print $1}')" = "100"
test "$(cast call "$market" "basePerToken()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')" = "1000000000000000"

echo "Verified devnet deployment at block $(cast block-number --rpc-url "$rpc_url")"

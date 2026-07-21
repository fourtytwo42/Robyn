#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="${1:-$repo_root/deployments/46630.json}"
rpc_url="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
export PATH="$HOME/.foundry/bin:$PATH"

jq -e '.schemaVersion == 1 and .environment == "robinhood-testnet" and .chainId == 46630 and .mockOnly == true and .assetStrategy == "project-owned-testnet-mocks"' "$manifest" >/dev/null
if grep -Eqs 'DEVNET_ONLY|robyn-devnet|31337' "$manifest"; then
  echo "Devnet content found in testnet manifest" >&2
  exit 1
fi
if grep -RqsE 'DEVNET_ONLY|robyn-devnet' "$repo_root/packages/contracts/src/testnet"; then
  echo "Devnet content found in testnet contract sources" >&2
  exit 1
fi
jq -e '.chainId == 46630 and .deployment.allowsUnlockedAccount == false' "$repo_root/config/networks/robinhood-testnet.json" >/dev/null

chain_id="$(cast chain-id --rpc-url "$rpc_url")"
[[ "$chain_id" == "46630" ]] || { echo "RPC chain is $chain_id, expected 46630" >&2; exit 1; }

contract() { jq -er ".contracts.$1" "$manifest"; }
base="$(contract baseAsset)"
router="$(contract conversionRouter)"
factory="$(contract factory)"
market_factory="$(contract marketFactory)"
token="$(contract genesisToken)"
vault="$(contract genesisVault)"
market="$(contract genesisMarket)"
mapfile -t rewards < <(jq -er '.contracts.rewardAssets[]' "$manifest")
[[ "${#rewards[@]}" == 3 ]] || { echo "Expected three reward assets" >&2; exit 1; }

for address in "$base" "$router" "$factory" "$market_factory" "$token" "$vault" "$market" "${rewards[@]}"; do
  [[ "$address" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "Invalid contract address $address" >&2; exit 1; }
  [[ "$(cast code "$address" --rpc-url "$rpc_url")" != "0x" ]] || { echo "No code at $address" >&2; exit 1; }
done

[[ "$(cast call "$factory" 'chainId()(uint256)' --rpc-url "$rpc_url" --json | jq -r '.[0]')" == "46630" ]]
[[ "$(cast call "$factory" 'baseAsset()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" == "${base,,}" ]]
[[ "$(cast call "$factory" 'conversionRouter()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" == "${router,,}" ]]
[[ "$(cast call "$factory" 'vaultByToken(address)(address)' "$token" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" == "${vault,,}" ]]
[[ "$(cast call "$vault" 'launchToken()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" == "${token,,}" ]]
[[ "$(cast call "$token" 'controller()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" == "${vault,,}" ]]
[[ "$(cast call "$market_factory" 'marketByToken(address)(address)' "$token" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" == "${market,,}" ]]
[[ "$(cast call "$token" 'isExcluded(address)(bool)' "$market" --rpc-url "$rpc_url")" == "true" ]]
[[ "$(cast call "$token" 'rewardAssetCount()(uint256)' --rpc-url "$rpc_url" --json | jq -r '.[0]')" == "3" ]]
[[ "$(cast call "$base" 'faucetAmount()(uint256)' --rpc-url "$rpc_url" --json | jq -r '.[0]')" == "10000000000000000000000" ]]
[[ "$(cast call "$base" 'TESTNET_MOCK_ONLY()(string)' --rpc-url "$rpc_url" --json | jq -r '.[0]')" == "robinhood-testnet-mock" ]]
[[ "$(cast call "$router" 'TESTNET_MOCK_ONLY()(string)' --rpc-url "$rpc_url" --json | jq -r '.[0]')" == "robinhood-testnet-mock" ]]
[[ "$(cast call "$market" 'TESTNET_MOCK_ONLY()(string)' --rpc-url "$rpc_url" --json | jq -r '.[0]')" == "robinhood-testnet-mock" ]]

expected_weights=(4000 4000 2000)
for i in 0 1 2; do
  [[ "$(cast call "$token" 'rewardAsset(uint256)(address)' "$i" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" == "${rewards[$i],,}" ]]
  leg_weight="$(cast call "$vault" 'leg(uint256)((address,uint16,uint256,uint256,uint256,uint256))' "$i" --rpc-url "$rpc_url" --json | jq -r '.[0][1]')"
  [[ "$leg_weight" == "${expected_weights[$i]}" ]] || { echo "Unexpected basket weight $i: $leg_weight" >&2; exit 1; }
done

printf 'Verified Robinhood testnet package deployment at block %s\n' "$(cast block-number --rpc-url "$rpc_url")"
#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="${1:-${ROBYN_TESTNET_DEX_MANIFEST:-$repo_root/deployments/46630-uniswap-v3.json}}"
rpc_url="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
export PATH="$HOME/.foundry/bin:$PATH"

[[ "$(cast chain-id --rpc-url "$rpc_url")" == "46630" ]] || { echo "Expected chain 46630" >&2; exit 1; }
jq -e '.chainId == 46630 and .testOnly == true and .officialDeployment == false and .provenance == "robyn-controlled-uniswap-v3-testnet"' "$manifest" >/dev/null
jq -e '.packageVersions == {v3Core:"1.0.0",v3Periphery:"1.4.4",swapRouterContracts:"1.1.0"} and .sourceCommits == {v3Core:"e3589b192d0be27e100cd0daaf6c97204fdb1899",v3Periphery:"697c2474757ea89fec12a4e6db16a574fe259610",swapRouterContracts:"8fe4f086cee7c08f0bdb6ebe20c9ab615921c65f"}' "$manifest" >/dev/null

declare -A artifacts=(
  [weth9]="packages/contracts/out/TestnetWETH9.sol/TestnetWETH9.json"
  [factory]="node_modules/@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json"
  [positionManager]="node_modules/@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json"
  [quoterV2]="node_modules/@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json"
  [swapRouter02]="packages/contracts/vendor/uniswap/swap-router-contracts-1.1.0/SwapRouter02.json"
)

for key in weth9 factory positionManager quoterV2 swapRouter02; do
  [[ "$(sha256sum "${artifacts[$key]}" | awk '{print $1}')" == "$(jq -er ".artifactSha256.$key" "$manifest")" ]] || { echo "$key artifact hash mismatch" >&2; exit 1; }
  address="$(jq -er ".contracts.$key" "$manifest")"
  [[ "$(cast code "$address" --rpc-url "$rpc_url")" != "0x" ]] || { echo "$key has no code" >&2; exit 1; }
  [[ "$(cast codehash "$address" --rpc-url "$rpc_url" | tr A-F a-f)" == "$(jq -er ".runtimeCodeHashes.$key" "$manifest" | tr A-F a-f)" ]] || { echo "$key runtime hash mismatch" >&2; exit 1; }
  tx="$(jq -er ".deploymentTransactions.$key" "$manifest")"
  input="$(cast rpc eth_getTransactionByHash "$tx" --rpc-url "$rpc_url" | jq -er '.input')"
  [[ "$(cast keccak "$input" | tr A-F a-f)" == "$(jq -er ".creationBytecodeHashes.$key" "$manifest" | tr A-F a-f)" ]] || { echo "$key creation input mismatch" >&2; exit 1; }
done

factory="$(jq -er '.contracts.factory' "$manifest")"
weth="$(jq -er '.contracts.weth9' "$manifest")"
position="$(jq -er '.contracts.positionManager' "$manifest")"
quoter="$(jq -er '.contracts.quoterV2' "$manifest")"
router="$(jq -er '.contracts.swapRouter02' "$manifest")"
[[ "$(cast call "$factory" 'owner()(address)' --rpc-url "$rpc_url" | tr A-F a-f)" == "$(jq -er '.factoryConfiguration.owner' "$manifest" | tr A-F a-f)" ]]
for pair in '500 10' '3000 60' '10000 200'; do
  read -r fee spacing <<<"$pair"
  [[ "$(cast call "$factory" 'feeAmountTickSpacing(uint24)(int24)' "$fee" --rpc-url "$rpc_url")" == "$spacing" ]]
done
for contract in "$position" "$quoter" "$router"; do
  [[ "$(cast call "$contract" 'factory()(address)' --rpc-url "$rpc_url" | tr A-F a-f)" == "$(tr A-F a-f <<<"$factory")" ]]
  [[ "$(cast call "$contract" 'WETH9()(address)' --rpc-url "$rpc_url" | tr A-F a-f)" == "$(tr A-F a-f <<<"$weth")" ]]
done
[[ "$(cast call "$router" 'positionManager()(address)' --rpc-url "$rpc_url" | tr A-F a-f)" == "$(tr A-F a-f <<<"$position")" ]]
echo "Verified test-only Uniswap v3 manifest at block $(cast block-number --rpc-url "$rpc_url")"

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="${1:-$repo_root/deployments/46630.json}"
rpc_url="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
export PATH="$HOME/.foundry/bin:$PATH"

jq -e '.schemaVersion == 3 and .environment == "robinhood-testnet" and .chainId == 46630 and .mockOnly == true and .assetStrategy == "project-owned-testnet-mocks" and .market.liquidityVenue == "robyn-controlled-uniswap-v3-testnet"' "$manifest" >/dev/null
grep -Eqs 'DEVNET_ONLY|robyn-devnet|31337' "$manifest" && { echo "Devnet content found in testnet manifest" >&2; exit 1; }
jq -e '.chainId == 46630 and .deployment.allowsUnlockedAccount == false' "$repo_root/config/networks/robinhood-testnet.json" >/dev/null
[[ "$(cast chain-id --rpc-url "$rpc_url")" == "46630" ]]

contract() { jq -er ".contracts.$1" "$manifest"; }
base="$(contract baseAsset)"; router="$(contract conversionRouter)"; factory="$(contract factory)"
launch_deployer="$(contract launchDeployer)"; market_factory="$(contract marketFactory)"; coordinator="$(contract atomicLaunchCoordinator)"
adapter_deployer="$(contract adapterDeployer)"; market_deployer="$(contract marketDeployer)"
dao_token="$(contract daoToken)"; governor="$(contract governor)"; timelock="$(contract timelock)"
guardian="$(contract guardian)"; fee_router="$(contract protocolFeeRouter)"; native_converter="$(contract nativeFeeConverter)"
token="$(contract genesisToken)"; vault="$(contract genesisVault)"; market="$(contract genesisMarket)"
adapter="$(contract genesisGraduationAdapter)"; locker="$(contract genesisPositionLocker)"; pool="$(contract genesisGraduatedPool)"
mapfile -t rewards < <(jq -er '.contracts.rewardAssets[]' "$manifest")
mapfile -t addresses < <(jq -r '.contracts.baseAsset,.contracts.wrappedNative,.contracts.rewardAssets[],.contracts.conversionRouter,.contracts.factory,.contracts.launchDeployer,.contracts.marketFactory,.contracts.atomicLaunchCoordinator,.contracts.daoToken,.contracts.governor,.contracts.timelock,.contracts.protocolFeeRouter,.contracts.nativeFeeConverter,.contracts.nativeConversionPool,.contracts.adapterDeployer,.contracts.marketDeployer,.contracts.genesisToken,.contracts.genesisVault,.contracts.genesisMarket,.contracts.genesisGraduationAdapter,.contracts.genesisPositionLocker,.contracts.genesisGraduatedPool,.localUniswapV3.factory,.localUniswapV3.positionManager,.localUniswapV3.quoter,.localUniswapV3.swapRouter,.localUniswapV3.wrappedQuoteAsset' "$manifest")
for address in "${addresses[@]}"; do [[ "$address" =~ ^0x[0-9a-fA-F]{40}$ && "$(cast code "$address" --rpc-url "$rpc_url")" != "0x" ]] || { echo "Missing code at $address" >&2; exit 1; }; done

lower() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
eq_address() { [[ "$(lower "$(cast call "$1" "$2" ${3:-} --rpc-url "$rpc_url")")" == "$(lower "$4")" ]]; }
[[ "$(cast call "$factory" 'chainId()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')" == "46630" ]]
eq_address "$factory" 'baseAsset()(address)' "" "$base"
eq_address "$factory" 'conversionRouter()(address)' "" "$router"
eq_address "$factory" 'coordinator()(address)' "" "$coordinator"
eq_address "$market_factory" 'launchFactory()(address)' "" "$factory"
eq_address "$market_factory" 'coordinator()(address)' "" "$coordinator"
eq_address "$coordinator" 'launchFactory()(address)' "" "$factory"
eq_address "$coordinator" 'marketFactory()(address)' "" "$market_factory"
eq_address "$coordinator" 'feeRouter()(address)' "" "$fee_router"
eq_address "$market_factory" 'feeRouter()(address)' "" "$fee_router"
eq_address "$fee_router" 'coordinator()(address)' "" "$coordinator"
eq_address "$fee_router" 'converter()(address)' "" "$native_converter"
eq_address "$native_converter" 'feeRouter()(address)' "" "$fee_router"
eq_address "$fee_router" 'treasury()(address)' "" "$timelock"
eq_address "$fee_router" 'guardian()(address)' "" "$guardian"
eq_address "$launch_deployer" 'controller()(address)' "" "$factory"
eq_address "$adapter_deployer" 'controller()(address)' "" "$market_factory"
eq_address "$market_deployer" 'controller()(address)' "" "$market_factory"
eq_address "$factory" 'vaultByToken(address)(address)' "$token" "$vault"
eq_address "$market_factory" 'marketByToken(address)(address)' "$token" "$market"
eq_address "$market_factory" 'adapterByToken(address)(address)' "$token" "$adapter"
eq_address "$vault" 'launchToken()(address)' "" "$token"
eq_address "$vault" 'baseAsset()(address)' "" "$base"
eq_address "$vault" 'conversionRouter()(address)' "" "$router"
eq_address "$market" 'graduationAdapter()(address)' "" "$adapter"
eq_address "$market" 'positionLocker()(address)' "" "$locker"
eq_address "$market" 'graduatedPool()(address)' "" "$pool"
eq_address "$adapter" 'pool()(address)' "" "$pool"
eq_address "$market" 'feeRouter()(address)' "" "$fee_router"
eq_address "$locker" 'feeRouter()(address)' "" "$fee_router"

[[ "$(cast call "$market" 'seeded()(bool)' --rpc-url "$rpc_url")" == "true" ]]
[[ "$(cast call "$token" 'exclusionsSealed()(bool)' --rpc-url "$rpc_url")" == "true" ]]
for excluded in "$market" "$adapter" "$locker" "$pool" "$coordinator" "$fee_router"; do [[ "$(cast call "$token" 'isExcluded(address)(bool)' "$excluded" --rpc-url "$rpc_url")" == "true" ]]; done
[[ "$(cast call "$token" 'balanceOf(address)(uint256)' "$coordinator" --rpc-url "$rpc_url" | awk '{print $1}')" == "0" ]]
[[ "$(cast call "$token" 'allowance(address,address)(uint256)' "$coordinator" "$market" --rpc-url "$rpc_url" | awk '{print $1}')" == "0" ]]
[[ "$(cast call "$base" 'TESTNET_MOCK_ONLY()(string)' --rpc-url "$rpc_url" --json | jq -r '.[0]')" == "robinhood-testnet-mock" ]]
[[ "$(cast call "$router" 'TESTNET_MOCK_ONLY()(string)' --rpc-url "$rpc_url" --json | jq -r '.[0]')" == "robinhood-testnet-mock" ]]
[[ "$(cast call "$(jq -er '.localUniswapV3.wrappedQuoteAsset' "$manifest")" 'TESTNET_PROVENANCE()(string)' --rpc-url "$rpc_url" --json | jq -r '.[0]')" == "robyn-controlled-uniswap-v3-testnet" ]]
[[ "$(cast call "$dao_token" 'totalSupply()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')" == "1000000000000000000000000000" ]]
[[ "$(cast call "$dao_token" 'rewardDepositor()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" == "$(lower "$fee_router")" ]]
[[ "$(cast call "$dao_token" 'exclusionsSealed()(bool)' --rpc-url "$rpc_url")" == "true" ]]
for excluded in "$timelock" "$fee_router" "$governor" "$coordinator" "$market_factory"; do [[ "$(cast call "$dao_token" 'isRewardExcluded(address)(bool)' "$excluded" --rpc-url "$rpc_url")" == "true" ]]; done
[[ "$(cast call "$fee_router" 'CREATOR_BPS()(uint16)' --rpc-url "$rpc_url" | awk '{print $1}')" == "2500" ]]
[[ "$(cast call "$fee_router" 'DAO_REWARD_BPS()(uint16)' --rpc-url "$rpc_url" | awk '{print $1}')" == "2000" ]]
[[ "$(cast call "$fee_router" 'TREASURY_BPS()(uint16)' --rpc-url "$rpc_url" | awk '{print $1}')" == "500" ]]
[[ "$(cast call "$governor" 'votingDelay()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')" == "86400" ]]
[[ "$(cast call "$governor" 'votingPeriod()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')" == "259200" ]]
[[ "$(cast call "$governor" 'proposalThreshold()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')" == "10000000000000000000000000" ]]
[[ "$(cast call "$timelock" 'getMinDelay()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')" == "172800" ]]
proposer_role="$(cast call "$timelock" 'PROPOSER_ROLE()(bytes32)' --rpc-url "$rpc_url")"
admin_role="$(cast call "$timelock" 'DEFAULT_ADMIN_ROLE()(bytes32)' --rpc-url "$rpc_url")"
[[ "$(cast call "$timelock" 'hasRole(bytes32,address)(bool)' "$proposer_role" "$governor" --rpc-url "$rpc_url")" == "true" ]]
[[ "$(cast call "$timelock" 'hasRole(bytes32,address)(bool)' "$admin_role" "$(jq -er '.deployer' "$manifest")" --rpc-url "$rpc_url")" == "false" ]]
fee_account="$(cast call "$fee_router" 'launchAccount(address)((address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,bool))' "$token" --rpc-url "$rpc_url" --json)"
[[ "$(jq -r '.[0][10]' <<<"$fee_account")" == "true" ]]
[[ "$(lower "$(jq -r '.[0][0]' <<<"$fee_account")")" == "$(lower "$(jq -er '.deployer' "$manifest")")" ]]
[[ "$(lower "$(jq -r '.[0][1]' <<<"$fee_account")")" == "$(lower "$vault")" ]]
[[ "$(lower "$(jq -r '.[0][2]' <<<"$fee_account")")" == "$(lower "$market")" ]]
[[ "$(lower "$(jq -r '.[0][3]' <<<"$fee_account")")" == "$(lower "$locker")" ]]

expected_weights=(4000 4000 2000)
for i in 0 1 2; do
  eq_address "$token" 'rewardAsset(uint256)(address)' "$i" "${rewards[$i]}"
  [[ "$(cast call "$vault" 'leg(uint256)((address,uint16,uint256,uint256,uint256,uint256))' "$i" --rpc-url "$rpc_url" --json | jq -r '.[0][1]')" == "${expected_weights[$i]}" ]]
done
[[ "$(cast call "$market_factory" 'poolFee()(uint24)' --rpc-url "$rpc_url" | awk '{print $1}')" == "$(jq -r '.market.poolFeePips' "$manifest")" ]]
[[ "$(cast call "$market_factory" 'curveTokenAllocation()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')" == "$(jq -r '.market.curveTokenAllocation' "$manifest")" ]]
[[ "$(cast call "$market_factory" 'graduationThresholdBase()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')" == "$(jq -r '.market.graduationThresholdBase' "$manifest")" ]]
echo "Verified atomic Robinhood testnet package at block $(cast block-number --rpc-url "$rpc_url")"

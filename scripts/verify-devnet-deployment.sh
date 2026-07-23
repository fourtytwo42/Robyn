#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_OPERATOR_RPC_URL:-http://127.0.0.1:8545}"
manifest="${1:-${ROBYN_DEVNET_MANIFEST:-$repo_root/deployments/31337.json}}"
export PATH="$HOME/.foundry/bin:$PATH"

test -f "$manifest"
test "$(jq -r '.environment' "$manifest")" = "robyn-devnet"
test "$(jq -r '.chainId' "$manifest")" = "31337"
test "$(jq -r '.schemaVersion' "$manifest")" = "3"
test "$(cast chain-id --rpc-url "$rpc_url")" = "31337"

readarray -t addresses < <(
  jq -r '
    .contracts.baseAsset,
    .contracts.wrappedNative,
    .contracts.rewardAssets[],
    .contracts.conversionRouter,
    .contracts.factory,
    (.contracts.launchDeployer // empty),
    .contracts.marketFactory,
    (.contracts.atomicLaunchCoordinator // empty),
    .contracts.daoToken,
    .contracts.governor,
    .contracts.timelock,
    .contracts.protocolFeeRouter,
    .contracts.nativeFeeConverter,
    .contracts.nativeConversionPool,
    (.contracts.adapterDeployer // empty),
    (.contracts.marketDeployer // empty),
    .contracts.genesisToken,
    .contracts.genesisVault,
    .contracts.genesisMarket,
    (.contracts.genesisGraduationAdapter // empty),
    (.contracts.genesisPositionLocker // empty),
    (.contracts.genesisGraduatedPool // empty),
    (.localUniswapV3.factory // empty),
    (.localUniswapV3.positionManager // empty),
    (.localUniswapV3.quoter // empty),
    (.localUniswapV3.swapRouter // empty),
    (.contracts.bondingMarketFactory // empty),
    ((.bondingDemos // .demoLaunches // [])[] | .market),
    ((.bondingDemos // .demoLaunches // [])[] | .graduationAdapter // empty),
    ((.bondingDemos // .demoLaunches // [])[] | .positionLocker // empty),
    ((.bondingDemos // .demoLaunches // [])[] | .graduatedPool)
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
market_factory="$(jq -r '.contracts.marketFactory' "$manifest")"
coordinator="$(jq -er '.contracts.atomicLaunchCoordinator' "$manifest")"
launch_deployer="$(jq -er '.contracts.launchDeployer' "$manifest")"
token="$(jq -r '.contracts.genesisToken' "$manifest")"
vault="$(jq -r '.contracts.genesisVault' "$manifest")"
market="$(jq -r '.contracts.genesisMarket' "$manifest")"
fee_router="$(jq -er '.contracts.protocolFeeRouter' "$manifest")"
rdao="$(jq -er '.contracts.daoToken' "$manifest")"
governor="$(jq -er '.contracts.governor' "$manifest")"
timelock="$(jq -er '.contracts.timelock' "$manifest")"
guardian="$(jq -er '.contracts.guardian' "$manifest")"
native_converter="$(jq -er '.contracts.nativeFeeConverter' "$manifest")"
weth="$(jq -er '.contracts.wrappedNative' "$manifest")"

test "$(cast call "$factory" "chainId()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')" = "31337"
test "$(cast call "$market_factory" "launchFactory()(address)" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$factory" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$factory" 'coordinator()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$coordinator" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$market_factory" 'coordinator()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$coordinator" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$coordinator" 'launchFactory()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$factory" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$coordinator" 'marketFactory()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$market_factory" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$coordinator" 'feeRouter()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$fee_router" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$fee_router" 'coordinator()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$coordinator" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$market_factory" 'feeRouter()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$fee_router" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$launch_deployer" 'controller()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$factory" | tr '[:upper:]' '[:lower:]')"
resolved_market="$(cast call "$market_factory" "marketByToken(address)(address)" "$token" --rpc-url "$rpc_url")"
if [[ "$resolved_market" == "0x0000000000000000000000000000000000000000" ]]; then
  while read -r legacy_factory; do
    resolved_market="$(cast call "$legacy_factory" "marketByToken(address)(address)" "$token" --rpc-url "$rpc_url")"
    [[ "$resolved_market" != "0x0000000000000000000000000000000000000000" ]] && break
  done < <(jq -r '.contracts.legacyMarketFactories[]?' "$manifest")
fi
test "$(echo "$resolved_market" | tr '[:upper:]' '[:lower:]')" = "$(echo "$market" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$factory" "vaultByToken(address)(address)" "$token" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$vault" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$vault" "launchToken()(address)" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$token" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$vault" "baseAsset()(address)" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$base" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$vault" "conversionRouter()(address)" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$router" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$token" "exclusionsSealed()(bool)" --rpc-url "$rpc_url")" = "true"
test "$(cast call "$token" "isExcluded(address)(bool)" "$market" --rpc-url "$rpc_url")" = "true"
test "$(cast call "$token" 'isExcluded(address)(bool)' "$coordinator" --rpc-url "$rpc_url")" = "true"
test "$(cast call "$token" 'isExcluded(address)(bool)' "$fee_router" --rpc-url "$rpc_url")" = "true"
test "$(cast call "$token" 'balanceOf(address)(uint256)' "$coordinator" --rpc-url "$rpc_url" | awk '{print $1}')" = "0"
test "$(cast call "$token" 'allowance(address,address)(uint256)' "$coordinator" "$market" --rpc-url "$rpc_url" | awk '{print $1}')" = "0"
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
test "$(cast call "$market" 'feeRouter()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$fee_router" | tr '[:upper:]' '[:lower:]')"

test "$(cast call "$rdao" 'totalSupply()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')" = "1000000000000000000000000000"
test "$(cast call "$rdao" 'rewardDepositor()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$fee_router" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$rdao" 'exclusionsSealed()(bool)' --rpc-url "$rpc_url")" = "true"
test "$(cast call "$rdao" 'isRewardExcluded(address)(bool)' "$timelock" --rpc-url "$rpc_url")" = "true"
test "$(cast call "$fee_router" 'daoToken()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$rdao" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$fee_router" 'treasury()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$timelock" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$fee_router" 'guardian()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$guardian" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$fee_router" 'converter()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$native_converter" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$native_converter" 'feeRouter()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$fee_router" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$native_converter" 'wrappedNative()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$weth" | tr '[:upper:]' '[:lower:]')"
test "$(cast call "$fee_router" 'CREATOR_BPS()(uint16)' --rpc-url "$rpc_url" | awk '{print $1}')" = "2500"
test "$(cast call "$fee_router" 'DAO_REWARD_BPS()(uint16)' --rpc-url "$rpc_url" | awk '{print $1}')" = "2000"
test "$(cast call "$fee_router" 'TREASURY_BPS()(uint16)' --rpc-url "$rpc_url" | awk '{print $1}')" = "500"
test "$(cast call "$governor" 'votingDelay()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')" = "86400"
test "$(cast call "$governor" 'votingPeriod()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')" = "259200"
test "$(cast call "$timelock" 'getMinDelay()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')" = "172800"
admin_role="$(cast call "$timelock" 'DEFAULT_ADMIN_ROLE()(bytes32)' --rpc-url "$rpc_url")"
proposer_role="$(cast call "$timelock" 'PROPOSER_ROLE()(bytes32)' --rpc-url "$rpc_url")"
test "$(cast call "$timelock" 'hasRole(bytes32,address)(bool)' "$admin_role" "$(jq -r '.deployer' "$manifest")" --rpc-url "$rpc_url")" = "false"
test "$(cast call "$timelock" 'hasRole(bytes32,address)(bool)' "$proposer_role" "$governor" --rpc-url "$rpc_url")" = "true"

market_type="$(jq -r '.market.type // "legacy-fixed"' "$manifest")"
if [[ "$market_type" == "bonding-curve-v1" || "$market_type" == "uniswap-v3-bonding-curve-v1" ]]; then
  bonding_factory="$(jq -r '.contracts.bondingMarketFactory // .contracts.marketFactory' "$manifest")"
  test "$(cast call "$bonding_factory" "curveTokenAllocation()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')" = "$(jq -r '.market.curveTokenAllocation' "$manifest")"
  test "$(cast call "$bonding_factory" "graduationThresholdBase()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')" = "$(jq -r '.market.graduationThresholdBase' "$manifest")"
  while read -r demo_market demo_pool expected_phase; do
    test "$(cast call "$demo_market" "seeded()(bool)" --rpc-url "$rpc_url")" = "true"
    test "$(cast call "$demo_market" "graduatedPool()(address)" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$demo_pool" | tr '[:upper:]' '[:lower:]')"
    if [[ "$expected_phase" == "graduated" ]]; then
      test "$(cast call "$demo_market" "graduated()(bool)" --rpc-url "$rpc_url")" = "true"
      test "$(cast call "$demo_market" "graduationProgressBps()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')" = "10000"
      if [[ "$market_type" == "uniswap-v3-bonding-curve-v1" ]]; then
        liquidity="$(cast call "$demo_pool" "liquidity()(uint128)" --rpc-url "$rpc_url" | awk '{print $1}')"
        test "$(python3 -c 'import sys; print(int(sys.argv[1]) > 0)' "$liquidity")" = "True"
      else
        test "$(cast call "$demo_pool" "initialized()(bool)" --rpc-url "$rpc_url")" = "true"
      fi
    else
      test "$(cast call "$demo_market" "graduated()(bool)" --rpc-url "$rpc_url")" = "false"
      progress="$(cast call "$demo_market" "graduationProgressBps()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')"
      test "$progress" -gt 0
      test "$progress" -lt 10000
    fi
  done < <(jq -r '(.bondingDemos // .demoLaunches // [])[] | [.market,.graduatedPool,.phase] | @tsv' "$manifest")

  if [[ "$market_type" == "uniswap-v3-bonding-curve-v1" ]]; then
    adapter="$(jq -r '.contracts.genesisGraduationAdapter' "$manifest")"
    locker="$(jq -r '.contracts.genesisPositionLocker' "$manifest")"
    pool="$(jq -r '.contracts.genesisGraduatedPool' "$manifest")"
    adapter_deployer="$(jq -r '.contracts.adapterDeployer' "$manifest")"
    market_deployer="$(jq -r '.contracts.marketDeployer' "$manifest")"
    position_manager="$(jq -r '.localUniswapV3.positionManager' "$manifest")"
    test "$(cast call "$market" 'graduationAdapter()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$adapter" | tr '[:upper:]' '[:lower:]')"
    test "$(cast call "$market" 'positionLocker()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$locker" | tr '[:upper:]' '[:lower:]')"
    test "$(cast call "$adapter" 'pool()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$pool" | tr '[:upper:]' '[:lower:]')"
    test "$(cast call "$locker" 'feeRouter()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$fee_router" | tr '[:upper:]' '[:lower:]')"
    test "$(cast call "$adapter_deployer" 'controller()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$market_factory" | tr '[:upper:]' '[:lower:]')"
    test "$(cast call "$market_deployer" 'controller()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$market_factory" | tr '[:upper:]' '[:lower:]')"
    test "$(cast call "$market_factory" 'uniswapFactory()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(jq -r '.localUniswapV3.factory' "$manifest" | tr '[:upper:]' '[:lower:]')"
    test "$(cast call "$market_factory" 'positionManager()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$position_manager" | tr '[:upper:]' '[:lower:]')"
    test "$(cast call "$market_factory" 'poolFee()(uint24)' --rpc-url "$rpc_url" | awk '{print $1}')" = "$(jq -r '.market.poolFeePips' "$manifest")"
    test "$(cast call "$market_factory" 'initialBasePerTokenX18()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')" = "$(jq -r '.market.initialBasePerTokenX18' "$manifest")"
    test "$(cast call "$token" 'isExcluded(address)(bool)' "$adapter" --rpc-url "$rpc_url")" = "true"
    test "$(cast call "$token" 'isExcluded(address)(bool)' "$locker" --rpc-url "$rpc_url")" = "true"
    test "$(cast call "$token" 'isExcluded(address)(bool)' "$pool" --rpc-url "$rpc_url")" = "true"
    while read -r component expected_hash; do
      address="$(jq -r --arg component "$component" '.localUniswapV3[$component]' "$manifest")"
      test "$(cast codehash "$address" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" = "$(echo "$expected_hash" | tr '[:upper:]' '[:lower:]')"
    done < <(jq -r '.localUniswapV3.runtimeCodeHashes | to_entries[] | [.key,.value] | @tsv' "$manifest")
  fi
else
  test "$(cast call "$market" "basePerToken()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')" = "1000000000000000"
fi

echo "Verified devnet deployment at block $(cast block-number --rpc-url "$rpc_url")"

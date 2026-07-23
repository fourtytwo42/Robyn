#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_OPERATOR_RPC_URL:-http://127.0.0.1:8545}"
manifest="${ROBYN_DEVNET_MANIFEST:-$repo_root/deployments/31337.json}"
force="${ROBYN_FORCE_DEPLOY:-false}"

export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

chain_id="$(cast chain-id --rpc-url "$rpc_url")"
if [[ "$chain_id" != "31337" ]]; then
  echo "Refusing devnet deployment on chain $chain_id" >&2
  exit 1
fi

if [[ -f "$manifest" && "$force" != "true" ]]; then
  existing_factory="$(jq -r '.contracts.factory // empty' "$manifest")"
  if [[ -n "$existing_factory" && "$(cast code "$existing_factory" --rpc-url "$rpc_url")" != "0x" ]]; then
    echo "Existing live deployment: $manifest"
    "$repo_root/scripts/verify-devnet-deployment.sh" "$manifest"
    exit 0
  fi
fi

deployer="$(cast rpc eth_accounts --rpc-url "$rpc_url" | jq -r '.[0]')"
if [[ -z "$deployer" || "$deployer" == "null" ]]; then
  echo "No unlocked operator account is available on loopback RPC" >&2
  exit 1
fi
gas_price="$(cast gas-price --rpc-url "$rpc_url")"
if [[ ! "$gas_price" =~ ^[0-9]+$ || "$gas_price" == "0" ]]; then
  echo "RPC returned an invalid gas price: $gas_price" >&2
  exit 1
fi

forge build --root packages/contracts >/dev/null

deploy_contract() {
  local contract="$1"
  shift
  local command=(forge create "$contract" --root packages/contracts --rpc-url "$rpc_url" --from "$deployer" --unlocked --broadcast --json --gas-price "$gas_price")
  if [[ "$#" -gt 0 ]]; then
    command+=(--constructor-args "$@")
  fi
  "${command[@]}" | jq -er '.deployedTo'
}

send_transaction() {
  cast send --rpc-url "$rpc_url" --from "$deployer" --unlocked --gas-price "$gas_price" --json "$@" |
    jq -e '.status == "0x1" or .status == 1' >/dev/null
}

base="$(deploy_contract src/devnet/DevnetMockERC20.sol:DevnetMockERC20 "Mock USD" "mUSD" "$deployer" "10000000000000000000000")"
nvda="$(deploy_contract src/devnet/DevnetMockERC20.sol:DevnetMockERC20 "Mock NVIDIA" "mNVDA" "$deployer" "0")"
spy="$(deploy_contract src/devnet/DevnetMockERC20.sol:DevnetMockERC20 "Mock S&P 500" "mSPY" "$deployer" "0")"
eth_reward="$(deploy_contract src/devnet/DevnetMockERC20.sol:DevnetMockERC20 "Mock Ether" "mETH" "$deployer" "0")"
router="$(deploy_contract src/devnet/DevnetConversionRouter.sol:DevnetConversionRouter "$deployer")"
launch_deployer="$(deploy_contract src/RobynLaunchDeployerV2.sol:RobynLaunchDeployerV2)"
factory="$(deploy_contract src/RobynLaunchFactoryV2.sol:RobynLaunchFactoryV2 "$base" "$router" "$launch_deployer" "1000000000000000000" "86400")"
uniswap_json="$(ROBYN_OPERATOR_RPC_URL="$rpc_url" "$repo_root/scripts/deploy-local-uniswap-v3.sh" "$base")"
uniswap_factory="$(jq -er '.factory' <<<"$uniswap_json")"
position_manager="$(jq -er '.positionManager' <<<"$uniswap_json")"
quoter="$(jq -er '.quoter' <<<"$uniswap_json")"
swap_router="$(jq -er '.swapRouter' <<<"$uniswap_json")"
curve_token_allocation="800000000000000000000000000"
graduation_token_allocation="200000000000000000000000000"
initial_virtual_token_reserve="1066666666666666666666666666"
initial_virtual_base_reserve="2166666666666666666667"
graduation_threshold_base="6500000000000000000000"
initial_base_per_token_x18="32500000000000"
pool_fee_pips="10000"
tick_lower="-887200"
tick_upper="887200"
minimum_use_bps="9900"
maximum_price_deviation_bps="100"
adapter_deployer="$(deploy_contract src/uniswap/UniswapV3AdapterDeployer.sol:UniswapV3AdapterDeployer)"
market_deployer="$(deploy_contract src/uniswap/UniswapV3MarketDeployer.sol:UniswapV3MarketDeployer)"
market_factory="$({
  deploy_contract src/uniswap/UniswapV3MarketFactoryV2.sol:UniswapV3MarketFactoryV2 \
    "$base" "$factory" "$adapter_deployer" "$market_deployer" \
    "($curve_token_allocation,$graduation_token_allocation,$initial_virtual_token_reserve,$initial_virtual_base_reserve,$graduation_threshold_base,100)" \
    "($uniswap_factory,$position_manager,$swap_router,$quoter,$pool_fee_pips,$tick_lower,$tick_upper,$initial_base_per_token_x18,$minimum_use_bps,$maximum_price_deviation_bps)"
})"
coordinator="$(deploy_contract src/RobynAtomicLaunchCoordinator.sol:RobynAtomicLaunchCoordinator "$factory" "$market_factory")"
send_transaction "$launch_deployer" "bindController(address)" "$factory"
send_transaction "$adapter_deployer" "bindController(address)" "$market_factory"
send_transaction "$market_deployer" "bindController(address)" "$market_factory"
send_transaction "$factory" "bindCoordinator(address)" "$coordinator"
send_transaction "$market_factory" "bindCoordinator(address)" "$coordinator"

reward_liquidity="10000000000000000000000000"
base_liquidity="10000000000000000000000000"
initial_supply="1000000000000000000000000000"

send_transaction "$base" "mint(address,uint256)" "$deployer" "$base_liquidity"
for reward in "$nvda" "$spy" "$eth_reward"; do
  send_transaction "$reward" "mint(address,uint256)" "$router" "$reward_liquidity"
done

send_transaction "$router" "setRate(address,address,uint256)" "$base" "$nvda" "1000000000000000000"
send_transaction "$router" "setRate(address,address,uint256)" "$base" "$spy" "2000000000000000000"
send_transaction "$router" "setRate(address,address,uint256)" "$base" "$eth_reward" "3000000000000000000"

genesis_salt="$(cast keccak 'robyn-devnet-genesis-v2')"
send_transaction "$coordinator" \
  "createLaunch((string,string,address[],uint16[],bytes32))" \
  "(\"Robyn Genesis\",\"ROBYN\",[$nvda,$spy,$eth_reward],[4000,4000,2000],$genesis_salt)"

launch_id="$(cast call "$factory" "launchCount()(uint256)" --rpc-url "$rpc_url")"
token="$(cast call "$factory" "launchTokenById(uint256)(address)" "$launch_id" --rpc-url "$rpc_url")"
vault="$(cast call "$factory" "vaultByToken(address)(address)" "$token" --rpc-url "$rpc_url")"
market="$(cast call "$market_factory" "marketByToken(address)(address)" "$token" --rpc-url "$rpc_url")"
adapter="$(cast call "$market_factory" "adapterByToken(address)(address)" "$token" --rpc-url "$rpc_url")"
pool="$(cast call "$market" "graduatedPool()(address)" --rpc-url "$rpc_url")"
locker="$(cast call "$market" "positionLocker()(address)" --rpc-url "$rpc_url")"

block_number="$(cast block-number --rpc-url "$rpc_url")"
git_commit="$(git rev-parse HEAD)"
mkdir -p "$(dirname "$manifest")"
temporary_manifest="$(mktemp "$(dirname "$manifest")/.31337.XXXXXX")"
jq -n --arg environment "robyn-devnet" --argjson chainId "$chain_id" --argjson blockNumber "$block_number" --arg gitCommit "$git_commit" --arg deployer "$deployer" --arg base "$base" --arg nvda "$nvda" --arg spy "$spy" --arg ethReward "$eth_reward" --arg router "$router" --arg factory "$factory" --arg launchDeployer "$launch_deployer" --arg marketFactory "$market_factory" --arg coordinator "$coordinator" --arg adapterDeployer "$adapter_deployer" --arg marketDeployer "$market_deployer" --arg token "$token" --arg vault "$vault" --arg market "$market" --arg adapter "$adapter" --arg locker "$locker" --arg pool "$pool" --argjson localUniswapV3 "$uniswap_json" --arg curveTokens "$curve_token_allocation" --arg graduationTokens "$graduation_token_allocation" --arg virtualTokens "$initial_virtual_token_reserve" --arg virtualBase "$initial_virtual_base_reserve" --arg threshold "$graduation_threshold_base" --arg initialPrice "$initial_base_per_token_x18" --argjson poolFee "$pool_fee_pips" --arg tickLower "$tick_lower" --arg tickUpper "$tick_upper" --arg minimumUse "$minimum_use_bps" --arg maximumDeviation "$maximum_price_deviation_bps" '{
    schemaVersion: 2,
    environment: $environment,
    chainId: $chainId,
    deploymentBlock: $blockNumber,
    gitCommit: $gitCommit,
    deployer: $deployer,
    contracts: {
      baseAsset: $base,
      rewardAssets: [$nvda, $spy, $ethReward],
      conversionRouter: $router,
      factory: $factory,
      launchDeployer: $launchDeployer,
      marketFactory: $marketFactory,
      atomicLaunchCoordinator: $coordinator,
      adapterDeployer: $adapterDeployer,
      marketDeployer: $marketDeployer,
      genesisToken: $token,
      genesisVault: $vault,
      genesisMarket: $market,
      genesisGraduationAdapter: $adapter,
      genesisPositionLocker: $locker,
      genesisGraduatedPool: $pool
    },
    localUniswapV3: $localUniswapV3,
    genesisBasket: [
      {symbol: "mNVDA", weightBps: 4000},
      {symbol: "mSPY", weightBps: 4000},
      {symbol: "mETH", weightBps: 2000}
    ],
    market: {
      type: "uniswap-v3-bonding-curve-v1",
      liquidityVenue: "local-canonical-uniswap-v3",
      feeBps: 100,
      poolFeePips: $poolFee,
      tickLower: ($tickLower | tonumber),
      tickUpper: ($tickUpper | tonumber),
      initialBasePerTokenX18: $initialPrice,
      minimumUseBps: ($minimumUse | tonumber),
      maximumPriceDeviationBps: ($maximumDeviation | tonumber),
      curveTokenAllocation: $curveTokens,
      graduationTokenAllocation: $graduationTokens,
      initialVirtualTokenReserve: $virtualTokens,
      initialVirtualBaseReserve: $virtualBase,
      graduationThresholdBase: $threshold
    }
  }' >"$temporary_manifest"
mv "$temporary_manifest" "$manifest"

"$repo_root/scripts/verify-devnet-deployment.sh" "$manifest"
echo "Wrote $manifest"

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
weth="$(deploy_contract src/devnet/DevnetWrappedNative.sol:DevnetWrappedNative)"
nvda="$(deploy_contract src/devnet/DevnetMockERC20.sol:DevnetMockERC20 "Mock NVIDIA" "mNVDA" "$deployer" "0")"
spy="$(deploy_contract src/devnet/DevnetMockERC20.sol:DevnetMockERC20 "Mock S&P 500" "mSPY" "$deployer" "0")"
eth_reward="$(deploy_contract src/devnet/DevnetMockERC20.sol:DevnetMockERC20 "Mock Ether" "mETH" "$deployer" "0")"
router="$(deploy_contract src/devnet/DevnetConversionRouter.sol:DevnetConversionRouter "$deployer")"
launch_deployer="$(deploy_contract src/RobynLaunchDeployerV2.sol:RobynLaunchDeployerV2)"
factory="$(deploy_contract src/RobynLaunchFactoryV2.sol:RobynLaunchFactoryV2 "$base" "$router" "$launch_deployer" "1000000000000000000" "86400")"
uniswap_json="$(ROBYN_OPERATOR_RPC_URL="$rpc_url" "$repo_root/scripts/deploy-local-uniswap-v3.sh" "$base" "$weth")"
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
twap_window_seconds="60"
maximum_conversion_price_impact_bps="100"
maximum_conversion_tick_deviation="100"

# Seed the controlled base/WETH conversion venue at a 1:1 test-only price.
native_pool_liquidity="10000000000000000000000"
send_transaction "$weth" --value "$native_pool_liquidity" "deposit()"
send_transaction "$base" "mint(address,uint256)" "$deployer" "$native_pool_liquidity"
send_transaction "$base" "approve(address,uint256)" "$position_manager" "$native_pool_liquidity"
send_transaction "$weth" "approve(address,uint256)" "$position_manager" "$native_pool_liquidity"
send_transaction "$position_manager" \
  "createAndInitializePoolIfNecessary(address,address,uint24,uint160)" \
  "$base" "$weth" "$pool_fee_pips" "79228162514264337593543950336"
if [[ "${base,,}" < "${weth,,}" ]]; then
  native_token0="$base"
  native_token1="$weth"
else
  native_token0="$weth"
  native_token1="$base"
fi
native_deadline="$(($(date +%s) + 3600))"
send_transaction "$position_manager" \
  "mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))" \
  "($native_token0,$native_token1,$pool_fee_pips,$tick_lower,$tick_upper,$native_pool_liquidity,$native_pool_liquidity,99000000000000000000,99000000000000000000,$deployer,$native_deadline)"
native_pool="$(cast call "$uniswap_factory" "getPool(address,address,uint24)(address)" "$base" "$weth" "$pool_fee_pips" --rpc-url "$rpc_url")"
send_transaction "$native_pool" "increaseObservationCardinalityNext(uint16)" "64"

# DAO supply is fixed: 80% initial contributor allocation and 20% timelock treasury reserve on devnet.
timelock="$(deploy_contract ../../node_modules/@openzeppelin/contracts/governance/TimelockController.sol:TimelockController "172800" "[]" "[]" "$deployer")"
rdao="$(deploy_contract src/dao/RobynDaoToken.sol:RobynDaoToken "[$deployer,$timelock]" "[800000000000000000000000000,200000000000000000000000000]")"
governor="$(deploy_contract src/dao/RobynGovernor.sol:RobynGovernor "$rdao" "$timelock")"
fee_router="$(deploy_contract src/dao/RobynProtocolFeeRouterV2.sol:RobynProtocolFeeRouterV2 "$base" "$rdao" "$timelock" "$deployer")"
native_converter="$(deploy_contract src/uniswap/UniswapV3NativeFeeConverter.sol:UniswapV3NativeFeeConverter \
  "$uniswap_factory" "$swap_router" "$quoter" "$base" "$weth" "$pool_fee_pips" "$pool_fee_pips" \
  "$twap_window_seconds" "$maximum_conversion_price_impact_bps" "$maximum_conversion_tick_deviation")"
adapter_deployer="$(deploy_contract src/uniswap/UniswapV3AdapterDeployer.sol:UniswapV3AdapterDeployer)"
market_deployer="$(deploy_contract src/uniswap/UniswapV3MarketDeployer.sol:UniswapV3MarketDeployer)"
market_factory="$({
  deploy_contract src/uniswap/UniswapV3MarketFactoryV3.sol:UniswapV3MarketFactoryV3 \
    "$base" "$factory" "$adapter_deployer" "$market_deployer" "$fee_router" \
    "($curve_token_allocation,$graduation_token_allocation,$initial_virtual_token_reserve,$initial_virtual_base_reserve,$graduation_threshold_base,100)" \
    "($uniswap_factory,$position_manager,$swap_router,$quoter,$pool_fee_pips,$tick_lower,$tick_upper,$initial_base_per_token_x18,$minimum_use_bps,$maximum_price_deviation_bps)"
})"
coordinator="$(deploy_contract src/RobynDaoLaunchCoordinator.sol:RobynDaoLaunchCoordinator "$factory" "$market_factory" "$fee_router")"
send_transaction "$launch_deployer" "bindController(address)" "$factory"
send_transaction "$adapter_deployer" "bindController(address)" "$market_factory"
send_transaction "$market_deployer" "bindController(address)" "$market_factory"
send_transaction "$factory" "bindCoordinator(address)" "$coordinator"
send_transaction "$market_factory" "bindCoordinator(address)" "$coordinator"
send_transaction "$fee_router" "bindCoordinator(address)" "$coordinator"
send_transaction "$native_converter" "bindFeeRouter(address)" "$fee_router"
send_transaction "$fee_router" "setConverter(address)" "$native_converter"
send_transaction "$rdao" "sealRewardExclusions(address[])" "[$timelock,$fee_router,$governor,$coordinator,$market_factory]"
send_transaction "$rdao" "bindRewardDepositor(address)" "$fee_router"
proposer_role="$(cast call "$timelock" "PROPOSER_ROLE()(bytes32)" --rpc-url "$rpc_url")"
canceller_role="$(cast call "$timelock" "CANCELLER_ROLE()(bytes32)" --rpc-url "$rpc_url")"
executor_role="$(cast call "$timelock" "EXECUTOR_ROLE()(bytes32)" --rpc-url "$rpc_url")"
admin_role="$(cast call "$timelock" "DEFAULT_ADMIN_ROLE()(bytes32)" --rpc-url "$rpc_url")"
send_transaction "$timelock" "grantRole(bytes32,address)" "$proposer_role" "$governor"
send_transaction "$timelock" "grantRole(bytes32,address)" "$canceller_role" "$deployer"
send_transaction "$timelock" "grantRole(bytes32,address)" "$executor_role" "0x0000000000000000000000000000000000000000"
send_transaction "$timelock" "renounceRole(bytes32,address)" "$admin_role" "$deployer"

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

genesis_salt="$(cast keccak 'robyn-devnet-genesis-v3-dao')"
fallback_metadata_uri="ipfs://bafkreibys2cv4ijpoedcl7qdbi5u66wuwedwg3lsc6pios3wcyaoyz7cau"
genesis_metadata_uri="$(
  node scripts/pin-fallback-metadata.mjs \
    apps/web/public/assets/launchpad/token-robyn.webp \
    "Robyn Genesis" "ROBYN" \
    "The original Robyn reward-basket community token." |
    jq -er '.metadataUri'
)"
send_transaction "$coordinator" \
  "createLaunch((string,string,address[],uint16[],string,bytes32))" \
  "(\"Robyn Genesis\",\"ROBYN\",[$nvda,$spy,$eth_reward],[4000,4000,2000],\"$genesis_metadata_uri\",$genesis_salt)"

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
jq -n --arg environment "robyn-devnet" --argjson chainId "$chain_id" --argjson blockNumber "$block_number" --arg gitCommit "$git_commit" --arg deployer "$deployer" --arg base "$base" --arg weth "$weth" --arg nvda "$nvda" --arg spy "$spy" --arg ethReward "$eth_reward" --arg router "$router" --arg factory "$factory" --arg launchDeployer "$launch_deployer" --arg marketFactory "$market_factory" --arg coordinator "$coordinator" --arg adapterDeployer "$adapter_deployer" --arg marketDeployer "$market_deployer" --arg token "$token" --arg vault "$vault" --arg market "$market" --arg adapter "$adapter" --arg locker "$locker" --arg pool "$pool" --arg timelock "$timelock" --arg governor "$governor" --arg rdao "$rdao" --arg feeRouter "$fee_router" --arg nativeConverter "$native_converter" --arg nativePool "$native_pool" --arg fallbackMetadataUri "$fallback_metadata_uri" --argjson localUniswapV3 "$uniswap_json" --arg curveTokens "$curve_token_allocation" --arg graduationTokens "$graduation_token_allocation" --arg virtualTokens "$initial_virtual_token_reserve" --arg virtualBase "$initial_virtual_base_reserve" --arg threshold "$graduation_threshold_base" --arg initialPrice "$initial_base_per_token_x18" --argjson poolFee "$pool_fee_pips" --arg tickLower "$tick_lower" --arg tickUpper "$tick_upper" --arg minimumUse "$minimum_use_bps" --arg maximumDeviation "$maximum_price_deviation_bps" --arg twapWindow "$twap_window_seconds" --arg maximumConversionImpact "$maximum_conversion_price_impact_bps" --arg maximumTickDeviation "$maximum_conversion_tick_deviation" '{
    schemaVersion: 5,
    environment: $environment,
    chainId: $chainId,
    deploymentBlock: $blockNumber,
    gitCommit: $gitCommit,
    deployer: $deployer,
    contracts: {
      baseAsset: $base,
      wrappedNative: $weth,
      rewardAssets: [$nvda, $spy, $ethReward],
      conversionRouter: $router,
      factory: $factory,
      launchDeployer: $launchDeployer,
      marketFactory: $marketFactory,
      atomicLaunchCoordinator: $coordinator,
      daoToken: $rdao,
      governor: $governor,
      timelock: $timelock,
      guardian: $deployer,
      protocolFeeRouter: $feeRouter,
      nativeFeeConverter: $nativeConverter,
      nativeConversionPool: $nativePool,
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
    ipfsMetadata: {
      standard: "ERC-1046",
      cidVersion: 1,
      kuboVersion: "0.42.0",
      localPolicy: "pinned-no-fetch",
      remotePinRequiredForTestnet: true,
      fallbackMetadataUri: $fallbackMetadataUri
    },
    dao: {
      tokenName: "Robyn DAO",
      tokenSymbol: "RDAO",
      fixedSupply: "1000000000000000000000000000",
      allocation: [
        {account: $deployer, shareBps: 8000, purpose: "controlled-devnet-contributor"},
        {account: $timelock, shareBps: 2000, purpose: "dao-treasury-reserve"}
      ],
      feePolicy: {basketBps: 5000, creatorBps: 2500, daoRewardsBps: 2000, treasuryBps: 500},
      creatorRewardsAccounting: "per-token-v2",
      governance: {votingDelaySeconds: 86400, votingPeriodSeconds: 259200, timelockSeconds: 172800, quorumBps: 1000, proposalThresholdBps: 100},
      conversion: {twapWindowSeconds: ($twapWindow | tonumber), maximumPriceImpactBps: ($maximumConversionImpact | tonumber), maximumTickDeviation: ($maximumTickDeviation | tonumber)}
    },
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

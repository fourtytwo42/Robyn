#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
manifest="${ROBYN_TESTNET_MANIFEST:-$repo_root/deployments/46630.json}"
dex_manifest="${ROBYN_TESTNET_DEX_MANIFEST:-$repo_root/deployments/46630-uniswap-v3.json}"
rehearsal="${ROBYN_TESTNET_REHEARSAL:-false}"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

[[ "${ROBYN_TESTNET_BROADCAST:-false}" == "true" ]] || { echo "Set ROBYN_TESTNET_BROADCAST=true to authorize phase-two protocol deployment" >&2; exit 1; }
[[ "$(cast chain-id --rpc-url "$rpc_url")" == "46630" ]] || { echo "Refusing deployment outside chain 46630" >&2; exit 1; }
[[ -f "$dex_manifest" ]] || { echo "A verified chain-46630 DEX manifest is required" >&2; exit 1; }
ROBYN_TESTNET_RPC_URL="$rpc_url" scripts/verify-testnet-uniswap-v3.sh "$dex_manifest" >/dev/null

wallet_args=()
if [[ "$rehearsal" == "true" ]]; then
  [[ "${ROBYN_ALLOW_UNLOCKED_REHEARSAL:-false}" == "true" && "$rpc_url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]] || { echo "Unlocked rehearsal requires an explicitly allowed loopback RPC" >&2; exit 1; }
  deployer="$(cast rpc eth_accounts --rpc-url "$rpc_url" | jq -er '.[0]')"
  wallet_args=(--from "$deployer" --unlocked)
else
  keystore="${ROBYN_TESTNET_KEYSTORE:-${ROBYN_KEYSTORE:-}}"
  password_file="${ROBYN_TESTNET_PASSWORD_FILE:-${ROBYN_PASSWORD_FILE:-}}"
  [[ -f "$keystore" && -f "$password_file" ]] || { echo "Readable testnet keystore and password files are required" >&2; exit 1; }
  [[ -z "$(git status --porcelain)" && "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "Real testnet deployment requires clean exact origin/main" >&2; exit 1; }
  deployer="$(cast wallet address --keystore "$keystore" --password-file "$password_file")"
  wallet_args=(--keystore "$keystore" --password-file "$password_file")
fi

forge build --root packages/contracts >/dev/null
deploy_contract() {
  local contract="$1"; shift
  local command=(forge create "$contract" --root packages/contracts --rpc-url "$rpc_url" "${wallet_args[@]}" --broadcast --json)
  [[ "$#" -eq 0 ]] || command+=(--constructor-args "$@")
  "${command[@]}" | jq -er '.deployedTo'
}
send_transaction() {
  cast send --rpc-url "$rpc_url" "${wallet_args[@]}" --json "$@" | jq -e '.status == "0x1" or .status == 1' >/dev/null
}

base="$(deploy_contract src/testnet/TestnetMockERC20.sol:TestnetMockERC20 "Testnet Mock USD" "tmUSD" "$deployer" "10000000000000000000000")"
nvda="$(deploy_contract src/testnet/TestnetMockERC20.sol:TestnetMockERC20 "Testnet Mock NVIDIA" "tmNVDA" "$deployer" "0")"
spy="$(deploy_contract src/testnet/TestnetMockERC20.sol:TestnetMockERC20 "Testnet Mock S&P 500" "tmSPY" "$deployer" "0")"
eth_reward="$(deploy_contract src/testnet/TestnetMockERC20.sol:TestnetMockERC20 "Testnet Mock Ether" "tmETH" "$deployer" "0")"
router="$(deploy_contract src/testnet/TestnetConversionRouter.sol:TestnetConversionRouter "$deployer")"
launch_deployer="$(deploy_contract src/RobynLaunchDeployerV2.sol:RobynLaunchDeployerV2)"
factory="$(deploy_contract src/RobynLaunchFactoryV2.sol:RobynLaunchFactoryV2 "$base" "$router" "$launch_deployer" "1000000000000000000" "86400")"

uniswap_factory="$(jq -er '.contracts.factory' "$dex_manifest")"
position_manager="$(jq -er '.contracts.positionManager' "$dex_manifest")"
quoter="$(jq -er '.contracts.quoterV2' "$dex_manifest")"
swap_router="$(jq -er '.contracts.swapRouter02' "$dex_manifest")"
wrapped_native="$(jq -er '.contracts.weth9' "$dex_manifest")"
curve_tokens="800000000000000000000000000"
graduation_tokens="200000000000000000000000000"
virtual_tokens="1066666666666666666666666666"
virtual_base="2166666666666666666667"
threshold="6500000000000000000000"
initial_price="32500000000000"
pool_fee="10000"
tick_lower="-887200"
tick_upper="887200"
minimum_use="9900"
maximum_deviation="100"
twap_window="60"
maximum_conversion_impact="100"
maximum_tick_deviation="100"

# A small, explicitly test-only base/WETH pool backs asynchronous fee conversion.
native_base_liquidity="100000000000000000000"
native_wrapped_liquidity="1000000000000000"
send_transaction "$wrapped_native" --value "$native_wrapped_liquidity" 'deposit()'
send_transaction "$base" 'mint(address,uint256)' "$deployer" "$native_base_liquidity"
send_transaction "$base" 'approve(address,uint256)' "$position_manager" "$native_base_liquidity"
send_transaction "$wrapped_native" 'approve(address,uint256)' "$position_manager" "$native_wrapped_liquidity"
if [[ "${base,,}" < "${wrapped_native,,}" ]]; then
  native_token0="$base"; native_token1="$wrapped_native"; native_sqrt_price="250541448375047931186413801"
  native_amount0="$native_base_liquidity"; native_amount1="$native_wrapped_liquidity"
  native_minimum0="99000000000000000000"; native_minimum1="990000000000000"
else
  native_token0="$wrapped_native"; native_token1="$base"; native_sqrt_price="25054144837504793118641380156960"
  native_amount0="$native_wrapped_liquidity"; native_amount1="$native_base_liquidity"
  native_minimum0="990000000000000"; native_minimum1="99000000000000000000"
fi
send_transaction "$uniswap_factory" 'createPool(address,address,uint24)' "$base" "$wrapped_native" "$pool_fee"
native_pool="$(cast call "$uniswap_factory" 'getPool(address,address,uint24)(address)' "$base" "$wrapped_native" "$pool_fee" --rpc-url "$rpc_url")"
send_transaction "$native_pool" 'initialize(uint160)' "$native_sqrt_price"
native_deadline="$(($(date +%s) + 3600))"
send_transaction "$position_manager" 'mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))' "($native_token0,$native_token1,$pool_fee,$tick_lower,$tick_upper,$native_amount0,$native_amount1,$native_minimum0,$native_minimum1,$deployer,$native_deadline)"

guardian="${ROBYN_GUARDIAN_ADDRESS:-$deployer}"
timelock="$(deploy_contract ../../node_modules/@openzeppelin/contracts/governance/TimelockController.sol:TimelockController "172800" "[]" "[]" "$deployer")"

# Real broadcasts require an explicit, reviewable fixed-supply allocation manifest.
# Rehearsals use a deterministic local-only allocation so CI and isolated Anvil
# checks do not need a file containing production wallet addresses.
allocation_manifest="${ROBYN_RDAO_ALLOCATION_MANIFEST:-}"
if [[ "$rehearsal" == "true" ]]; then
  allocation_json="$(jq -cn --arg deployer "$deployer" --arg timelock "$timelock" '{schemaVersion:1,allocations:[{account:$deployer,shareBps:8000,purpose:"rehearsal-contributor"},{account:$timelock,shareBps:2000,purpose:"dao-treasury-reserve"}]}')"
  allocation_hash="$(printf '%s' "$allocation_json" | sha256sum | awk '{print $1}')"
else
  [[ -n "$allocation_manifest" && -f "$allocation_manifest" ]] || { echo "ROBYN_RDAO_ALLOCATION_MANIFEST must name a readable allocation manifest" >&2; exit 1; }
  jq -e '
    .schemaVersion == 1 and
    (.allocations | type == "array" and length > 1) and
    (([.allocations[].account | ascii_downcase] | unique | length) == (.allocations | length)) and
    ([.allocations[].shareBps] | add == 10000) and
    (all(.allocations[];
      (.shareBps | type == "number" and . > 0 and . <= 10000) and
      (.purpose | type == "string" and length > 0) and
      ((.account == "timelock") or (.account == "deployer") or (.account | test("^0x[0-9a-fA-F]{40}$")))
    )) and
    (any(.allocations[]; .account == "timelock" and .purpose == "dao-treasury-reserve"))
  ' "$allocation_manifest" >/dev/null || { echo "Invalid RDAO allocation manifest: shares must total 10000 bps and include the timelock reserve" >&2; exit 1; }
  allocation_json="$(jq -c --arg deployer "$deployer" --arg timelock "$timelock" '.allocations |= map(.account = (if .account == "deployer" then $deployer elif .account == "timelock" then $timelock else .account end))' "$allocation_manifest")"
  allocation_hash="$(sha256sum "$allocation_manifest" | awk '{print $1}')"
fi

allocation_addresses="$(jq -r '[.allocations[].account] | "[" + join(",") + "]"' <<<"$allocation_json")"
allocation_amounts="["
while IFS= read -r share_bps; do
  allocation_amounts+="$(cast to-wei "$((share_bps * 100000))" ether),"
done < <(jq -r '.allocations[].shareBps' <<<"$allocation_json")
allocation_amounts="${allocation_amounts%,}]"
rdao="$(deploy_contract src/dao/RobynDaoToken.sol:RobynDaoToken "$allocation_addresses" "$allocation_amounts")"
governor="$(deploy_contract src/dao/RobynGovernor.sol:RobynGovernor "$rdao" "$timelock")"
fee_router="$(deploy_contract src/dao/RobynProtocolFeeRouterV2.sol:RobynProtocolFeeRouterV2 "$base" "$rdao" "$timelock" "$guardian")"
native_converter="$(deploy_contract src/uniswap/UniswapV3NativeFeeConverter.sol:UniswapV3NativeFeeConverter "$uniswap_factory" "$swap_router" "$quoter" "$base" "$wrapped_native" "$pool_fee" "$pool_fee" "$twap_window" "$maximum_conversion_impact" "$maximum_tick_deviation")"
adapter_deployer="$(deploy_contract src/uniswap/UniswapV3AdapterDeployer.sol:UniswapV3AdapterDeployer)"
market_deployer="$(deploy_contract src/uniswap/UniswapV3MarketDeployer.sol:UniswapV3MarketDeployer)"
market_factory="$(deploy_contract src/uniswap/UniswapV3MarketFactoryV3.sol:UniswapV3MarketFactoryV3 "$base" "$factory" "$adapter_deployer" "$market_deployer" "$fee_router" "($curve_tokens,$graduation_tokens,$virtual_tokens,$virtual_base,$threshold,100)" "($uniswap_factory,$position_manager,$swap_router,$quoter,$pool_fee,$tick_lower,$tick_upper,$initial_price,$minimum_use,$maximum_deviation)")"
coordinator="$(deploy_contract src/RobynDaoLaunchCoordinator.sol:RobynDaoLaunchCoordinator "$factory" "$market_factory" "$fee_router")"
send_transaction "$launch_deployer" 'bindController(address)' "$factory"
send_transaction "$adapter_deployer" 'bindController(address)' "$market_factory"
send_transaction "$market_deployer" 'bindController(address)' "$market_factory"
send_transaction "$factory" 'bindCoordinator(address)' "$coordinator"
send_transaction "$market_factory" 'bindCoordinator(address)' "$coordinator"
send_transaction "$fee_router" 'bindCoordinator(address)' "$coordinator"
send_transaction "$native_converter" 'bindFeeRouter(address)' "$fee_router"
send_transaction "$fee_router" 'setConverter(address)' "$native_converter"
send_transaction "$rdao" 'sealRewardExclusions(address[])' "[$timelock,$fee_router,$governor,$coordinator,$market_factory]"
send_transaction "$rdao" 'bindRewardDepositor(address)' "$fee_router"
proposer_role="$(cast call "$timelock" 'PROPOSER_ROLE()(bytes32)' --rpc-url "$rpc_url")"
canceller_role="$(cast call "$timelock" 'CANCELLER_ROLE()(bytes32)' --rpc-url "$rpc_url")"
executor_role="$(cast call "$timelock" 'EXECUTOR_ROLE()(bytes32)' --rpc-url "$rpc_url")"
admin_role="$(cast call "$timelock" 'DEFAULT_ADMIN_ROLE()(bytes32)' --rpc-url "$rpc_url")"
send_transaction "$timelock" 'grantRole(bytes32,address)' "$proposer_role" "$governor"
send_transaction "$timelock" 'grantRole(bytes32,address)' "$canceller_role" "$guardian"
send_transaction "$timelock" 'grantRole(bytes32,address)' "$executor_role" '0x0000000000000000000000000000000000000000'
send_transaction "$timelock" 'renounceRole(bytes32,address)' "$admin_role" "$deployer"

reward_liquidity="10000000000000000000000000"
send_transaction "$base" 'mint(address,uint256)' "$deployer" "$reward_liquidity"
for reward in "$nvda" "$spy" "$eth_reward"; do send_transaction "$reward" 'mint(address,uint256)' "$router" "$reward_liquidity"; done
send_transaction "$router" 'setRate(address,address,uint256)' "$base" "$nvda" "1000000000000000000"
send_transaction "$router" 'setRate(address,address,uint256)' "$base" "$spy" "2000000000000000000"
send_transaction "$router" 'setRate(address,address,uint256)' "$base" "$eth_reward" "3000000000000000000"
genesis_salt="$(cast keccak "robyn-chain-46630-genesis-$(git rev-parse HEAD)")"
send_transaction "$coordinator" 'createLaunch((string,string,address[],uint16[],bytes32))' "(\"Robyn Testnet Genesis\",\"tROBYN\",[$nvda,$spy,$eth_reward],[4000,4000,2000],$genesis_salt)"

launch_id="$(cast call "$factory" 'launchCount()(uint256)' --rpc-url "$rpc_url")"
token="$(cast call "$factory" 'launchTokenById(uint256)(address)' "$launch_id" --rpc-url "$rpc_url")"
vault="$(cast call "$factory" 'vaultByToken(address)(address)' "$token" --rpc-url "$rpc_url")"
market="$(cast call "$market_factory" 'marketByToken(address)(address)' "$token" --rpc-url "$rpc_url")"
adapter="$(cast call "$market_factory" 'adapterByToken(address)(address)' "$token" --rpc-url "$rpc_url")"
pool="$(cast call "$market" 'graduatedPool()(address)' --rpc-url "$rpc_url")"
locker="$(cast call "$market" 'positionLocker()(address)' --rpc-url "$rpc_url")"

block_number="$(cast block-number --rpc-url "$rpc_url")"
git_commit="$(git rev-parse HEAD)"
dex_hash="$(sha256sum "$dex_manifest" | awk '{print $1}')"
uniswap_json="$(jq '{factory:.contracts.factory,positionManager:.contracts.positionManager,quoter:.contracts.quoterV2,swapRouter:.contracts.swapRouter02,wrappedQuoteAsset:.contracts.weth9,provenance,runtimeCodeHashes:{factory:.runtimeCodeHashes.factory,positionManager:.runtimeCodeHashes.positionManager,quoter:.runtimeCodeHashes.quoterV2,swapRouter:.runtimeCodeHashes.swapRouter02,weth9:.runtimeCodeHashes.weth9}}' "$dex_manifest")"
mkdir -p "$(dirname "$manifest")"
tmp="$(mktemp "$(dirname "$manifest")/.46630.XXXXXX")"
jq -n --argjson chainId 46630 --argjson blockNumber "$block_number" --arg gitCommit "$git_commit" --arg deployer "$deployer" --arg guardian "$guardian" --arg dexHash "$dex_hash" --arg allocationHash "$allocation_hash" --arg base "$base" --arg weth "$wrapped_native" --arg nvda "$nvda" --arg spy "$spy" --arg ethReward "$eth_reward" --arg router "$router" --arg factory "$factory" --arg launchDeployer "$launch_deployer" --arg marketFactory "$market_factory" --arg coordinator "$coordinator" --arg adapterDeployer "$adapter_deployer" --arg marketDeployer "$market_deployer" --arg token "$token" --arg vault "$vault" --arg market "$market" --arg adapter "$adapter" --arg pool "$pool" --arg locker "$locker" --arg timelock "$timelock" --arg governor "$governor" --arg rdao "$rdao" --arg feeRouter "$fee_router" --arg nativeConverter "$native_converter" --arg nativePool "$native_pool" --argjson allocation "$allocation_json" --argjson uniswap "$uniswap_json" --arg curveTokens "$curve_tokens" --arg graduationTokens "$graduation_tokens" --arg virtualTokens "$virtual_tokens" --arg virtualBase "$virtual_base" --arg threshold "$threshold" --arg initialPrice "$initial_price" --argjson poolFee "$pool_fee" '{schemaVersion:4,environment:"robinhood-testnet",chainId:$chainId,deploymentBlock:$blockNumber,gitCommit:$gitCommit,gitSha:$gitCommit,deployer:$deployer,assetStrategy:"project-owned-testnet-mocks",mockOnly:true,dexProvenanceManifestSha256:$dexHash,contracts:{baseAsset:$base,wrappedNative:$weth,rewardAssets:[$nvda,$spy,$ethReward],conversionRouter:$router,factory:$factory,launchDeployer:$launchDeployer,marketFactory:$marketFactory,atomicLaunchCoordinator:$coordinator,daoToken:$rdao,governor:$governor,timelock:$timelock,guardian:$guardian,protocolFeeRouter:$feeRouter,nativeFeeConverter:$nativeConverter,nativeConversionPool:$nativePool,adapterDeployer:$adapterDeployer,marketDeployer:$marketDeployer,genesisToken:$token,genesisVault:$vault,genesisMarket:$market,genesisGraduationAdapter:$adapter,genesisPositionLocker:$locker,genesisGraduatedPool:$pool},localUniswapV3:$uniswap,dao:{tokenName:"Robyn DAO",tokenSymbol:"RDAO",fixedSupply:"1000000000000000000000000000",initialAllocationManifestSha256:$allocationHash,allocation:$allocation.allocations,feePolicy:{basketBps:5000,creatorBps:2500,daoRewardsBps:2000,treasuryBps:500},creatorRewardsAccounting:"per-token-v2",governance:{votingDelaySeconds:86400,votingPeriodSeconds:259200,timelockSeconds:172800,quorumBps:1000,proposalThresholdBps:100},conversion:{twapWindowSeconds:60,maximumPriceImpactBps:100,maximumTickDeviation:100}},genesisBasket:[{symbol:"tmNVDA",weightBps:4000},{symbol:"tmSPY",weightBps:4000},{symbol:"tmETH",weightBps:2000}],market:{type:"uniswap-v3-bonding-curve-v1",liquidityVenue:"robyn-controlled-uniswap-v3-testnet",feeBps:100,poolFeePips:$poolFee,tickLower:-887200,tickUpper:887200,initialBasePerTokenX18:$initialPrice,minimumUseBps:9900,maximumPriceDeviationBps:100,curveTokenAllocation:$curveTokens,graduationTokenAllocation:$graduationTokens,initialVirtualTokenReserve:$virtualTokens,initialVirtualBaseReserve:$virtualBase,graduationThresholdBase:$threshold}}' >"$tmp"
mv "$tmp" "$manifest"
ROBYN_TESTNET_RPC_URL="$rpc_url" scripts/verify-testnet-deployment.sh "$manifest"
echo "Wrote $manifest"

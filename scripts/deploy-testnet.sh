#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
manifest="${ROBYN_TESTNET_MANIFEST:-$repo_root/deployments/46630.json}"
dex_manifest="${ROBYN_TESTNET_DEX_MANIFEST:-$repo_root/deployments/46630-uniswap-v3.json}"
asset_catalog="${ROBYN_TESTNET_ASSET_CATALOG:-$repo_root/config/assets/robinhood-testnet-curated.json}"
rehearsal="${ROBYN_TESTNET_REHEARSAL:-false}"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

[[ "${ROBYN_TESTNET_BROADCAST:-false}" == "true" ]] || { echo "Set ROBYN_TESTNET_BROADCAST=true to authorize phase-two protocol deployment" >&2; exit 1; }
[[ "$(cast chain-id --rpc-url "$rpc_url")" == "46630" ]] || { echo "Refusing deployment outside chain 46630" >&2; exit 1; }
[[ -f "$dex_manifest" ]] || { echo "A verified chain-46630 DEX manifest is required" >&2; exit 1; }
[[ "$(jq -r '.chainId' "$asset_catalog")" == "46630" && "$(jq '.assets | length' "$asset_catalog")" == "23" ]] || { echo "The reviewed 23-stock testnet catalog is required" >&2; exit 1; }
ROBYN_TESTNET_ASSET_CATALOG="$asset_catalog" scripts/check-robinhood-testnet-asset-provenance.sh >/dev/null
ROBYN_TESTNET_RPC_URL="$rpc_url" scripts/verify-testnet-uniswap-v3.sh "$dex_manifest" >/dev/null

wallet_args=()
if [[ "$rehearsal" == "true" ]]; then
  [[ "${ROBYN_ALLOW_UNLOCKED_REHEARSAL:-false}" == "true" && "$rpc_url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]] || { echo "Unlocked rehearsal requires an explicitly allowed loopback RPC" >&2; exit 1; }
  deployer="$(cast rpc eth_accounts --rpc-url "$rpc_url" | jq -er '.[0]')"
  wallet_args=(--from "$deployer" --unlocked)
else
  scripts/check-testnet-external-inputs.sh >/dev/null
  keystore="${ROBYN_TESTNET_KEYSTORE:-${ROBYN_KEYSTORE:-}}"
  password_file="${ROBYN_TESTNET_PASSWORD_FILE:-${ROBYN_PASSWORD_FILE:-}}"
  [[ -f "$keystore" && -f "$password_file" ]] || { echo "Readable testnet keystore and password files are required" >&2; exit 1; }
  [[ -z "$(git status --porcelain)" && "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "Real testnet deployment requires clean exact origin/main" >&2; exit 1; }
  deployer="$(cast wallet address --keystore "$keystore" --password-file "$password_file")"
  wallet_args=(--keystore "$keystore" --password-file "$password_file")
  if [[ "${ROBYN_TESTNET_ALLOW_LOCAL_PIN_ONLY:-false}" != "true" ]]; then
    [[ -n "${ROBYN_REMOTE_PIN_URL:-}" && -n "${ROBYN_REMOTE_PIN_TOKEN:-}" ]] || {
      echo "Protected testnet deployment requires configured remote IPFS pinning or an explicit local-only override" >&2
      exit 1
    }
  fi
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

uniswap_factory="$(jq -er '.contracts.factory' "$dex_manifest")"
position_manager="$(jq -er '.contracts.positionManager' "$dex_manifest")"
quoter="$(jq -er '.contracts.quoterV2' "$dex_manifest")"
swap_router="$(jq -er '.contracts.swapRouter02' "$dex_manifest")"
wrapped_native="$(jq -er '.contracts.weth9' "$dex_manifest")"
base="$(deploy_contract src/testnet/TestnetMockERC20.sol:TestnetMockERC20 "Robyn Testnet Mock USD" "tmUSD" "$deployer" "1000000000000000000000000")"
declare -A reward_by_symbol=()
while IFS=$'\t' read -r symbol mock_symbol name; do
  reward_by_symbol["$symbol"]="$(deploy_contract src/testnet/TestnetMockERC20.sol:TestnetMockERC20 "Robyn Testnet Mock $name" "$mock_symbol" "$deployer" "0")"
done < <(jq -r '.assets[] | [.symbol,.mockSymbol,.name] | @tsv' "$asset_catalog")
nvda="${reward_by_symbol[NVDA]}"
spy="${reward_by_symbol[SPY]}"
aapl="${reward_by_symbol[AAPL]}"
eth_reward="$aapl" # Backward-compatible jq input; replaced by the v6 catalog below.
router="$(deploy_contract src/testnet/TestnetAssetConversionRouter.sol:TestnetAssetConversionRouter "$deployer" "$uniswap_factory" "$swap_router" "$quoter")"
launch_deployer="$(deploy_contract src/RobynLaunchDeployerV2.sol:RobynLaunchDeployerV2)"
factory="$(deploy_contract src/RobynLaunchFactoryV3.sol:RobynLaunchFactoryV3 "$base" "$router" "$launch_deployer" "1000000000000000000" "86400")"

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
send_transaction "$native_pool" 'increaseObservationCardinalityNext(uint16)' '64'
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
  "$(dirname "$0")/validate-rdao-allocation.sh" "$allocation_manifest" >/dev/null
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
coordinator="$(deploy_contract src/RobynDaoLaunchCoordinatorV5.sol:RobynDaoLaunchCoordinatorV5 "$factory" "$market_factory" "$fee_router")"
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

reward_liquidity="1000000000000000000000000000"
send_transaction "$base" 'mint(address,uint256)' "$deployer" "$reward_liquidity"
asset_catalog_json="$(jq -c '.assets' "$asset_catalog")"
reward_addresses_json='[]'
while IFS=$'\t' read -r symbol rate_x18; do
  reward="${reward_by_symbol[$symbol]}"
  send_transaction "$reward" 'mint(address,uint256)' "$router" "$reward_liquidity"
  send_transaction "$router" 'setFixedRoute(address,address,uint256)' "$base" "$reward" "$rate_x18"
  asset_catalog_json="$(jq -c --arg symbol "$symbol" --arg address "$reward" 'map(if .symbol==$symbol then . + {address:$address,chainId:46630,decimals:18,verification:"robyn-testnet-mock",mockOnly:true,route:{kind:"fixed-testnet",ready:true}} else . end)' <<<"$asset_catalog_json")"
  reward_addresses_json="$(jq -c --arg address "$reward" '. + [$address]' <<<"$reward_addresses_json")"
done < <(jq -r '.assets[] | [.symbol,.fixedRateX18] | @tsv' "$asset_catalog")
send_transaction "$router" 'setUniswapRoute(address,address,uint24,uint128,uint32,int24)' "$base" "$wrapped_native" "$pool_fee" "1" "$twap_window" "$maximum_tick_deviation"
if [[ "$rehearsal" == "true" ]]; then
  cast rpc evm_increaseTime "$((twap_window + 1))" --rpc-url "$rpc_url" >/dev/null
  cast rpc evm_mine --rpc-url "$rpc_url" >/dev/null
else
  sleep "$((twap_window + 1))"
  send_transaction "$base" 'approve(address,uint256)' "$router" "0"
fi
[[ "$(cast call "$router" 'isRouteReady(address,address)(bool)' "$base" "$wrapped_native" --rpc-url "$rpc_url")" == "true" ]] || {
  echo "The WETH conversion route did not become TWAP-ready" >&2
  exit 1
}
asset_catalog_json="$(jq -c --arg address "$wrapped_native" '. + [{symbol:"WETH",mockSymbol:"WETH",name:"Wrapped Ether",category:"crypto",logoUrl:"/assets/brand/robyn-mark.png",mainnetAddress:null,referencePriceUsd:null,fixedRateX18:null,address:$address,chainId:46630,decimals:18,verification:"robyn-controlled-testnet-dex",mockOnly:true,route:{kind:"uniswap-v3",ready:false}}]' <<<"$asset_catalog_json")"
reward_addresses_json="$(jq -c --arg address "$wrapped_native" '. + [$address]' <<<"$reward_addresses_json")"
genesis_salt="$(cast keccak "robyn-chain-46630-genesis-$(git rev-parse HEAD)")"
fallback_metadata_uri="ipfs://bafkreibys2cv4ijpoedcl7qdbi5u66wuwedwg3lsc6pios3wcyaoyz7cau"
launch_receipt="$(cast send --rpc-url "$rpc_url" "${wallet_args[@]}" --json "$coordinator" 'createLaunch((string,string,address[],uint16[],string,bytes32))' "(\"Robyn Testnet Genesis\",\"tROBYN\",[$nvda,$spy,$aapl],[4000,4000,2000],\"$fallback_metadata_uri\",$genesis_salt)")"
[[ "$(jq -r '.status' <<<"$launch_receipt")" == "0x1" || "$(jq -r '.status' <<<"$launch_receipt")" == "1" ]] || {
  echo "Atomic genesis launch transaction failed" >&2
  exit 1
}
launch_topic="$(cast keccak 'AtomicLaunchCreated(uint256,address,address,address,address,address,address,address,bytes32,bytes32,bytes32)')"
launch_log="$(jq -cer --arg topic "${launch_topic,,}" '.logs[] | select((.topics[0] | ascii_downcase) == $topic)' <<<"$launch_receipt")"
launch_id="$(cast to-dec "$(jq -r '.topics[1]' <<<"$launch_log")")"
token_topic="$(jq -r '.topics[3]' <<<"$launch_log")"
token="0x${token_topic:26:40}"
launch_data="$(jq -r '.data' <<<"$launch_log")"
launch_words="${launch_data#0x}"
event_address() {
  local word_index="$1"
  local offset=$((word_index * 64 + 24))
  printf '0x%s\n' "${launch_words:$offset:40}"
}
vault="$(event_address 0)"
market="$(event_address 1)"
adapter="$(event_address 2)"
pool="$(event_address 3)"
locker="$(event_address 4)"
[[ "$(cast call "$factory" 'launchTokenById(uint256)(address)' "$launch_id" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]')" == "${token,,}" ]] || {
  echo "Receipt-derived genesis identity does not match factory state" >&2
  exit 1
}

block_number="$(cast block-number --rpc-url "$rpc_url")"
git_commit="$(git rev-parse HEAD)"
dex_hash="$(sha256sum "$dex_manifest" | awk '{print $1}')"
uniswap_json="$(jq '{factory:.contracts.factory,positionManager:.contracts.positionManager,quoter:.contracts.quoterV2,swapRouter:.contracts.swapRouter02,wrappedQuoteAsset:.contracts.weth9,provenance,runtimeCodeHashes:{factory:.runtimeCodeHashes.factory,positionManager:.runtimeCodeHashes.positionManager,quoter:.runtimeCodeHashes.quoterV2,swapRouter:.runtimeCodeHashes.swapRouter02,weth9:.runtimeCodeHashes.weth9}}' "$dex_manifest")"
mkdir -p "$(dirname "$manifest")"
tmp="$(mktemp "$(dirname "$manifest")/.46630.XXXXXX")"
jq -n --argjson chainId 46630 --argjson blockNumber "$block_number" --arg gitCommit "$git_commit" --arg deployer "$deployer" --arg guardian "$guardian" --arg dexHash "$dex_hash" --arg allocationHash "$allocation_hash" --arg base "$base" --arg weth "$wrapped_native" --arg nvda "$nvda" --arg spy "$spy" --arg ethReward "$eth_reward" --arg router "$router" --arg factory "$factory" --arg launchDeployer "$launch_deployer" --arg marketFactory "$market_factory" --arg coordinator "$coordinator" --arg adapterDeployer "$adapter_deployer" --arg marketDeployer "$market_deployer" --arg token "$token" --arg vault "$vault" --arg market "$market" --arg adapter "$adapter" --arg pool "$pool" --arg locker "$locker" --arg timelock "$timelock" --arg governor "$governor" --arg rdao "$rdao" --arg feeRouter "$fee_router" --arg nativeConverter "$native_converter" --arg nativePool "$native_pool" --argjson allocation "$allocation_json" --argjson uniswap "$uniswap_json" --arg curveTokens "$curve_tokens" --arg graduationTokens "$graduation_tokens" --arg virtualTokens "$virtual_tokens" --arg virtualBase "$virtual_base" --arg threshold "$threshold" --arg initialPrice "$initial_price" --argjson poolFee "$pool_fee" '{schemaVersion:4,environment:"robinhood-testnet",chainId:$chainId,deploymentBlock:$blockNumber,gitCommit:$gitCommit,gitSha:$gitCommit,deployer:$deployer,assetStrategy:"project-owned-testnet-mocks",mockOnly:true,dexProvenanceManifestSha256:$dexHash,contracts:{baseAsset:$base,wrappedNative:$weth,rewardAssets:[$nvda,$spy,$ethReward],conversionRouter:$router,factory:$factory,launchDeployer:$launchDeployer,marketFactory:$marketFactory,atomicLaunchCoordinator:$coordinator,daoToken:$rdao,governor:$governor,timelock:$timelock,guardian:$guardian,protocolFeeRouter:$feeRouter,nativeFeeConverter:$nativeConverter,nativeConversionPool:$nativePool,adapterDeployer:$adapterDeployer,marketDeployer:$marketDeployer,genesisToken:$token,genesisVault:$vault,genesisMarket:$market,genesisGraduationAdapter:$adapter,genesisPositionLocker:$locker,genesisGraduatedPool:$pool},localUniswapV3:$uniswap,dao:{tokenName:"Robyn DAO",tokenSymbol:"RDAO",fixedSupply:"1000000000000000000000000000",initialAllocationManifestSha256:$allocationHash,allocation:$allocation.allocations,feePolicy:{basketBps:5000,creatorBps:2500,daoRewardsBps:2000,treasuryBps:500},creatorRewardsAccounting:"per-token-v2",governance:{votingDelaySeconds:86400,votingPeriodSeconds:259200,timelockSeconds:172800,quorumBps:1000,proposalThresholdBps:100},conversion:{twapWindowSeconds:60,maximumPriceImpactBps:100,maximumTickDeviation:100}},genesisBasket:[{symbol:"tmNVDA",weightBps:4000},{symbol:"tmSPY",weightBps:4000},{symbol:"tmETH",weightBps:2000}],market:{type:"uniswap-v3-bonding-curve-v1",liquidityVenue:"robyn-controlled-uniswap-v3-testnet",feeBps:100,poolFeePips:$poolFee,tickLower:-887200,tickUpper:887200,initialBasePerTokenX18:$initialPrice,minimumUseBps:9900,maximumPriceDeviationBps:100,curveTokenAllocation:$curveTokens,graduationTokenAllocation:$graduationTokens,initialVirtualTokenReserve:$virtualTokens,initialVirtualBaseReserve:$virtualBase,graduationThresholdBase:$threshold}}' >"$tmp"
ipfs_tmp="${tmp}.ipfs"
catalog_tmp="${tmp}.catalog"
jq \
  --argjson assetCatalog "$asset_catalog_json" \
  --argjson rewardAssets "$reward_addresses_json" \
  --arg snapshotAt "$(jq -r '.snapshotAt' "$asset_catalog")" \
  --arg disclosure "$(jq -r '.disclosure' "$asset_catalog")" \
  '.schemaVersion=6
   | .contracts.rewardAssets=$rewardAssets
   | .contracts.routeRegistry=.contracts.conversionRouter
   | .assetCatalog={schemaVersion:1,snapshotAt:$snapshotAt,disclosure:$disclosure,assets:$assetCatalog}
   | .genesisBasket=[{symbol:"tmNVDA",weightBps:4000},{symbol:"tmSPY",weightBps:4000},{symbol:"tmAAPL",weightBps:2000}]' \
  "$tmp" >"$catalog_tmp"
mv "$catalog_tmp" "$tmp"
jq --arg fallbackMetadataUri "$fallback_metadata_uri" \
  --argjson remotePinRequired "$([[ "${ROBYN_TESTNET_ALLOW_LOCAL_PIN_ONLY:-false}" == "true" ]] && echo false || echo true)" '
  .schemaVersion = 6
  | .ipfsMetadata = {
      standard: "ERC-1046",
      cidVersion: 1,
      kuboVersion: "0.42.0",
      localPolicy: "pinned-no-fetch",
      remotePinRequired: $remotePinRequired,
      fallbackMetadataUri: $fallbackMetadataUri
    }
' "$tmp" >"$ipfs_tmp"
mv "$ipfs_tmp" "$manifest"
rm -f "$tmp"
ROBYN_TESTNET_RPC_URL="$rpc_url" scripts/verify-testnet-deployment.sh "$manifest"
echo "Wrote $manifest"

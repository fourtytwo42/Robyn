#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
venue_manifest="${ROBYN_TESTNET_V4_MANIFEST:-$repo_root/deployments/46630-uniswap-v4-shared.json}"
legacy_asset_manifest="${ROBYN_TESTNET_V3_ASSET_MANIFEST:-$repo_root/deployments/46630.json}"
reuse_routes_manifest="${ROBYN_TESTNET_V4_REUSE_ROUTES_MANIFEST:-}"
output="${ROBYN_TESTNET_V4_PROTOCOL_MANIFEST:-$repo_root/deployments/46630-v4.json}"
rehearsal="${ROBYN_TESTNET_REHEARSAL:-false}"
create2_deployer="0x4e59b44847b379578588920cA78FbF26c0B4956C"
expected_deployer="0xecc5d6d032ADc9ca9E0F4042128067b8366da17A"
zero="0x0000000000000000000000000000000000000000"
zero_bytes32="0x0000000000000000000000000000000000000000000000000000000000000000"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"
source "$repo_root/scripts/lib/transaction-nonce.sh"

[[ "${ROBYN_TESTNET_V4_PROTOCOL_BROADCAST:-false}" == "true" ]] || {
  echo "Set ROBYN_TESTNET_V4_PROTOCOL_BROADCAST=true to authorize v4 protocol deployment" >&2
  exit 1
}
[[ "$(cast chain-id --rpc-url "$rpc_url")" == "46630" ]] || {
  echo "Refusing v4 protocol deployment outside chain 46630" >&2
  exit 1
}
[[ -f "$venue_manifest" ]] || { echo "The reviewed shared-v4 manifest is required" >&2; exit 1; }
[[ -f "$legacy_asset_manifest" ]] || {
  echo "The reviewed predecessor manifest is required for WETH identity and catalog metadata" >&2
  exit 1
}
[[ -z "$reuse_routes_manifest" ]] || {
  echo "Schema-12 requires fresh route contracts and forbids route reuse" >&2
  exit 1
}

wallet_args=()
if [[ "$rehearsal" == "true" ]]; then
  [[ "${ROBYN_ALLOW_UNLOCKED_REHEARSAL:-false}" == "true" &&
     "$rpc_url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]] || {
    echo "Unlocked signing is restricted to an explicitly allowed loopback rehearsal" >&2
    exit 1
  }
  deployer="$(
    if [[ -n "${ROBYN_TESTNET_REHEARSAL_DEPLOYER:-}" ]]; then
      cast to-check-sum-address "$ROBYN_TESTNET_REHEARSAL_DEPLOYER"
    else
      cast rpc eth_accounts --rpc-url "$rpc_url" | jq -er '.[0]'
    fi
  )"
  wallet_args=(--from "$deployer" --unlocked)
else
  keystore="${ROBYN_TESTNET_KEYSTORE:-${ROBYN_KEYSTORE:-}}"
  password_file="${ROBYN_TESTNET_PASSWORD_FILE:-${ROBYN_PASSWORD_FILE:-}}"
  [[ -f "$keystore" && -f "$password_file" ]] || {
    echo "Readable testnet keystore and password files are required" >&2
    exit 1
  }
  git fetch origin main >/dev/null
  [[ -z "$(git status --porcelain)" &&
     "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || {
    echo "Real v4 deployment requires a clean exact origin/main commit" >&2
    exit 1
  }
  [[ "${ROBYN_TESTNET_V4_PROTOCOL_CONFIRM_CHAIN:-}" == "46630" ]] || {
    echo "Set ROBYN_TESTNET_V4_PROTOCOL_CONFIRM_CHAIN=46630 for explicit confirmation" >&2
    exit 1
  }
  gas_evidence="${ROBYN_TESTNET_V4_GAS_EVIDENCE:-}"
  [[ -f "$gas_evidence" && "$(jq -r '.chainId' "$gas_evidence")" == "46630" &&
     "$(jq -r '.headroomBps' "$gas_evidence")" -ge 2500 &&
     "$(jq -r '.sufficientBalance' "$gas_evidence")" == "true" ]] || {
    echo "Reviewed chain-46630 gas evidence with 25% headroom is required" >&2
    exit 1
  }
  deployer="$(cast wallet address --keystore "$keystore" --password-file "$password_file")"
  [[ "${deployer,,}" == "${expected_deployer,,}" ]] || {
    echo "The encrypted project deployer address does not match the reviewed wallet" >&2
    exit 1
  }
  wallet_args=(--keystore "$keystore" --password-file "$password_file")
fi

highest_observed_nonce=0
for _ in {1..5}; do
  for nonce_block in latest pending; do
    observed_nonce="$(cast nonce "$deployer" --block "$nonce_block" --rpc-url "$rpc_url")"
    [[ "$observed_nonce" =~ ^[0-9]+$ ]] || {
      echo "RPC returned an invalid $nonce_block transaction nonce" >&2
      exit 1
    }
    if ((observed_nonce > highest_observed_nonce)); then
      highest_observed_nonce="$observed_nonce"
    fi
  done
  sleep 0.2
done
transaction_nonce_initialize "$highest_observed_nonce"

ROBYN_TESTNET_RPC_URL="$rpc_url" ROBYN_V4_ALLOW_PENDING=true \
  scripts/verify-testnet-uniswap-v4.sh "$venue_manifest" >/dev/null
forge build --root packages/contracts >/dev/null

declare -A addresses txs
configuration_transaction_log="$(mktemp)"
mock_route_log="$(mktemp)"
route_safety_log="$(mktemp)"
cleanup() {
  rm -f -- "$configuration_transaction_log" "$mock_route_log" "$route_safety_log"
}
trap cleanup EXIT
deploy_contract() {
  local key="$1" contract="$2"
  shift 2
  transaction_nonce_allocate
  local nonce="$TRANSACTION_NONCE_ALLOCATED"
  local command=(forge create "$contract" --root packages/contracts --rpc-url "$rpc_url" "${wallet_args[@]}" --nonce "$nonce" --broadcast --json)
  [[ "$#" -eq 0 ]] || command+=(--constructor-args "$@")
  local receipt
  receipt="$("${command[@]}")"
  addresses[$key]="$(jq -er '.deployedTo' <<<"$receipt")"
  txs[$key]="$(jq -er '.transactionHash' <<<"$receipt")"
  [[ "$(cast code "${addresses[$key]}" --rpc-url "$rpc_url")" != "0x" ]] || {
    echo "No runtime code after deploying $key" >&2
    exit 1
  }
}
send_transaction() {
  transaction_nonce_allocate
  local nonce="$TRANSACTION_NONCE_ALLOCATED"
  local receipt
  receipt="$(cast send --rpc-url "$rpc_url" "${wallet_args[@]}" --nonce "$nonce" --json "$@")"
  [[ "$(jq -r '.status' <<<"$receipt")" == "0x1" ||
     "$(jq -r '.status' <<<"$receipt")" == "1" ]] || return 1
  LAST_TRANSACTION_HASH="$(jq -er '.transactionHash // .transaction_hash' <<<"$receipt")"
  printf '%s\n' "$LAST_TRANSACTION_HASH" >>"$configuration_transaction_log"
  printf '%s\n' "$LAST_TRANSACTION_HASH"
}
runtime_code_hash() {
  local code
  code="$(cast code "$1" --rpc-url "$rpc_url")"
  [[ "$code" != "0x" ]] || {
    echo "Cannot hash empty runtime code at $1" >&2
    exit 1
  }
  cast keccak "$code"
}

pool_manager="$(jq -er '.contracts.poolManager.address' "$venue_manifest")"
position_manager="$(jq -er '.contracts.positionManager.address' "$venue_manifest")"
quoter="$(jq -er '.contracts.quoter.address' "$venue_manifest")"
universal_router="$(jq -er '.contracts.universalRouter.address' "$venue_manifest")"
permit2="$(jq -er '.contracts.permit2.address' "$venue_manifest")"

state_view="$(jq -r '.contracts.stateView.address // empty' "$venue_manifest")"
if [[ -z "$state_view" ]]; then
  [[ "$rehearsal" == "true" ]] || {
    echo "The reviewed venue manifest must contain the verified StateView before live deployment" >&2
    exit 1
  }
  deploy_contract stateView \
    ../../node_modules/@uniswap/v4-periphery/src/lens/StateView.sol:StateView "$pool_manager"
  state_view="${addresses[stateView]}"
fi
state_view_pool_manager="$(
  cast call "$state_view" 'poolManager()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]'
)"
[[ "$state_view_pool_manager" == "${pool_manager,,}" ]] || {
  echo "StateView PoolManager wiring mismatch" >&2
  exit 1
}

guardian="${ROBYN_GUARDIAN_ADDRESS:-$deployer}"
wrapped_native="$(jq -er '.contracts.wrappedNative' "$legacy_asset_manifest")"
[[ "$(cast code "$wrapped_native" --rpc-url "$rpc_url")" != "0x" ]] || {
  echo "The reviewed testnet wrapped-native contract has no runtime code" >&2
  exit 1
}
deploy_contract timelock \
  ../../node_modules/@openzeppelin/contracts/governance/TimelockController.sol:TimelockController \
  600 "[]" "[]" "$deployer"
timelock="${addresses[timelock]}"
deploy_contract daoToken src/dao/RobynDaoToken.sol:RobynDaoToken \
  "[$deployer]" "[1000000000000000000000000000]"
dao_token="${addresses[daoToken]}"
deploy_contract governor \
  src/dao/RobynTestnetGovernor.sol:RobynTestnetGovernor "$dao_token" "$timelock"
governor="${addresses[governor]}"
deploy_contract assetRouter src/uniswap/RobynV4AssetRouter.sol:RobynV4AssetRouter \
  "$pool_manager" "$quoter" "$state_view" "$timelock" "$guardian" "$wrapped_native"
asset_router="${addresses[assetRouter]}"

if [[ -n "$reuse_routes_manifest" ]]; then
  [[ -f "$reuse_routes_manifest" ]] || {
    echo "The route-reuse manifest does not exist: $reuse_routes_manifest" >&2
    exit 1
  }
  [[ "$(jq -r '.chainId' "$reuse_routes_manifest")" == "46630" &&
     "$(jq -r '.liquidityVenue' "$reuse_routes_manifest")" == "uniswap-v4" &&
     "$(jq -r '.assetRoutes | length' "$reuse_routes_manifest")" == "11" ]] || {
    echo "The route-reuse manifest is not a complete schema-12 chain-46630 manifest" >&2
    exit 1
  }
  test_asset_liquidity_locker="$(
    jq -er '.contracts.testAssetLiquidityLocker' "$reuse_routes_manifest"
  )"
  [[ "$(cast code "$test_asset_liquidity_locker" --rpc-url "$rpc_url")" != "0x" ]] || {
    echo "The reused test-asset liquidity locker has no runtime code" >&2
    exit 1
  }
  [[ "$(cast call "$test_asset_liquidity_locker" 'configurationSealed()(bool)' \
      --rpc-url "$rpc_url")" == "true" ]] || {
    echo "The reused test-asset liquidity locker is not sealed" >&2
    exit 1
  }
else
  deploy_contract testAssetLiquidityLocker \
    src/uniswap/RobynV4TestAssetLiquidityLocker.sol:RobynV4TestAssetLiquidityLocker \
    "$pool_manager"
  test_asset_liquidity_locker="${addresses[testAssetLiquidityLocker]}"
fi

maximum_reference_tick_deviation=198
mock_reference_tick_deviation=0

mock_native_seed="100000000000000"
mock_token_seed_max="100000000000000"
mock_liquidity="50000000000000"
mock_maximum_native_input="1000000000000"
wrapped_native_maximum_input="500000000000000000"
wrapped_native_verification_class="$(cast keccak 'ROBYN_SCHEMA12_DIRECT_WETH')"
send_transaction "$asset_router" \
  'configureWrappedNativeRoute(uint128,bytes32,bool)' \
  "$wrapped_native_maximum_input" "$wrapped_native_verification_class" true >/dev/null
wrapped_native_status="$(
  cast call "$asset_router" \
    'executionRouteStatus(address)((uint8,address,address,uint128,uint128,bytes32,bytes32,bytes32,bytes32,bool,bool,bool,bytes32))' \
    "$wrapped_native" --rpc-url "$rpc_url" --json
)"
[[ "$(jq -r '.[0][11]' <<<"$wrapped_native_status")" == "true" ]] || {
  echo "The schema-12 direct WETH route is not ready" >&2
  exit 1
}
wrapped_native_runtime_hash="$(runtime_code_hash "$wrapped_native")"
if [[ -z "$reuse_routes_manifest" ]]; then
  jq -nc \
    --arg address "$wrapped_native" \
    --arg runtimeCodeHash "$wrapped_native_runtime_hash" \
    '{
      symbol:"WETH",
      address:$address,
      poolId:null,
      fee:0,
      tickSpacing:0,
      hook:"0x0000000000000000000000000000000000000000",
      verification:"robyn-controlled-testnet-dex",
      provenance:"schema12-direct-wrap",
      routeKind:"wrapped-native",
      runtimeCodeHash:$runtimeCodeHash
    }' >>"$mock_route_log"
fi
  jq -nc \
    '{
      symbol:"WETH",
      referenceTick:0,
      maximumReferenceTickDeviation:0,
      enforceReferencePrice:false,
      maximumProtectedRouteSlippageBps:0,
      routeKind:"wrapped-native"
    }' >>"$route_safety_log"
if [[ -z "$reuse_routes_manifest" ]]; then
while IFS=$'\t' read -r symbol name category; do
  asset_key="schema12Asset${symbol}"
  deploy_contract "$asset_key" \
    src/testnet/TestnetMockERC20.sol:TestnetMockERC20 \
    "Robyn Testnet Mock $name" "tm$symbol" "$deployer" "0"
  asset="${addresses[$asset_key]}"
  send_transaction "$asset" 'mint(address,uint256)' "$deployer" "$mock_token_seed_max" >/dev/null
  route_verification_class="$(cast keccak 'ROBYN_TESTNET_MOCK_V4_ROUTE')"
  send_transaction "$asset" 'approve(address,uint256)' \
    "$test_asset_liquidity_locker" "$mock_token_seed_max" >/dev/null
  send_transaction --value "$mock_native_seed" "$test_asset_liquidity_locker" \
    'seed(address,uint128,uint256)' "$asset" "$mock_liquidity" "$mock_token_seed_max" >/dev/null
  seed_tx="$LAST_TRANSACTION_HASH"
  route="(10000,200,$zero,1,$mock_maximum_native_input,0,$mock_reference_tick_deviation,false,$route_verification_class,true)"
  send_transaction "$asset_router" \
    'configureRoute(address,(uint24,int24,address,uint128,uint128,int24,uint24,bool,bytes32,bool))' \
    "$asset" "$route" >/dev/null
  status="$(
    cast call "$asset_router" \
      'routeStatus(address)((bytes32,uint128,uint128,uint128,int24,int24,uint24,bool,bytes32,uint24,int24,address,bool,bytes32))' \
      "$asset" --rpc-url "$rpc_url" --json
  )"
  [[ "$(jq -r '.[0][12]' <<<"$status")" == "true" ]] || {
    echo "$symbol mock route is not ready after liquidity lock" >&2
    exit 1
  }
  jq -nc \
    --arg symbol "$symbol" \
    --argjson maximumReferenceTickDeviation "$mock_reference_tick_deviation" \
    '{
      symbol:$symbol,
      referenceTick:0,
      maximumReferenceTickDeviation:$maximumReferenceTickDeviation,
      enforceReferencePrice:false,
      maximumProtectedRouteSlippageBps:100
    }' >>"$route_safety_log"
  jq -nc \
    --arg symbol "$symbol" \
    --arg name "$name" \
    --arg category "$category" \
    --arg address "$asset" \
    --arg poolId "$(jq -r '.[0][0]' <<<"$status")" \
    --arg liquidityLocker "$test_asset_liquidity_locker" \
    --arg seedTransaction "$seed_tx" \
    --arg assetCreationTransaction "${txs[$asset_key]}" \
    '{
      symbol:$symbol,
      mockSymbol:("tm" + $symbol),
      name:$name,
      category:$category,
      address:$address,
      poolId:$poolId,
      fee:10000,
      tickSpacing:200,
      hook:"0x0000000000000000000000000000000000000000",
      verification:"robyn-testnet-mock",
      provenance:"schema12-fresh-mock-v4-pool",
      liquidityLocker:$liquidityLocker,
      seedTransaction:$seedTransaction,
      assetCreationTransaction:$assetCreationTransaction
    }' >>"$mock_route_log"
done <<'SCHEMA12_V4_ASSETS'
GOOGL	Alphabet	stock
MSFT	Microsoft	stock
NVDA	NVIDIA	stock
SPY	SPDR S&P 500 ETF	etf
SCHEMA12_V4_ASSETS

provider_maximum_native_input="1000000000000"
provider_maximum_asset_input="1000000000000000000"
provider_asset_inventory="1000000000000000000000000"
provider_wrapped_inventory="100000000000000"
provider_rate_x18="1000000000000000000"
provider_class="$(cast keccak 'SCHEMA12_TESTNET_DETERMINISTIC')"
provider_sink="$timelock"
while IFS=$'\t' read -r symbol name category; do
  asset_key="schema12Asset${symbol}"
  guard_key="schema12Guard${symbol}"
  adapter_key="schema12Adapter${symbol}"
  deploy_contract "$asset_key" \
    src/testnet/TestnetMockERC20.sol:TestnetMockERC20 \
    "$name" "tm$symbol" "$deployer" "1000000000000000000000"
  provider_asset="${addresses[$asset_key]}"
  deploy_contract "$guard_key" \
    src/testnet/TestnetPinnedExecutionAdapter.sol:TestnetFixedRatePriceGuard \
    "$provider_asset" "$wrapped_native" "$provider_rate_x18"
  provider_guard="${addresses[$guard_key]}"
  deploy_contract "$adapter_key" \
    src/testnet/TestnetPinnedExecutionAdapter.sol:TestnetPinnedExecutionAdapter \
    "$asset_router" "$provider_asset" "$wrapped_native" "$provider_sink" "$provider_rate_x18"
  provider_adapter="${addresses[$adapter_key]}"
  send_transaction "$provider_asset" 'mint(address,uint256)' \
    "$provider_adapter" "$provider_asset_inventory" >/dev/null
  send_transaction --value "$provider_wrapped_inventory" \
    "$wrapped_native" 'deposit()' >/dev/null
  send_transaction "$wrapped_native" 'transfer(address,uint256)' \
    "$provider_adapter" "$provider_wrapped_inventory" >/dev/null
  provider_adapter_hash="$(runtime_code_hash "$provider_adapter")"
  provider_guard_hash="$(runtime_code_hash "$provider_guard")"
  provider_route="(3,$provider_adapter,$provider_guard,$provider_maximum_native_input,$provider_maximum_asset_input,$provider_class,$provider_adapter_hash,$provider_guard_hash,$zero_bytes32,true)"
  send_transaction "$asset_router" \
    'configureAdapterRoute(address,(uint8,address,address,uint128,uint128,bytes32,bytes32,bytes32,bytes32,bool))' \
    "$provider_asset" "$provider_route" >/dev/null
  provider_status="$(
    cast call "$asset_router" \
      'executionRouteStatus(address)((uint8,address,address,uint128,uint128,bytes32,bytes32,bytes32,bytes32,bool,bool,bool,bytes32))' \
      "$provider_asset" --rpc-url "$rpc_url" --json
  )"
  [[ "$(jq -r '.[0][11]' <<<"$provider_status")" == "true" ]] || {
    echo "$symbol deterministic provider route is not ready" >&2
    exit 1
  }
  jq -nc \
    --arg symbol "$symbol" \
    --arg name "$name" \
    --arg category "$category" \
    --arg address "$provider_asset" \
    --arg adapter "$provider_adapter" \
    --arg priceGuard "$provider_guard" \
    --arg adapterRuntimeHash "$provider_adapter_hash" \
    --arg priceGuardRuntimeHash "$provider_guard_hash" \
    --arg assetCreationTransaction "${txs[$asset_key]}" \
    --arg adapterCreationTransaction "${txs[$adapter_key]}" \
    --arg priceGuardCreationTransaction "${txs[$guard_key]}" \
    --arg maximumNativeInput "$provider_maximum_native_input" \
    --arg maximumAssetInput "$provider_maximum_asset_input" \
    '{
      symbol:$symbol,
      mockSymbol:("tm" + $symbol),
      name:$name,
      category:$category,
      address:$address,
      poolId:null,
      fee:0,
      tickSpacing:0,
      hook:"0x0000000000000000000000000000000000000000",
      verification:"robyn-testnet-mock",
      provenance:"schema12-deterministic-provider-fixture",
      routeKind:"pinned-adapter",
      provider:"schema12-testnet-deterministic",
      adapter:$adapter,
      priceGuard:$priceGuard,
      adapterRuntimeHash:$adapterRuntimeHash,
      priceGuardRuntimeHash:$priceGuardRuntimeHash,
      maximumNativeInput:$maximumNativeInput,
      maximumAssetInput:$maximumAssetInput,
      assetCreationTransaction:$assetCreationTransaction,
      adapterCreationTransaction:$adapterCreationTransaction,
      priceGuardCreationTransaction:$priceGuardCreationTransaction
    }' >>"$mock_route_log"
  jq -nc \
    --arg symbol "$symbol" \
    '{
      symbol:$symbol,
      referenceTick:0,
      maximumReferenceTickDeviation:0,
      enforceReferencePrice:false,
      maximumProtectedRouteSlippageBps:50,
      routeKind:"pinned-adapter"
    }' >>"$route_safety_log"
done <<'SCHEMA12_PROVIDER_ASSETS'
SPCX	SpaceX	stock
GME	GameStop	stock
USDG	Global Dollar	crypto
USDe	Ethena USDe	crypto
DEGEN	Degen	crypto
ARROW	Arrow	crypto
SCHEMA12_PROVIDER_ASSETS
send_transaction "$test_asset_liquidity_locker" 'seal()' >/dev/null
else
  while IFS=$'\t' read -r symbol asset pool_id verification provenance locker; do
    case "$verification" in
      robinhood-testnet-faucet-stock)
        route_verification_class="$(cast keccak 'ROBINHOOD_TESTNET_FAUCET_STOCK')"
        maximum_native_input="10000000000"
        route_reference_tick_deviation="$maximum_reference_tick_deviation"
        route_enforce_reference_price=true
        ;;
      robyn-controlled-testnet-dex)
        route_verification_class="$(cast keccak 'ROBYN_CONTROLLED_TESTNET_WETH')"
        maximum_native_input="$mock_maximum_native_input"
        route_reference_tick_deviation="$mock_reference_tick_deviation"
        route_enforce_reference_price=false
        ;;
      robyn-testnet-mock)
        route_verification_class="$(cast keccak 'ROBYN_TESTNET_MOCK_V4_ROUTE')"
        maximum_native_input="$mock_maximum_native_input"
        route_reference_tick_deviation="$mock_reference_tick_deviation"
        route_enforce_reference_price=false
        ;;
      *)
        echo "Unsupported reused route verification class for $symbol: $verification" >&2
        exit 1
        ;;
    esac
    slot0="$(
      cast call "$state_view" 'getSlot0(bytes32)(uint160,int24,uint24,uint24)' \
        "$pool_id" --rpc-url "$rpc_url" --json
    )"
    reference_tick="$(jq -r '.[1]' <<<"$slot0")"
    if [[ "$route_enforce_reference_price" == "true" ]]; then
      route_reference_tick="$reference_tick"
    else
      route_reference_tick=0
    fi
    route="(10000,200,$zero,1,$maximum_native_input,$route_reference_tick,$route_reference_tick_deviation,$route_enforce_reference_price,$route_verification_class,true)"
    send_transaction "$asset_router" \
      'configureRoute(address,(uint24,int24,address,uint128,uint128,int24,uint24,bool,bytes32,bool))' \
      "$asset" "$route" >/dev/null
    status="$(
      cast call "$asset_router" \
        'routeStatus(address)((bytes32,uint128,uint128,uint128,int24,int24,uint24,bool,bytes32,uint24,int24,address,bool,bytes32))' \
        "$asset" --rpc-url "$rpc_url" --json
    )"
    [[ "$(jq -r '.[0][12]' <<<"$status")" == "true" &&
       "$(jq -r '.[0][0]' <<<"$status")" == "$pool_id" ]] || {
      echo "$symbol reused route is not ready or changed pool identity" >&2
      exit 1
    }
    jq -nc \
      --arg symbol "$symbol" \
      --argjson referenceTick "$route_reference_tick" \
      --argjson maximumReferenceTickDeviation "$route_reference_tick_deviation" \
      --argjson enforceReferencePrice "$route_enforce_reference_price" \
      '{
        symbol:$symbol,
        referenceTick:$referenceTick,
        maximumReferenceTickDeviation:$maximumReferenceTickDeviation,
        enforceReferencePrice:$enforceReferencePrice,
        maximumProtectedRouteSlippageBps:100
      }' >>"$route_safety_log"
  done < <(jq -r '.assetRoutes[] | [
    .symbol,.address,.poolId,.verification,.provenance,(.liquidityLocker // "")
  ] | @tsv' "$reuse_routes_manifest")
fi

deploy_contract launchDeployer \
  src/uniswap/RobynNativeLaunchDeployerV4.sol:RobynNativeLaunchDeployerV4
launch_deployer="${addresses[launchDeployer]}"
deploy_contract vaultDeployer \
  src/uniswap/RobynNativeVaultDeployerV4.sol:RobynNativeVaultDeployerV4
vault_deployer="${addresses[vaultDeployer]}"
deploy_contract launchFactory \
  src/uniswap/RobynNativeLaunchFactoryV4.sol:RobynNativeLaunchFactoryV4 \
  "$asset_router" "$launch_deployer" "$vault_deployer" 1 3600
launch_factory="${addresses[launchFactory]}"
send_transaction "$launch_deployer" 'bindController(address)' "$launch_factory" >/dev/null
send_transaction "$vault_deployer" 'bindController(address)' "$launch_factory" >/dev/null

deploy_contract feeRouter \
  src/uniswap/RobynNativeProtocolFeeRouterV4.sol:RobynNativeProtocolFeeRouterV4 \
  "$dao_token" "$asset_router" "$timelock" "$guardian"
fee_router="${addresses[feeRouter]}"

deploy_contract tokenSink \
  src/RobynTokenSink.sol:RobynTokenSink
token_sink="${addresses[tokenSink]}"

hook_artifact="packages/contracts/out/RobynV4FeeAndPhaseHook.sol/RobynV4FeeAndPhaseHook.json"
hook_bytecode="$(jq -er '.bytecode.object' "$hook_artifact")"
hook_domain="$(cast keccak "sherwood-forest-v4-security-remediation:$(git rev-parse HEAD)")"
hook_args="$(
  cast abi-encode 'constructor(address,address,address,address,bytes32)' \
    "$pool_manager" "$fee_router" "$deployer" "$position_manager" "$hook_domain"
)"
hook_init_code="${hook_bytecode}${hook_args#0x}"
hook_mining="$(node scripts/mine-v4-hook-salt.mjs "$create2_deployer" "$hook_init_code")"
hook="$(jq -er '.address' <<<"$hook_mining")"
hook_salt="$(jq -er '.salt' <<<"$hook_mining")"
[[ "$(cast code "$hook" --rpc-url "$rpc_url")" == "0x" ]] || {
  echo "The mined v4 hook address already contains code" >&2
  exit 1
}
hook_payload="${hook_salt}${hook_init_code#0x}"
send_transaction "$create2_deployer" --data "$hook_payload" >/dev/null
txs[oracleHook]="$LAST_TRANSACTION_HASH"
[[ "$(cast code "$hook" --rpc-url "$rpc_url")" != "0x" ]] || {
  echo "CREATE2 oracle hook deployment produced no code" >&2
  exit 1
}
addresses[oracleHook]="$hook"
hook_initializer="$(
  cast call "$hook" 'initializer()(address)' --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]'
)"
[[ "$hook_initializer" == "${deployer,,}" ]] || {
  echo "Oracle hook initializer mismatch" >&2
  exit 1
}
[[ "$(cast call "$hook" 'deploymentDomain()(bytes32)' --rpc-url "$rpc_url")" == "$hook_domain" ]] || {
  echo "Oracle hook deployment domain mismatch" >&2
  exit 1
}

curve_tokens="800000000000000000000000000"
graduation_tokens="200000000000000000000000000"
virtual_tokens="1066666666666666666666666666"
virtual_native="500000000000000"
threshold_native="1500000000000001"
curve_fee_bps="100"
minimum_use_bps="9900"
maximum_native_swap="250000000000000"
maximum_native_residual="1000000000"
maximum_token_residual="1000000000000"
curve="($curve_tokens,$graduation_tokens,$virtual_tokens,$virtual_native,$threshold_native,$curve_fee_bps,$maximum_native_swap)"
deploy_contract adapterDeployer \
  src/uniswap/RobynV4AdapterDeployer.sol:RobynV4AdapterDeployer
adapter_deployer="${addresses[adapterDeployer]}"
deploy_contract lockerDeployer \
  src/uniswap/RobynV4LockerDeployer.sol:RobynV4LockerDeployer
locker_deployer="${addresses[lockerDeployer]}"
deploy_contract marketDeployer \
  src/uniswap/RobynV4MarketDeployer.sol:RobynV4MarketDeployer
market_deployer="${addresses[marketDeployer]}"
dependencies="($launch_factory,$fee_router,$asset_router,$hook,$pool_manager,$position_manager,$permit2,$state_view,$adapter_deployer,$locker_deployer,$market_deployer,$token_sink)"
deploy_contract marketFactory \
  src/uniswap/RobynV4MarketFactory.sol:RobynV4MarketFactory \
  "$dependencies" "$curve" "$minimum_use_bps" "$maximum_native_swap" \
  "$maximum_native_residual" "$maximum_token_residual"
market_factory="${addresses[marketFactory]}"
send_transaction "$adapter_deployer" 'bindController(address)' "$market_factory" >/dev/null
send_transaction "$locker_deployer" 'bindController(address)' "$market_factory" >/dev/null
send_transaction "$market_deployer" 'bindController(address)' "$market_factory" >/dev/null
send_transaction "$hook" 'bindRegistrar(address)' "$market_factory" >/dev/null
send_transaction "$asset_router" 'bindLaunchRegistrar(address)' "$market_factory" >/dev/null

deploy_contract coordinator \
  src/uniswap/RobynV4LaunchCoordinatorV5.sol:RobynV4LaunchCoordinatorV5 \
  "$launch_factory" "$market_factory" "$fee_router"
coordinator="${addresses[coordinator]}"
send_transaction "$launch_factory" 'bindCoordinator(address)' "$coordinator" >/dev/null
send_transaction "$market_factory" 'bindCoordinator(address)' "$coordinator" >/dev/null
send_transaction "$fee_router" 'bindCoordinator(address)' "$coordinator" >/dev/null

exclusions="[$timelock,$fee_router,$governor,$coordinator,$market_factory,$launch_factory,$launch_deployer,$vault_deployer,$asset_router,$hook,$adapter_deployer,$locker_deployer,$market_deployer,$test_asset_liquidity_locker,$token_sink]"
send_transaction "$dao_token" 'sealRewardExclusions(address[])' "$exclusions" >/dev/null
send_transaction "$dao_token" 'bindRewardDepositor(address)' "$fee_router" >/dev/null

proposer_role="$(cast call "$timelock" 'PROPOSER_ROLE()(bytes32)' --rpc-url "$rpc_url")"
canceller_role="$(cast call "$timelock" 'CANCELLER_ROLE()(bytes32)' --rpc-url "$rpc_url")"
executor_role="$(cast call "$timelock" 'EXECUTOR_ROLE()(bytes32)' --rpc-url "$rpc_url")"
admin_role="$(cast call "$timelock" 'DEFAULT_ADMIN_ROLE()(bytes32)' --rpc-url "$rpc_url")"
send_transaction "$timelock" 'grantRole(bytes32,address)' "$proposer_role" "$governor" >/dev/null
send_transaction "$timelock" 'grantRole(bytes32,address)' "$canceller_role" "$guardian" >/dev/null
send_transaction "$timelock" 'grantRole(bytes32,address)' "$executor_role" "$zero" >/dev/null
send_transaction "$timelock" 'renounceRole(bytes32,address)' "$admin_role" "$deployer" >/dev/null

googl="${addresses[schema12AssetGOOGL]}"
msft="${addresses[schema12AssetMSFT]}"
nvda="${addresses[schema12AssetNVDA]}"
metadata_uri="ipfs://bafkreibys2cv4ijpoedcl7qdbi5u66wuwedwg3lsc6pios3wcyaoyz7cau"
genesis_salt="$(cast keccak "robyn-v4-chain-46630-genesis-$(git rev-parse HEAD)")"
transaction_nonce_allocate
genesis_nonce="$TRANSACTION_NONCE_ALLOCATED"
launch_receipt="$(cast send --rpc-url "$rpc_url" "${wallet_args[@]}" --nonce "$genesis_nonce" --json "$coordinator" \
  'createLaunch((string,string,address[],uint16[],string,bytes32))' \
  "(\"Robyn Schema-12 Testnet Genesis\",\"tR12\",[$googl,$msft,$nvda],[4000,4000,2000],\"$metadata_uri\",$genesis_salt)")"
[[ "$(jq -r '.status' <<<"$launch_receipt")" == "0x1" ||
   "$(jq -r '.status' <<<"$launch_receipt")" == "1" ]] || {
  echo "Atomic v4 genesis launch failed" >&2
  exit 1
}
launch_tx="$(jq -er '.transactionHash // .transaction_hash' <<<"$launch_receipt")"
launch="$(ROBYN_TESTNET_RPC_URL="$rpc_url" node scripts/decode-v4-launch-receipt.mjs "$launch_tx")"
launch="$(
  jq -c \
    --arg googl "$googl" \
    --arg msft "$msft" \
    --arg nvda "$nvda" \
    '. + {assets: [$googl, $msft, $nvda], weightsBps: [4000, 4000, 2000]}' \
    <<<"$launch"
)"
launch_coordinator="$(jq -r '.coordinator' <<<"$launch" | tr '[:upper:]' '[:lower:]')"
[[ "$launch_coordinator" == "${coordinator,,}" ]] || {
  echo "Receipt-derived coordinator identity mismatch" >&2
  exit 1
}
genesis_token="$(jq -er '.token' <<<"$launch")"
factory_genesis_token="$(
  cast call "$launch_factory" 'launchTokenById(uint256)(address)' \
    "$(jq -r '.launchId' <<<"$launch")" --rpc-url "$rpc_url" | tr '[:upper:]' '[:lower:]'
)"
[[ "$factory_genesis_token" == "${genesis_token,,}" ]] || {
  echo "Receipt-derived token does not match factory state" >&2
  exit 1
}

venue_hash="$(sha256sum "$venue_manifest" | awk '{print $1}')"
official_asset_routes='[]'
mock_asset_routes="$(jq -sc '.' "$mock_route_log")"
if [[ -n "$reuse_routes_manifest" ]]; then
  asset_routes="$(jq -c '.assetRoutes' "$reuse_routes_manifest")"
else
  asset_routes="$(
    jq -nc --argjson official "$official_asset_routes" --argjson mocks "$mock_asset_routes" \
      '$official + $mocks'
  )"
fi
route_safety="$(jq -sc '.' "$route_safety_log")"
asset_routes="$(
  jq -nc --argjson routes "$asset_routes" --argjson safety "$route_safety" '
    $routes
    | map(
        . as $route
        | ($safety[] | select(.symbol == $route.symbol)) as $routeSafety
        | $route + $routeSafety
      )
  '
)"
deployment_block_raw="$(
  cast receipt "${txs[timelock]}" --rpc-url "$rpc_url" --json | jq -er '.blockNumber'
)"
deployment_block="$((deployment_block_raw))"
asset_catalog="$(
  jq -c --argjson routes "$asset_routes" '
    [$routes[] as $route
      | ([.assetCatalog.assets[] | select(.symbol == $route.symbol)][0]
          // {
            symbol:$route.symbol,
            mockSymbol:($route.mockSymbol // ("tm" + $route.symbol)),
            name:$route.name,
            category:$route.category,
            logoUrl:null,
            mainnetAddress:null,
            referencePriceUsd:null
          }) as $catalog
      | $catalog
        + {
            name: (
              if $route.verification == "robyn-testnet-mock"
              then "Robyn Testnet Mock " + $catalog.name
              else $catalog.name
              end
            ),
            address: $route.address,
            chainId: 46630,
            decimals: 18,
            verification: $route.verification,
            mockOnly: ($route.verification != "robinhood-testnet-faucet-stock"),
            disclosure: (
              if $route.verification == "robinhood-testnet-faucet-stock"
              then "Robinhood Testnet faucet asset. Not a production Stock Token and has no value or redemption rights."
              elif $route.verification == "robyn-controlled-testnet-dex"
              then "Robyn-controlled testnet WETH route. Test-only and not an official Robinhood asset."
              else "Robyn testnet mock. Not an official Robinhood Stock Token, backed share, or redeemable security."
              end
            ),
            route: {kind:($route.routeKind // "uniswap-v4"),ready:true},
            poolId: $route.poolId,
            poolFee: $route.fee,
            tickSpacing: $route.tickSpacing,
            hook: $route.hook,
            routeProvenance: $route.provenance
          }
      | del(.fixedRateX18)
      | if .verification == "robinhood-testnet-faucet-stock"
        then del(.mockSymbol)
        else .
        end]
  ' "$legacy_asset_manifest"
)"
state_view_tx="${txs[stateView]:-$(jq -r '.contracts.stateView.creationTransaction // empty' "$venue_manifest")}"
deployment_transactions="$(
  jq -n \
    --arg stateView "$state_view_tx" \
    --arg timelock "${txs[timelock]}" \
    --arg daoToken "${txs[daoToken]}" \
    --arg governor "${txs[governor]}" \
    --arg assetRouter "${txs[assetRouter]}" \
    --arg testAssetLiquidityLocker "${txs[testAssetLiquidityLocker]:-}" \
    --arg launchDeployer "${txs[launchDeployer]}" \
    --arg vaultDeployer "${txs[vaultDeployer]}" \
    --arg launchFactory "${txs[launchFactory]}" \
    --arg protocolFeeRouter "${txs[feeRouter]}" \
    --arg oracleHook "${txs[oracleHook]}" \
    --arg adapterDeployer "${txs[adapterDeployer]}" \
    --arg lockerDeployer "${txs[lockerDeployer]}" \
    --arg marketDeployer "${txs[marketDeployer]}" \
    --arg marketFactory "${txs[marketFactory]}" \
    --arg atomicLaunchCoordinator "${txs[coordinator]}" \
    --arg genesis "$launch_tx" \
    '{
      stateView: $stateView,
      timelock: $timelock,
      daoToken: $daoToken,
      governor: $governor,
      assetRouter: $assetRouter,
      testAssetLiquidityLocker: $testAssetLiquidityLocker,
      launchDeployer: $launchDeployer,
      vaultDeployer: $vaultDeployer,
      launchFactory: $launchFactory,
      protocolFeeRouter: $protocolFeeRouter,
      oracleHook: $oracleHook,
      adapterDeployer: $adapterDeployer,
      lockerDeployer: $lockerDeployer,
      marketDeployer: $marketDeployer,
      marketFactory: $marketFactory,
      atomicLaunchCoordinator: $atomicLaunchCoordinator,
      genesis: $genesis
    }'
)"
configuration_transactions="$(
  jq -Rsc 'split("\n") | map(select(length > 0))' "$configuration_transaction_log"
)"
runtime_hashes="$(
  jq -n \
    --arg stateView "$(runtime_code_hash "$state_view")" \
    --arg timelock "$(runtime_code_hash "$timelock")" \
    --arg daoToken "$(runtime_code_hash "$dao_token")" \
    --arg governor "$(runtime_code_hash "$governor")" \
    --arg assetRouter "$(runtime_code_hash "$asset_router")" \
    --arg testAssetLiquidityLocker "$(runtime_code_hash "$test_asset_liquidity_locker")" \
    --arg launchDeployer "$(runtime_code_hash "$launch_deployer")" \
    --arg vaultDeployer "$(runtime_code_hash "$vault_deployer")" \
    --arg launchFactory "$(runtime_code_hash "$launch_factory")" \
    --arg protocolFeeRouter "$(runtime_code_hash "$fee_router")" \
    --arg oracleHook "$(runtime_code_hash "$hook")" \
    --arg adapterDeployer "$(runtime_code_hash "$adapter_deployer")" \
    --arg lockerDeployer "$(runtime_code_hash "$locker_deployer")" \
    --arg marketDeployer "$(runtime_code_hash "$market_deployer")" \
    --arg marketFactory "$(runtime_code_hash "$market_factory")" \
    --arg atomicLaunchCoordinator "$(runtime_code_hash "$coordinator")" \
    --arg genesisToken "$(runtime_code_hash "$genesis_token")" \
    --arg genesisVault "$(runtime_code_hash "$(jq -r '.vault' <<<"$launch")")" \
    --arg genesisMarket "$(runtime_code_hash "$(jq -r '.market' <<<"$launch")")" \
    --arg genesisAdapter "$(runtime_code_hash "$(jq -r '.graduationAdapter' <<<"$launch")")" \
    --arg genesisLocker "$(runtime_code_hash "$(jq -r '.positionLocker' <<<"$launch")")" \
    '{
      stateView: $stateView,
      timelock: $timelock,
      daoToken: $daoToken,
      governor: $governor,
      assetRouter: $assetRouter,
      testAssetLiquidityLocker: $testAssetLiquidityLocker,
      launchDeployer: $launchDeployer,
      vaultDeployer: $vaultDeployer,
      launchFactory: $launchFactory,
      protocolFeeRouter: $protocolFeeRouter,
      oracleHook: $oracleHook,
      adapterDeployer: $adapterDeployer,
      lockerDeployer: $lockerDeployer,
      marketDeployer: $marketDeployer,
      marketFactory: $marketFactory,
      atomicLaunchCoordinator: $atomicLaunchCoordinator,
      genesisToken: $genesisToken,
      genesisVault: $genesisVault,
      genesisMarket: $genesisMarket,
      genesisAdapter: $genesisAdapter,
      genesisLocker: $genesisLocker
    }'
)"
mkdir -p "$(dirname "$output")"
tmp="$(mktemp "$(dirname "$output")/.46630-v4.XXXXXX")"
archived_predecessor_sha="$(
  if [[ -n "$reuse_routes_manifest" ]]; then
    sha256sum "$reuse_routes_manifest" | awk '{print $1}'
  fi
)"
jq -n \
  --argjson schemaVersion 12 \
  --arg environment "$([[ "$rehearsal" == "true" ]] && echo robinhood-testnet-fork-rehearsal || echo robinhood-testnet)" \
  --argjson chainId 46630 \
  --argjson deploymentBlock "$deployment_block" \
  --arg gitCommit "$(git rev-parse HEAD)" \
  --arg deployer "$deployer" \
  --arg guardian "$guardian" \
  --arg venueManifestSha256 "$venue_hash" \
  --arg archivedPredecessorManifestSha256 "$archived_predecessor_sha" \
  --argjson assetRoutes "$asset_routes" \
  --argjson assetCatalog "$asset_catalog" \
  --arg poolManager "$pool_manager" \
  --arg positionManager "$position_manager" \
  --arg quoter "$quoter" \
  --arg universalRouter "$universal_router" \
  --arg permit2 "$permit2" \
  --arg stateView "$state_view" \
  --arg wrappedNative "$wrapped_native" \
  --arg timelock "$timelock" \
  --arg daoToken "$dao_token" \
  --arg governor "$governor" \
  --arg assetRouter "$asset_router" \
  --arg testAssetLiquidityLocker "$test_asset_liquidity_locker" \
  --arg launchDeployer "$launch_deployer" \
  --arg vaultDeployer "$vault_deployer" \
  --arg launchFactory "$launch_factory" \
  --arg feeRouter "$fee_router" \
  --arg oracleHook "$hook" \
  --arg hookSalt "$hook_salt" \
  --arg hookDomain "$hook_domain" \
  --arg adapterDeployer "$adapter_deployer" \
  --arg lockerDeployer "$locker_deployer" \
  --arg marketDeployer "$market_deployer" \
  --arg marketFactory "$market_factory" \
  --arg coordinator "$coordinator" \
  --arg tokenSink "$token_sink" \
  --argjson genesis "$launch" \
  --argjson deploymentTransactions "$deployment_transactions" \
  --argjson configurationTransactions "$configuration_transactions" \
  --argjson runtimeCodeHashes "$runtime_hashes" \
  --arg curveTokens "$curve_tokens" \
  --arg graduationTokens "$graduation_tokens" \
  --arg virtualTokens "$virtual_tokens" \
  --arg virtualNative "$virtual_native" \
  --arg thresholdNative "$threshold_native" \
  --arg maximumCurvePurchase "$maximum_native_swap" \
  --arg maximumNativeSwap "$maximum_native_swap" \
  --arg maximumNativeResidual "$maximum_native_residual" \
  --arg maximumTokenResidual "$maximum_token_residual" \
  '{
    schemaVersion: $schemaVersion,
    environment: $environment,
    chainId: $chainId,
    deploymentBlock: $deploymentBlock,
    kingOfForestPolicy: {
      version: "forest-v1",
      activationBlock: $deploymentBlock,
      progressThresholdBps: 5000,
      minimumUniqueTraders: 10
    },
    gitCommit: $gitCommit,
    deployer: $deployer,
    guardian: $guardian,
    governanceProfile: "robinhood-testnet-short-assurance",
    archivedPredecessorManifestSha256: (
      if $archivedPredecessorManifestSha256 == ""
      then null
      else $archivedPredecessorManifestSha256
      end
    ),
    liquidityVenue: "uniswap-v4",
    venueProvenance: "shared-unlisted-robinhood-testnet-uniswap-v4-mirror",
    venueManifestSha256: $venueManifestSha256,
    assetRoutes: $assetRoutes,
    assetCatalog: {
      schemaVersion: 3,
      snapshotAt: (now | todateiso8601),
      disclosure: "Schema-12 Testnet uses individually selected mock, direct-WETH, and deterministic provider routes. Test assets are not production Stock Tokens, backed shares, or redeemable securities.",
      assets: $assetCatalog
    },
    contracts: {
      poolManager: $poolManager,
      positionManager: $positionManager,
      quoter: $quoter,
      universalRouter: $universalRouter,
      permit2: $permit2,
      stateView: $stateView,
      wrappedNative: $wrappedNative,
      baseAsset: "0x0000000000000000000000000000000000000000",
      rewardAssets: [$assetRoutes[].address],
      conversionRouter: $assetRouter,
      routeRegistry: $assetRouter,
      factory: $launchFactory,
      timelock: $timelock,
      daoToken: $daoToken,
      governor: $governor,
      assetRouter: $assetRouter,
      testAssetLiquidityLocker: $testAssetLiquidityLocker,
      launchDeployer: $launchDeployer,
      vaultDeployer: $vaultDeployer,
      launchFactory: $launchFactory,
      protocolFeeRouter: $feeRouter,
      oracleHook: $oracleHook,
      adapterDeployer: $adapterDeployer,
      lockerDeployer: $lockerDeployer,
      marketDeployer: $marketDeployer,
      marketFactory: $marketFactory,
      atomicLaunchCoordinator: $coordinator,
      tokenSink: $tokenSink,
      guardian: $guardian,
      nativeFeeConverter: "0x0000000000000000000000000000000000000000",
      genesisToken: $genesis.token,
      genesisVault: $genesis.vault,
      genesisMarket: $genesis.market,
      genesisGraduationAdapter: $genesis.graduationAdapter,
      genesisPositionLocker: $genesis.positionLocker
    },
    deploymentTransactions: $deploymentTransactions,
    configurationTransactions: $configurationTransactions,
    runtimeCodeHashes: $runtimeCodeHashes,
    oracleHook: {
      create2Deployer: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
      salt: $hookSalt,
      deploymentDomain: $hookDomain,
      permissionBits: "0x18e4",
      behavior: "immutable-phase-gated-1pct-fee-and-post-graduation-oracle",
      phases: ["Bonding", "Graduating", "Trading"],
      protocolFeeBps: 100
    },
    rewardStreams: {
      launchTokenDurationSeconds: 3600,
      daoDurationSeconds: 3600,
      creatorDurationSeconds: 3600,
      release: "rolling-linear-one-hour",
      allocation: "balance-held-while-unlocking",
      claims: "pull-claim-vested-amount-only"
    },
    creatorRewards: {
      allocation: "assigned-at-fee-intake-and-unlocked-over-one-hour",
      maximumRecipients: 8,
      sharesTotalBps: 10000,
      updatesAffect: "future-fees-only",
      lockPolicy: "creator-controlled-and-irreversible"
    },
    dao: {
      tokenName: "Robyn DAO",
      tokenSymbol: "RDAO",
      fixedSupply: "1000000000000000000000000000",
      initialOwnerShareBps: 10000,
      rewardStreamDurationSeconds: 3600,
      zeroEligibleSupplyPolicy: "queue-until-eligible-supply-returns",
      feePolicy: {
        basketBps: 5000,
        creatorBps: 2500,
        daoRewardsBps: 2000,
        treasuryBps: 500
      },
      governance: {
        profile: "robinhood-testnet-short-assurance",
        votingDelaySeconds: 600,
        votingPeriodSeconds: 1800,
        timelockSeconds: 600,
        quorumBps: 1000,
        proposalThresholdBps: 100
      }
    },
    market: {
      quoteCurrency: "native-ETH",
      poolFeePips: 10000,
      protocolFeeBps: 100,
      nominalPostGraduationFeeBps: 200,
      tickSpacing: 200,
      curveFeeBps: 100,
      curveTokenAllocation: $curveTokens,
      graduationTokenAllocation: $graduationTokens,
      initialVirtualTokenReserve: $virtualTokens,
      initialVirtualNativeReserve: $virtualNative,
      graduationThresholdNative: $thresholdNative,
      maximumCurvePurchase: $maximumCurvePurchase,
      minimumUseBps: 9900,
      maximumNativeSwap: $maximumNativeSwap,
      maximumNativeResidual: $maximumNativeResidual,
      maximumTokenResidual: $maximumTokenResidual,
      residualPolicy: "tracked-principal-dust-never-routed-or-converted",
      unattributedNativePolicy: "permissionless-sweep-to-timelock",
      unattributedLaunchTokenPolicy: "permissionless-sweep-to-immutable-token-sink"
    },
    liabilityModel: {
      intake: "accounting-only",
      allocationBps: {
        basket: 5000,
        creator: 2500,
        dao: 2000,
        treasury: 500
      },
      settlement: "permissionless-and-destination-isolated",
      solvencyIncludes: ["basket", "creator", "dao", "treasury"]
    },
    genesis: $genesis
  }' >"$tmp"
mv "$tmp" "$output"
ROBYN_TESTNET_RPC_URL="$rpc_url" node scripts/verify-testnet-v4-deployment.mjs "$output" >/dev/null
echo "Wrote verified v4 protocol manifest: $output"

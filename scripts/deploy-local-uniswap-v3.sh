#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_OPERATOR_RPC_URL:-http://127.0.0.1:8545}"
base_asset="${1:-}"

export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

if [[ "$(cast chain-id --rpc-url "$rpc_url")" != "31337" ]]; then
  echo "Refusing local Uniswap deployment outside chain 31337" >&2
  exit 1
fi
if [[ ! "$base_asset" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Usage: $0 <local-base-asset-address>" >&2
  exit 1
fi
if [[ "$(cast code "$base_asset" --rpc-url "$rpc_url")" == "0x" ]]; then
  echo "Base asset has no code: $base_asset" >&2
  exit 1
fi

deployer="$(cast rpc eth_accounts --rpc-url "$rpc_url" | jq -er '.[0]')"
zero_address="0x0000000000000000000000000000000000000000"

deploy_artifact() {
  local artifact="$1"
  local constructor_signature="$2"
  shift 2
  local bytecode encoded creation receipt deployed
  bytecode="$(jq -er '.bytecode' "$artifact")"
  encoded="0x"
  if [[ -n "$constructor_signature" ]]; then
    encoded="$(cast abi-encode "$constructor_signature" "$@")"
  fi
  creation="${bytecode}${encoded#0x}"
  receipt="$(cast send --rpc-url "$rpc_url" --from "$deployer" --unlocked --json --create "$creation")"
  deployed="$(jq -er '.contractAddress // .contract_address' <<<"$receipt")"
  if [[ "$(cast code "$deployed" --rpc-url "$rpc_url")" == "0x" ]]; then
    echo "Deployment produced no runtime code: $artifact" >&2
    exit 1
  fi
  printf '%s' "$deployed"
}

core_artifact="node_modules/@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json"
position_artifact="node_modules/@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json"
quoter_artifact="node_modules/@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json"
router_artifact="node_modules/@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json"
for artifact in "$core_artifact" "$position_artifact" "$quoter_artifact" "$router_artifact"; do
  [[ -f "$artifact" ]] || { echo "Missing pinned Uniswap artifact: $artifact" >&2; exit 1; }
done

factory="$(deploy_artifact "$core_artifact" "")"
position_manager="$(
  deploy_artifact "$position_artifact" "constructor(address,address,address)" \
    "$factory" "$base_asset" "$zero_address"
)"
quoter="$(
  deploy_artifact "$quoter_artifact" "constructor(address,address)" \
    "$factory" "$base_asset"
)"
swap_router="$(
  deploy_artifact "$router_artifact" "constructor(address,address,address,address)" \
    "$zero_address" "$factory" "$position_manager" "$base_asset"
)"

jq -n \
  --arg factory "$factory" \
  --arg positionManager "$position_manager" \
  --arg quoter "$quoter" \
  --arg swapRouter "$swap_router" \
  --arg wrappedQuoteAsset "$base_asset" \
  --arg coreVersion "1.0.0" \
  --arg peripheryVersion "1.4.4" \
  --arg routerVersion "1.1.0" \
  --arg factoryCodeHash "$(cast codehash "$factory" --rpc-url "$rpc_url")" \
  --arg positionManagerCodeHash "$(cast codehash "$position_manager" --rpc-url "$rpc_url")" \
  --arg quoterCodeHash "$(cast codehash "$quoter" --rpc-url "$rpc_url")" \
  --arg swapRouterCodeHash "$(cast codehash "$swap_router" --rpc-url "$rpc_url")" \
  '{
    environment: "local-canonical-uniswap-v3",
    factory: $factory,
    positionManager: $positionManager,
    quoter: $quoter,
    swapRouter: $swapRouter,
    wrappedQuoteAsset: $wrappedQuoteAsset,
    packageVersions: {
      core: $coreVersion,
      periphery: $peripheryVersion,
      swapRouterContracts: $routerVersion
    },
    runtimeCodeHashes: {
      factory: $factoryCodeHash,
      positionManager: $positionManagerCodeHash,
      quoter: $quoterCodeHash,
      swapRouter: $swapRouterCodeHash
    }
  }'

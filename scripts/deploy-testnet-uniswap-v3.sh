#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
manifest="${ROBYN_TESTNET_DEX_MANIFEST:-$repo_root/deployments/46630-uniswap-v3.json}"
rehearsal="${ROBYN_TESTNET_REHEARSAL:-false}"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

[[ "${ROBYN_TESTNET_DEX_BROADCAST:-false}" == "true" ]] || {
  echo "Set ROBYN_TESTNET_DEX_BROADCAST=true to authorize phase-one DEX deployment" >&2
  exit 1
}
[[ "$(cast chain-id --rpc-url "$rpc_url")" == "46630" ]] || {
  echo "Refusing test-only Uniswap deployment outside chain 46630" >&2
  exit 1
}

# Refuse a fallback deployment if Uniswap has since published an official chain entry.
registry_url="https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/46630.json"
registry_status="$(curl -LsS -o /tmp/robyn-uniswap-46630.json -w '%{http_code}' "$registry_url" || true)"
if [[ "$registry_status" == "200" ]]; then
  echo "An official Uniswap chain-46630 registry entry now exists; review it instead of deploying the fallback" >&2
  exit 1
fi

wallet_args=()
if [[ "$rehearsal" == "true" ]]; then
  [[ "${ROBYN_ALLOW_UNLOCKED_REHEARSAL:-false}" == "true" && "$rpc_url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]] || {
    echo "Unlocked signing is restricted to an explicitly allowed loopback rehearsal" >&2
    exit 1
  }
  deployer="$(cast rpc eth_accounts --rpc-url "$rpc_url" | jq -er '.[0]')"
  wallet_args=(--from "$deployer" --unlocked)
else
  keystore="${ROBYN_TESTNET_KEYSTORE:-}"
  password_file="${ROBYN_TESTNET_PASSWORD_FILE:-}"
  [[ -f "$keystore" && -f "$password_file" ]] || {
    echo "Readable ROBYN_TESTNET_KEYSTORE and ROBYN_TESTNET_PASSWORD_FILE are required" >&2
    exit 1
  }
  [[ -z "$(git status --porcelain)" && "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || {
    echo "Real testnet deployment requires clean exact origin/main" >&2
    exit 1
  }
  deployer="$(cast wallet address --keystore "$keystore" --password-file "$password_file")"
  wallet_args=(--keystore "$keystore" --password-file "$password_file")
fi

forge build --root packages/contracts >/dev/null
core_artifact="node_modules/@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json"
position_artifact="node_modules/@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json"
quoter_artifact="node_modules/@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json"
router_artifact="node_modules/@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json"
for artifact in "$core_artifact" "$position_artifact" "$quoter_artifact" "$router_artifact"; do
  [[ -f "$artifact" ]] || { echo "Missing pinned artifact: $artifact" >&2; exit 1; }
done

declare -A addresses txs creation_hashes runtime_hashes artifact_hashes constructor_args
deploy_artifact() {
  local key="$1" artifact="$2" constructor_signature="$3"
  shift 3
  local bytecode encoded creation receipt address tx
  bytecode="$(jq -er '.bytecode' "$artifact")"
  encoded="0x"
  [[ -z "$constructor_signature" ]] || encoded="$(cast abi-encode "$constructor_signature" "$@")"
  creation="${bytecode}${encoded#0x}"
  receipt="$(cast send --rpc-url "$rpc_url" "${wallet_args[@]}" --json --create "$creation")"
  address="$(jq -er '.contractAddress // .contract_address' <<<"$receipt")"
  tx="$(jq -er '.transactionHash // .transaction_hash' <<<"$receipt")"
  [[ "$(cast code "$address" --rpc-url "$rpc_url")" != "0x" ]] || { echo "No code for $key" >&2; exit 1; }
  addresses[$key]="$address"
  txs[$key]="$tx"
  creation_hashes[$key]="$(cast keccak "$creation")"
  runtime_hashes[$key]="$(cast codehash "$address" --rpc-url "$rpc_url")"
  artifact_hashes[$key]="$(sha256sum "$artifact" | awk '{print $1}')"
  constructor_args[$key]="$encoded"
}

weth_receipt="$(forge create src/testnet/TestnetWETH9.sol:TestnetWETH9 --root packages/contracts --rpc-url "$rpc_url" "${wallet_args[@]}" --broadcast --json)"
addresses[weth9]="$(jq -er '.deployedTo' <<<"$weth_receipt")"
txs[weth9]="$(jq -er '.transactionHash' <<<"$weth_receipt")"
weth_artifact="packages/contracts/out/TestnetWETH9.sol/TestnetWETH9.json"
creation_hashes[weth9]="$(cast keccak "$(jq -er '.bytecode.object' "$weth_artifact")")"
runtime_hashes[weth9]="$(cast codehash "${addresses[weth9]}" --rpc-url "$rpc_url")"
artifact_hashes[weth9]="$(sha256sum "$weth_artifact" | awk '{print $1}')"
constructor_args[weth9]="0x"

zero="0x0000000000000000000000000000000000000000"
deploy_artifact factory "$core_artifact" ""
deploy_artifact positionManager "$position_artifact" "constructor(address,address,address)" "${addresses[factory]}" "${addresses[weth9]}" "$zero"
deploy_artifact quoterV2 "$quoter_artifact" "constructor(address,address)" "${addresses[factory]}" "${addresses[weth9]}"
deploy_artifact swapRouter02 "$router_artifact" "constructor(address,address,address,address)" "$zero" "${addresses[factory]}" "${addresses[positionManager]}" "${addresses[weth9]}"

block_number="$(cast block-number --rpc-url "$rpc_url")"
git_commit="$(git rev-parse HEAD)"
mkdir -p "$(dirname "$manifest")"
tmp="$(mktemp "$(dirname "$manifest")/.dex.XXXXXX")"
jq -n \
  --argjson chainId 46630 --argjson deploymentBlock "$block_number" --arg gitCommit "$git_commit" --arg deployer "$deployer" \
  --arg weth "${addresses[weth9]}" --arg factory "${addresses[factory]}" --arg position "${addresses[positionManager]}" --arg quoter "${addresses[quoterV2]}" --arg router "${addresses[swapRouter02]}" \
  --arg wethTx "${txs[weth9]}" --arg factoryTx "${txs[factory]}" --arg positionTx "${txs[positionManager]}" --arg quoterTx "${txs[quoterV2]}" --arg routerTx "${txs[swapRouter02]}" \
  --arg wethCreation "${creation_hashes[weth9]}" --arg factoryCreation "${creation_hashes[factory]}" --arg positionCreation "${creation_hashes[positionManager]}" --arg quoterCreation "${creation_hashes[quoterV2]}" --arg routerCreation "${creation_hashes[swapRouter02]}" \
  --arg wethRuntime "${runtime_hashes[weth9]}" --arg factoryRuntime "${runtime_hashes[factory]}" --arg positionRuntime "${runtime_hashes[positionManager]}" --arg quoterRuntime "${runtime_hashes[quoterV2]}" --arg routerRuntime "${runtime_hashes[swapRouter02]}" \
  --arg wethArtifact "${artifact_hashes[weth9]}" --arg factoryArtifact "${artifact_hashes[factory]}" --arg positionArtifact "${artifact_hashes[positionManager]}" --arg quoterArtifact "${artifact_hashes[quoterV2]}" --arg routerArtifact "${artifact_hashes[swapRouter02]}" \
  --arg wethArgs "${constructor_args[weth9]}" --arg factoryArgs "${constructor_args[factory]}" --arg positionArgs "${constructor_args[positionManager]}" --arg quoterArgs "${constructor_args[quoterV2]}" --arg routerArgs "${constructor_args[swapRouter02]}" \
  '{schemaVersion:1, provenance:"robyn-controlled-uniswap-v3-testnet", officialDeployment:false, testOnly:true, chainId:$chainId, deploymentBlock:$deploymentBlock, gitCommit:$gitCommit, deployer:$deployer, registryCheck:{url:"https://github.com/Uniswap/contracts/tree/main/deployments", chain46630Entry:false}, packageVersions:{v3Core:"1.0.0",v3Periphery:"1.4.4",swapRouterContracts:"1.1.0"}, sourceUrls:{v3Core:"https://www.npmjs.com/package/@uniswap/v3-core/v/1.0.0",v3Periphery:"https://www.npmjs.com/package/@uniswap/v3-periphery/v/1.4.4",swapRouterContracts:"https://www.npmjs.com/package/@uniswap/swap-router-contracts/v/1.1.0"}, contracts:{weth9:$weth,factory:$factory,positionManager:$position,quoterV2:$quoter,swapRouter02:$router}, deploymentTransactions:{weth9:$wethTx,factory:$factoryTx,positionManager:$positionTx,quoterV2:$quoterTx,swapRouter02:$routerTx}, creationBytecodeHashes:{weth9:$wethCreation,factory:$factoryCreation,positionManager:$positionCreation,quoterV2:$quoterCreation,swapRouter02:$routerCreation}, runtimeCodeHashes:{weth9:$wethRuntime,factory:$factoryRuntime,positionManager:$positionRuntime,quoterV2:$quoterRuntime,swapRouter02:$routerRuntime}, artifactSha256:{weth9:$wethArtifact,factory:$factoryArtifact,positionManager:$positionArtifact,quoterV2:$quoterArtifact,swapRouter02:$routerArtifact}, constructorArguments:{weth9:$wethArgs,factory:$factoryArgs,positionManager:$positionArgs,quoterV2:$quoterArgs,swapRouter02:$routerArgs}, factoryConfiguration:{owner:$deployer,feeTiers:{"500":10,"3000":60,"10000":200}}}' >"$tmp"
mv "$tmp" "$manifest"
ROBYN_TESTNET_RPC_URL="$rpc_url" "$repo_root/scripts/verify-testnet-uniswap-v3.sh" "$manifest"
echo "Wrote $manifest"

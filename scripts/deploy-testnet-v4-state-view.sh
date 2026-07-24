#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
manifest="${ROBYN_TESTNET_V4_MANIFEST:-$repo_root/deployments/46630-uniswap-v4-shared.json}"
artifact="$repo_root/node_modules/@uniswap/v4-periphery/foundry-out/StateView.sol/StateView.json"
evidence_root="${ROBYN_EVIDENCE_ROOT:-/home/hendo420/robyn-evidence}"
output="${ROBYN_TESTNET_V4_STATEVIEW_EVIDENCE:-$evidence_root/46630-v4-state-view-candidate.json}"
expected_deployer="0xecc5d6d032ADc9ca9E0F4042128067b8366da17A"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

[[ "$(cast chain-id --rpc-url "$rpc_url")" == "46630" ]] || {
  echo "Refusing StateView work outside Robinhood Testnet chain 46630" >&2
  exit 1
}
[[ -f "$manifest" && -f "$artifact" ]] || {
  echo "The reviewed v4 manifest and pinned StateView artifact are required" >&2
  exit 1
}
[[ "$(jq -r '.chainId' "$manifest")" == "46630" ]] || {
  echo "The v4 manifest must target chain 46630" >&2
  exit 1
}
[[ "$(jq -r '.pinnedPackages.v4Periphery.version' "$manifest")" == "1.0.3" ]] || {
  echo "StateView must come from pinned @uniswap/v4-periphery 1.0.3" >&2
  exit 1
}

ROBYN_V4_ALLOW_PENDING=true scripts/verify-testnet-uniswap-v4.sh "$manifest" >/dev/null

pool_manager="$(jq -er '.contracts.poolManager.address' "$manifest")"
bytecode="$(jq -er '.bytecode.object // .bytecode' "$artifact")"
constructor_args="$(cast abi-encode 'constructor(address)' "$pool_manager")"
creation="${bytecode}${constructor_args#0x}"
artifact_sha256="$(sha256sum "$artifact" | awk '{print $1}')"
creation_hash="$(cast keccak "$creation")"
package_integrity="$(jq -er '.pinnedPackages.v4Periphery.integrity' "$manifest")"

keystore="${ROBYN_TESTNET_KEYSTORE:-${ROBYN_KEYSTORE:-}}"
password_file="${ROBYN_TESTNET_PASSWORD_FILE:-${ROBYN_PASSWORD_FILE:-}}"
if [[ -f "$keystore" && -f "$password_file" ]]; then
  deployer="$(cast wallet address --keystore "$keystore" --password-file "$password_file")"
else
  deployer="$expected_deployer"
fi
[[ "${deployer,,}" == "${expected_deployer,,}" ]] || {
  echo "StateView deployer must be the reviewed encrypted project wallet" >&2
  exit 1
}

gas_estimate="$(cast estimate --rpc-url "$rpc_url" --from "$deployer" --create "$creation")"
gas_limit=$(((gas_estimate * 125 + 99) / 100))
gas_price="$(cast gas-price --rpc-url "$rpc_url")"
execution_cost=$((gas_limit * gas_price))
l1_base_fee="$(cast call 0x000000000000000000000000000000000000006C \
  'getL1BaseFeeEstimate()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')"
calldata_bytes=$(((${#creation} - 2) / 2))
l1_data_gas=$(((calldata_bytes + 140) * 16))
l1_data_cost=$((l1_data_gas * l1_base_fee))
required_balance=$((execution_cost + l1_data_cost))
wallet_balance="$(cast balance "$deployer" --rpc-url "$rpc_url")"
[[ "$wallet_balance" -ge "$required_balance" ]] || {
  echo "Insufficient deployer balance for the 25%-headroom StateView estimate" >&2
  exit 1
}

mkdir -p "$(dirname "$output")"
tmp="$(mktemp "$(dirname "$output")/.state-view.XXXXXX")"
jq -n \
  --argjson schemaVersion 1 \
  --argjson chainId 46630 \
  --arg venue "$(jq -r '.venue' "$manifest")" \
  --arg poolManager "$pool_manager" \
  --arg deployer "$deployer" \
  --arg packageVersion "1.0.3" \
  --arg packageIntegrity "$package_integrity" \
  --arg sourcePath "src/lens/StateView.sol" \
  --arg artifactSha256 "$artifact_sha256" \
  --arg creationCodeHash "$creation_hash" \
  --arg constructorArguments "$constructor_args" \
  --argjson gasEstimate "$gas_estimate" \
  --argjson gasLimitWith25PercentHeadroom "$gas_limit" \
  --arg gasPriceWei "$gas_price" \
  --arg executionCostWei "$execution_cost" \
  --arg l1BaseFeeEstimateWei "$l1_base_fee" \
  --argjson l1DataGasUpperBound "$l1_data_gas" \
  --arg l1DataCostUpperBoundWei "$l1_data_cost" \
  --arg requiredBalanceWei "$required_balance" \
  --arg walletBalanceWei "$wallet_balance" \
  --arg gitCommit "$(git rev-parse HEAD)" \
  '{
    schemaVersion: $schemaVersion,
    status: "estimated-not-broadcast",
    chainId: $chainId,
    venue: $venue,
    contract: "StateView",
    poolManager: $poolManager,
    deployer: $deployer,
    package: {
      name: "@uniswap/v4-periphery",
      version: $packageVersion,
      integrity: $packageIntegrity,
      sourcePath: $sourcePath
    },
    artifactSha256: $artifactSha256,
    creationCodeHash: $creationCodeHash,
    constructorArguments: $constructorArguments,
    gas: {
      estimate: $gasEstimate,
      limitWith25PercentHeadroom: $gasLimitWith25PercentHeadroom,
      gasPriceWei: $gasPriceWei,
      executionCostWei: $executionCostWei,
      l1BaseFeeEstimateWei: $l1BaseFeeEstimateWei,
      l1DataGasUpperBound: $l1DataGasUpperBound,
      l1DataCostUpperBoundWei: $l1DataCostUpperBoundWei,
      requiredBalanceWei: $requiredBalanceWei,
      walletBalanceWei: $walletBalanceWei
    },
    gitCommit: $gitCommit
  }' >"$tmp"
mv "$tmp" "$output"

if [[ "${ROBYN_TESTNET_V4_STATEVIEW_BROADCAST:-false}" != "true" ]]; then
  echo "StateView estimate passed; no transaction broadcast. Evidence: $output"
  exit 0
fi

[[ -f "$keystore" && -f "$password_file" ]] || {
  echo "Readable testnet keystore and password files are required for broadcast" >&2
  exit 1
}
git fetch origin main >/dev/null
[[ -z "$(git status --porcelain)" &&
   "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || {
  echo "Real StateView deployment requires a clean exact origin/main commit" >&2
  exit 1
}
[[ "${ROBYN_TESTNET_V4_STATEVIEW_CONFIRM_CHAIN:-}" == "46630" ]] || {
  echo "Set ROBYN_TESTNET_V4_STATEVIEW_CONFIRM_CHAIN=46630 for explicit broadcast confirmation" >&2
  exit 1
}

receipt="$(cast send --rpc-url "$rpc_url" \
  --keystore "$keystore" --password-file "$password_file" \
  --gas-limit "$gas_limit" --json --create "$creation")"
tx_hash="$(jq -er '.transactionHash // .transaction_hash' <<<"$receipt")"
address="$(jq -er '.contractAddress // .contract_address' <<<"$receipt")"
block_number="$(jq -er '.blockNumber // .block_number' <<<"$receipt")"
runtime_code="$(cast code "$address" --rpc-url "$rpc_url")"
[[ "$runtime_code" != "0x" ]] || { echo "StateView deployment produced no code" >&2; exit 1; }
[[ "$(cast call "$address" 'poolManager()(address)' --rpc-url "$rpc_url")" == "$pool_manager" ]] || {
  echo "Deployed StateView PoolManager wiring mismatch" >&2
  exit 1
}
runtime_hash="$(cast keccak "$runtime_code")"

tmp="$(mktemp "$(dirname "$output")/.state-view.XXXXXX")"
jq \
  --arg status "broadcast-verified" \
  --arg address "$address" \
  --arg transactionHash "$tx_hash" \
  --argjson deploymentBlock "$block_number" \
  --arg runtimeCodeHash "$runtime_hash" \
  '.status = $status |
   .address = $address |
   .transactionHash = $transactionHash |
   .deploymentBlock = $deploymentBlock |
   .runtimeCodeHash = $runtimeCodeHash' "$output" >"$tmp"
mv "$tmp" "$output"
echo "StateView broadcast and wiring verified. Evidence: $output"

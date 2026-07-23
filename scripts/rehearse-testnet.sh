#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${ROBYN_TESTNET_REHEARSAL_PORT:-18545}"
rpc_url="http://127.0.0.1:$port"
evidence_path="${ROBYN_TESTNET_REHEARSAL_EVIDENCE:-}"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

work="$(mktemp -d)"
anvil --host 127.0.0.1 --port "$port" --chain-id 46630 --silent >"$work/anvil.log" 2>&1 &
anvil_pid=$!
cleanup() {
  kill "$anvil_pid" 2>/dev/null || true
  wait "$anvil_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
for _ in $(seq 1 100); do
  if cast chain-id --rpc-url "$rpc_url" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
[[ "$(cast chain-id --rpc-url "$rpc_url")" == "46630" ]]

manifest="$work/46630.json"
dex_manifest="$work/46630-uniswap-v3.json"
ROBYN_TESTNET_RPC_URL="$rpc_url" \
ROBYN_TESTNET_DEX_MANIFEST="$dex_manifest" \
ROBYN_TESTNET_REHEARSAL=true \
ROBYN_ALLOW_UNLOCKED_REHEARSAL=true \
ROBYN_TESTNET_DEX_BROADCAST=true \
  scripts/deploy-testnet-uniswap-v3.sh >/dev/null
ROBYN_TESTNET_RPC_URL="$rpc_url" \
ROBYN_TESTNET_MANIFEST="$manifest" \
ROBYN_TESTNET_DEX_MANIFEST="$dex_manifest" \
ROBYN_TESTNET_REHEARSAL=true \
ROBYN_ALLOW_UNLOCKED_REHEARSAL=true \
ROBYN_TESTNET_BROADCAST=true \
  scripts/deploy-testnet.sh >/dev/null

accounts="$(cast rpc eth_accounts --rpc-url "$rpc_url")"
user="$(jq -er '.[1]' <<<"$accounts")"
deployer="$(jq -er '.[0]' <<<"$accounts")"
base="$(jq -er '.contracts.baseAsset' "$manifest")"
wrapped_native="$(jq -er '.contracts.wrappedNative' "$manifest")"
token="$(jq -er '.contracts.genesisToken' "$manifest")"
vault="$(jq -er '.contracts.genesisVault' "$manifest")"
market="$(jq -er '.contracts.genesisMarket' "$manifest")"
fee_router="$(jq -er '.contracts.protocolFeeRouter' "$manifest")"
native_converter="$(jq -er '.contracts.nativeFeeConverter' "$manifest")"
dao_token="$(jq -er '.contracts.daoToken' "$manifest")"
mapfile -t rewards < <(jq -er '
  . as $manifest
  | .genesisBasket[]
  | .symbol as $symbol
  | $manifest.assetCatalog.assets[]
  | select(.mockSymbol == $symbol)
  | .address
' "$manifest")
router="$(jq -er '.contracts.routeRegistry' "$manifest")"

send_as_user() {
  cast send --rpc-url "$rpc_url" --from "$user" --unlocked --json "$@" |
    jq -e '.status == "0x1" or .status == 1' >/dev/null
}
send_as_deployer() {
  cast send --rpc-url "$rpc_url" --from "$deployer" --unlocked --json "$@" |
    jq -e '.status == "0x1" or .status == 1' >/dev/null
}
call_uint() {
  cast call "$1" "$2" "${@:3}" --rpc-url "$rpc_url" --json | jq -er '.[0]'
}

send_as_user "$base" 'claimFaucet(address)' "$user"
send_as_user "$base" 'approve(address,uint256)' "$market" "10000000000000000000000"
send_as_user "$market" 'buy(uint256,uint256)' "7000000000000000000000" "1"
[[ "$(cast call "$market" 'graduated()(bool)' --rpc-url "$rpc_url")" == "true" ]]
pool="$(jq -er '.contracts.genesisGraduatedPool' "$manifest")"
[[ "$(cast call "$pool" 'liquidity()(uint128)' --rpc-url "$rpc_url" | awk '{print $1}')" -gt 0 ]]

pending_before=()
for i in 0 1 2; do
  pending="$(cast call "$vault" 'leg(uint256)((address,uint16,uint256,uint256,uint256,uint256))' "$i" --rpc-url "$rpc_url" --json | jq -er '.[0][2]')"
  pending_before+=("$pending")
  quoted_output="$(cast call "$router" 'quoteExactInput(address,address,uint256)(uint256)' "$base" "${rewards[$i]}" "$pending" --from "$user" --rpc-url "$rpc_url" | awk '{print $1}')"
  minimum_output="$(python3 -c "print(int('$quoted_output') * 99 // 100)")"
  deadline=$(( $(date +%s) + 600 ))
  send_as_user "$vault" 'convertLeg(uint256,uint256,uint256,uint256)' "$i" "$pending" "$minimum_output" "$deadline"
done
send_as_user "$token" 'claimAll()'

send_as_user "$token" 'approve(address,uint256)' "$market" "100000000000000000000000"
send_as_user "$market" 'sell(uint256,uint256)' "100000000000000000000000" "1"

# Prove a bounded base-to-native batch while leaving excess fees queued for later safe retries.
cast rpc evm_increaseTime 61 --rpc-url "$rpc_url" >/dev/null
cast rpc evm_mine --rpc-url "$rpc_url" >/dev/null
maximum_native_batch="100000000000000000"
minimum_native="$(cast call "$native_converter" 'minimumSafeOutput(address,address,uint24,uint256)(uint256)' "$base" "$wrapped_native" "10000" "$maximum_native_batch" --from "$user" --rpc-url "$rpc_url" | awk '{print $1}')"
deadline=$(( $(date +%s) + 600 ))
send_as_user "$fee_router" 'convertPendingToNative(address,uint256,uint256,uint256)' "$token" "$maximum_native_batch" "$minimum_native" "$deadline"
dao_native_rewards="$(call_uint "$fee_router" 'totalDaoNativeRewards()(uint256)')"
treasury_native_rewards="$(call_uint "$fee_router" 'totalTreasuryNative()(uint256)')"
creator_account="$(cast call "$fee_router" 'launchAccount(address)((address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool))' "$token" --rpc-url "$rpc_url" --json)"
creator_claimable="$(jq -r '.[0][10]' <<<"$creator_account")"
member_claimable="$(call_uint "$dao_token" 'claimableRewardOf(address)(uint256)' "$deployer")"
[[ "$dao_native_rewards" != "0" && "$treasury_native_rewards" != "0" && "$creator_claimable" != "0" && "$member_claimable" != "0" ]]
send_as_deployer "$fee_router" 'claimCreatorFees(address)' "$token"
send_as_deployer "$dao_token" 'claimRewards()'

base_balance="$(call_uint "$base" 'balanceOf(address)(uint256)' "$user")"
token_balance="$(call_uint "$token" 'balanceOf(address)(uint256)' "$user")"
fees_received="$(call_uint "$vault" 'totalFeesReceived()(uint256)')"
base_consumed="$(call_uint "$vault" 'totalBaseConsumed()(uint256)')"
reward_balances=()
for reward in "${rewards[@]}"; do
  balance="$(call_uint "$reward" 'balanceOf(address)(uint256)' "$user")"
  [[ "$balance" != "0" ]] || { echo "User received no reward for $reward" >&2; exit 1; }
  reward_balances+=("$balance")
done
[[ "$base_balance" != "0" && "$token_balance" != "0" && "$fees_received" != "0" && "$base_consumed" != "0" ]]
ROBYN_TESTNET_RPC_URL="$rpc_url" scripts/verify-testnet-deployment.sh "$manifest" >/dev/null

summary="$(jq -n \
  --arg testedAt "$(date -u +%FT%TZ)" \
  --arg gitSha "$(git rev-parse HEAD)" \
  --argjson chainId 46630 \
  --argjson finalBlock "$(cast block-number --rpc-url "$rpc_url")" \
  --arg user "$user" \
  --argjson baseBalance "$base_balance" \
  --argjson tokenBalance "$token_balance" \
  --argjson feesReceived "$fees_received" \
  --argjson baseConsumed "$base_consumed" \
  --argjson pending0 "${pending_before[0]}" \
  --argjson pending1 "${pending_before[1]}" \
  --argjson pending2 "${pending_before[2]}" \
  --argjson reward0 "${reward_balances[0]}" \
  --argjson reward1 "${reward_balances[1]}" \
  --argjson reward2 "${reward_balances[2]}" \
  --argjson daoNativeRewards "$dao_native_rewards" \
  --argjson treasuryNativeRewards "$treasury_native_rewards" \
  --argjson creatorNativeClaim "$creator_claimable" \
  --argjson memberNativeClaim "$member_claimable" \
  '{schemaVersion: 6, testedAt: $testedAt, gitSha: $gitSha, chainId: $chainId, passed: true, dexProvenance:"robyn-controlled-uniswap-v3-testnet", assetCatalogSize:24, user: $user, journey: {faucet: true, atomicLaunch: true, bondingBuy: true, automaticGraduation: true, postGraduationSell: true, convertAllLegs: true, claimAll: true, boundedNativeConversion: true, creatorNativeClaim: true, rdaoNativeClaim: true}, balances: {base: $baseBalance, token: $tokenBalance, rewards: [$reward0,$reward1,$reward2]}, accounting: {feesReceived: $feesReceived, baseConsumed: $baseConsumed, convertedPending: [$pending0,$pending1,$pending2], daoNativeRewards:$daoNativeRewards, treasuryNativeRewards:$treasuryNativeRewards, creatorNativeClaim:$creatorNativeClaim, memberNativeClaim:$memberNativeClaim}}')"
if [[ -n "$evidence_path" ]]; then
  mkdir -p "$(dirname "$evidence_path")"
  printf '%s\n' "$summary" > "$evidence_path"
fi
if [[ -n "${ROBYN_TESTNET_REHEARSAL_MANIFEST_OUTPUT:-}" ]]; then
  mkdir -p "$(dirname "$ROBYN_TESTNET_REHEARSAL_MANIFEST_OUTPUT")"
  cp "$manifest" "$ROBYN_TESTNET_REHEARSAL_MANIFEST_OUTPUT"
fi
printf '%s\n' "$summary"

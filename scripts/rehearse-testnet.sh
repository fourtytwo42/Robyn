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
base="$(jq -er '.contracts.baseAsset' "$manifest")"
token="$(jq -er '.contracts.genesisToken' "$manifest")"
vault="$(jq -er '.contracts.genesisVault' "$manifest")"
market="$(jq -er '.contracts.genesisMarket' "$manifest")"
mapfile -t rewards < <(jq -er '.contracts.rewardAssets[]' "$manifest")

send_as_user() {
  cast send --rpc-url "$rpc_url" --from "$user" --unlocked --json "$@" |
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
  rate=$((i + 1))
  minimum_output="$(python3 -c "print(int('$pending') * $rate)")"
  deadline=$(( $(date +%s) + 600 ))
  send_as_user "$vault" 'convertLeg(uint256,uint256,uint256,uint256)' "$i" "$pending" "$minimum_output" "$deadline"
done
send_as_user "$token" 'claimAll()'

send_as_user "$token" 'approve(address,uint256)' "$market" "100000000000000000000000"
send_as_user "$market" 'sell(uint256,uint256)' "100000000000000000000000" "1"

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
  '{schemaVersion: 2, testedAt: $testedAt, gitSha: $gitSha, chainId: $chainId, passed: true, dexProvenance:"robyn-controlled-uniswap-v3-testnet", user: $user, journey: {faucet: true, atomicLaunch: true, bondingBuy: true, automaticGraduation: true, postGraduationSell: true, convertAllLegs: true, claimAll: true}, balances: {base: $baseBalance, token: $tokenBalance, rewards: [$reward0,$reward1,$reward2]}, accounting: {feesReceived: $feesReceived, baseConsumed: $baseConsumed, convertedPending: [$pending0,$pending1,$pending2]}}')"
if [[ -n "$evidence_path" ]]; then
  mkdir -p "$(dirname "$evidence_path")"
  printf '%s\n' "$summary" > "$evidence_path"
fi
if [[ -n "${ROBYN_TESTNET_REHEARSAL_MANIFEST_OUTPUT:-}" ]]; then
  mkdir -p "$(dirname "$ROBYN_TESTNET_REHEARSAL_MANIFEST_OUTPUT")"
  cp "$manifest" "$ROBYN_TESTNET_REHEARSAL_MANIFEST_OUTPUT"
fi
printf '%s\n' "$summary"

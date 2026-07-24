#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
manifest="${ROBYN_TESTNET_MANIFEST:-$repo_root/deployments/46630.json}"
operator_key_file="${ROBYN_TESTNET_OPERATOR_KEY_FILE:-$HOME/.config/robyn/testnet/operator.key}"
evidence_path="${ROBYN_TESTNET_SMOKE_EVIDENCE:-$HOME/robyn-evidence/testnet-live-smoke/summary.json}"
pause_keeper="${ROBYN_TESTNET_PAUSE_KEEPER_FOR_SMOKE:-false}"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

[[ "${ROBYN_TESTNET_LIVE_SMOKE:-false}" == "true" ]] || {
  echo "Set ROBYN_TESTNET_LIVE_SMOKE=true to authorize the chain-46630 smoke transactions" >&2
  exit 1
}
[[ "$(cast chain-id --rpc-url "$rpc_url")" == "46630" ]] || {
  echo "Refusing live smoke outside Robinhood Testnet chain 46630" >&2
  exit 1
}
[[ -f "$manifest" && "$(jq -r '.chainId' "$manifest")" == "46630" ]] || {
  echo "A chain-46630 deployment manifest is required" >&2
  exit 1
}
[[ -f "$operator_key_file" ]] || {
  echo "A protected testnet operator key file is required" >&2
  exit 1
}
[[ -z "$(git status --porcelain)" && "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || {
  echo "Live smoke requires a clean exact origin/main checkout" >&2
  exit 1
}

keystore="${ROBYN_TESTNET_KEYSTORE:-}"
password_file="${ROBYN_TESTNET_PASSWORD_FILE:-}"
[[ -f "$keystore" && -f "$password_file" ]] || {
  echo "Readable deployer keystore and password files are required" >&2
  exit 1
}

operator_private_key="$(tr -d '\r\n' <"$operator_key_file")"
operator="$(cast wallet address --private-key "$operator_private_key")"
deployer="$(cast wallet address --keystore "$keystore" --password-file "$password_file")"
[[ "${operator,,}" != "${deployer,,}" ]] || {
  echo "Operator and deployer must be separate wallets" >&2
  exit 1
}

base="$(jq -er '.contracts.baseAsset' "$manifest")"
wrapped_native="$(jq -er '.contracts.wrappedNative' "$manifest")"
token="$(jq -er '.contracts.genesisToken' "$manifest")"
vault="$(jq -er '.contracts.genesisVault' "$manifest")"
market="$(jq -er '.contracts.genesisMarket' "$manifest")"
pool="$(jq -er '.contracts.genesisGraduatedPool' "$manifest")"
fee_router="$(jq -er '.contracts.protocolFeeRouter' "$manifest")"
native_converter="$(jq -er '.contracts.nativeFeeConverter' "$manifest")"
dao_token="$(jq -er '.contracts.daoToken' "$manifest")"
route_registry="$(jq -er '.contracts.routeRegistry' "$manifest")"
mapfile -t rewards < <(
  jq -er '
    . as $manifest
    | .genesisBasket[]
    | .symbol as $symbol
    | $manifest.assetCatalog.assets[]
    | select(.mockSymbol == $symbol)
    | .address
  ' "$manifest"
)
[[ "${#rewards[@]}" -eq 3 ]] || {
  echo "Genesis basket must contain exactly three reward assets" >&2
  exit 1
}

[[ "$(cast call "$market" 'graduated()(bool)' --rpc-url "$rpc_url")" == "false" ]] || {
  echo "Genesis market is already graduated; live smoke is intentionally one-shot" >&2
  exit 1
}

keeper_was_paused=false
restore_keeper() {
  if [[ "$keeper_was_paused" == "true" ]]; then
    "$repo_root/node_modules/.bin/pm2" start robyn-keeper-testnet >/dev/null 2>&1 || true
    "$repo_root/node_modules/.bin/pm2" save >/dev/null 2>&1 || true
  fi
}
trap restore_keeper EXIT
if [[ "$pause_keeper" == "true" ]]; then
  "$repo_root/node_modules/.bin/pm2" stop robyn-keeper-testnet >/dev/null
  keeper_was_paused=true
fi

declare -A txs
send_operator() {
  local label="$1"
  shift
  local receipt
  receipt="$(cast send --rpc-url "$rpc_url" --private-key "$operator_private_key" --json "$@")"
  jq -e '.status == "0x1" or .status == 1' <<<"$receipt" >/dev/null
  txs["$label"]="$(jq -er '.transactionHash' <<<"$receipt")"
}
send_deployer() {
  local label="$1"
  shift
  local receipt
  receipt="$(cast send --rpc-url "$rpc_url" --keystore "$keystore" --password-file "$password_file" --json "$@")"
  jq -e '.status == "0x1" or .status == 1' <<<"$receipt" >/dev/null
  txs["$label"]="$(jq -er '.transactionHash' <<<"$receipt")"
}
call_uint() {
  cast call "$1" "$2" "${@:3}" --rpc-url "$rpc_url" --json | jq -er '.[0]'
}

send_operator faucet "$base" 'claimFaucet(address)' "$operator"
send_operator approve_base "$base" 'approve(address,uint256)' "$market" "10000000000000000000000"
send_operator bonding_buy "$market" 'buy(uint256,uint256)' "7000000000000000000000" "1"

[[ "$(cast call "$market" 'graduated()(bool)' --rpc-url "$rpc_url")" == "true" ]] || {
  echo "Bonding buy did not trigger graduation" >&2
  exit 1
}
[[ "$(cast call "$pool" 'liquidity()(uint128)' --rpc-url "$rpc_url" | awk '{print $1}')" -gt 0 ]] || {
  echo "Graduated pool has no liquidity" >&2
  exit 1
}

pending_before=()
for i in 0 1 2; do
  pending="$(cast call "$vault" 'leg(uint256)((address,uint16,uint256,uint256,uint256,uint256))' "$i" --rpc-url "$rpc_url" --json | jq -er '.[0][2]')"
  pending_before+=("$pending")
  if [[ "$pending" != "0" ]]; then
    quoted_output="$(cast call "$route_registry" 'quoteExactInput(address,address,uint256)(uint256)' "$base" "${rewards[$i]}" "$pending" --from "$operator" --rpc-url "$rpc_url" | awk '{print $1}')"
    minimum_output="$(python3 -c "print(int('$quoted_output') * 99 // 100)")"
    deadline="$(( $(date +%s) + 900 ))"
    send_operator "convert_leg_$i" "$vault" 'convertLeg(uint256,uint256,uint256,uint256)' "$i" "$pending" "$minimum_output" "$deadline"
  fi
done

reward_before=()
for reward in "${rewards[@]}"; do
  reward_before+=("$(call_uint "$reward" 'balanceOf(address)(uint256)' "$operator")")
done
send_operator holder_claim "$token" 'claimAll()'
reward_after=()
for i in 0 1 2; do
  reward_after+=("$(call_uint "${rewards[$i]}" 'balanceOf(address)(uint256)' "$operator")")
  python3 -c "assert int('${reward_after[$i]}') > int('${reward_before[$i]}')" || {
    echo "Holder reward claim did not increase reward leg $i" >&2
    exit 1
  }
done

send_operator approve_token "$token" 'approve(address,uint256)' "$market" "100000000000000000000000"
send_operator post_graduation_sell "$market" 'sell(uint256,uint256)' "100000000000000000000000" "1"

maximum_native_batch="100000000000000000"
minimum_native="$(cast call "$native_converter" 'minimumSafeOutput(address,address,uint24,uint256)(uint256)' "$base" "$wrapped_native" "10000" "$maximum_native_batch" --from "$operator" --rpc-url "$rpc_url" | awk '{print $1}')"
deadline="$(( $(date +%s) + 900 ))"
send_operator native_conversion "$fee_router" 'convertPendingToNative(address,uint256,uint256,uint256)' "$token" "$maximum_native_batch" "$minimum_native" "$deadline"

creator_account="$(cast call "$fee_router" 'launchAccount(address)((address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool))' "$token" --rpc-url "$rpc_url" --json)"
creator_claimable="$(jq -er '.[0][10]' <<<"$creator_account")"
member_claimable="$(call_uint "$dao_token" 'claimableRewardOf(address)(uint256)' "$deployer")"
[[ "$creator_claimable" != "0" && "$member_claimable" != "0" ]] || {
  echo "Native conversion did not create both creator and RDAO claim liabilities" >&2
  exit 1
}
send_deployer creator_claim "$fee_router" 'claimCreatorFees(address)' "$token"
send_deployer rdao_claim "$dao_token" 'claimRewards()'

if [[ "$keeper_was_paused" == "true" ]]; then
  "$repo_root/node_modules/.bin/pm2" start robyn-keeper-testnet >/dev/null
  "$repo_root/node_modules/.bin/pm2" save >/dev/null
  keeper_was_paused=false
fi

ROBYN_TESTNET_RPC_URL="$rpc_url" scripts/verify-testnet-deployment.sh "$manifest" >/dev/null
final_block="$(cast block-number --rpc-url "$rpc_url")"
mkdir -p "$(dirname "$evidence_path")"
jq -n \
  --arg testedAt "$(date -u +%FT%TZ)" \
  --arg gitSha "$(git rev-parse HEAD)" \
  --arg operator "$operator" \
  --arg deployer "$deployer" \
  --argjson finalBlock "$final_block" \
  --arg faucet "${txs[faucet]}" \
  --arg approveBase "${txs[approve_base]}" \
  --arg bondingBuy "${txs[bonding_buy]}" \
  --arg convertLeg0 "${txs[convert_leg_0]:-}" \
  --arg convertLeg1 "${txs[convert_leg_1]:-}" \
  --arg convertLeg2 "${txs[convert_leg_2]:-}" \
  --arg holderClaim "${txs[holder_claim]}" \
  --arg approveToken "${txs[approve_token]}" \
  --arg postGraduationSell "${txs[post_graduation_sell]}" \
  --arg nativeConversion "${txs[native_conversion]}" \
  --arg creatorClaim "${txs[creator_claim]}" \
  --arg rdaoClaim "${txs[rdao_claim]}" \
  --argjson pending0 "${pending_before[0]}" \
  --argjson pending1 "${pending_before[1]}" \
  --argjson pending2 "${pending_before[2]}" \
  --argjson reward0 "${reward_after[0]}" \
  --argjson reward1 "${reward_after[1]}" \
  --argjson reward2 "${reward_after[2]}" \
  --argjson creatorClaimable "$creator_claimable" \
  --argjson memberClaimable "$member_claimable" \
  '{
    schemaVersion: 1,
    testedAt: $testedAt,
    gitSha: $gitSha,
    chainId: 46630,
    passed: true,
    operator: $operator,
    deployer: $deployer,
    finalBlock: $finalBlock,
    transactions: {
      faucet: $faucet,
      approveBase: $approveBase,
      bondingBuy: $bondingBuy,
      convertLegs: [$convertLeg0, $convertLeg1, $convertLeg2],
      holderClaim: $holderClaim,
      approveToken: $approveToken,
      postGraduationSell: $postGraduationSell,
      nativeConversion: $nativeConversion,
      creatorClaim: $creatorClaim,
      rdaoClaim: $rdaoClaim
    },
    journey: {
      faucet: true,
      bondingBuy: true,
      automaticGraduation: true,
      lockedPoolLiquidity: true,
      basketConversions: true,
      holderClaim: true,
      postGraduationSell: true,
      nativeConversion: true,
      creatorClaim: true,
      rdaoClaim: true,
      independentDeploymentVerification: true
    },
    accounting: {
      pendingBaseBeforeConversion: [$pending0, $pending1, $pending2],
      holderRewardBalances: [$reward0, $reward1, $reward2],
      creatorNativeClaimableBeforeClaim: $creatorClaimable,
      memberNativeClaimableBeforeClaim: $memberClaimable
    }
  }' >"$evidence_path"
sha256sum "$evidence_path" >"${evidence_path}.sha256"
printf 'Live Robinhood Testnet smoke passed. Evidence: %s\n' "$evidence_path"

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_TESTNET_RPC_URL:?ROBYN_TESTNET_RPC_URL is required}"
manifest="${ROBYN_TESTNET_V4_PROTOCOL_MANIFEST:?ROBYN_TESTNET_V4_PROTOCOL_MANIFEST is required}"
evidence="${ROBYN_TESTNET_V4_SMOKE_EVIDENCE:-$repo_root/evidence/46630-v4-smoke.json}"
allow_live="${ROBYN_TESTNET_V4_SMOKE_ALLOW_LIVE:-false}"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

[[ -f "$manifest" ]] || { echo "Deployment manifest not found: $manifest" >&2; exit 1; }
[[ "$(cast chain-id --rpc-url "$rpc_url")" == "46630" ]] || {
  echo "Refusing v4 protocol smoke outside chain 46630" >&2
  exit 1
}

if [[ ! "$rpc_url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]]; then
  [[ "$allow_live" == "true" ]] || {
    echo "Live smoke requires ROBYN_TESTNET_V4_SMOKE_ALLOW_LIVE=true" >&2
    exit 1
  }
  echo "This script currently supports only an unlocked isolated rehearsal account" >&2
  exit 1
fi

account="$(
  if [[ -n "${ROBYN_TESTNET_V4_SMOKE_ACCOUNT:-}" ]]; then
    cast to-check-sum-address "$ROBYN_TESTNET_V4_SMOKE_ACCOUNT"
  else
    cast rpc eth_accounts --rpc-url "$rpc_url" | jq -er '.[0]'
  fi
)"
wallet_args=(--from "$account" --unlocked)
router="$(jq -er '.contracts.assetRouter' "$manifest")"
market="$(jq -er '.genesis.market' "$manifest")"
token="$(jq -er '.genesis.token' "$manifest")"
vault="$(jq -er '.genesis.vault' "$manifest")"
fee_router="$(jq -er '.contracts.protocolFeeRouter' "$manifest")"
dao_token="$(jq -er '.contracts.daoToken' "$manifest")"
locker="$(jq -er '.genesis.positionLocker' "$manifest")"

declare -a transactions=()
send() {
  local receipt
  receipt="$(cast send --rpc-url "$rpc_url" "${wallet_args[@]}" --json "$@")"
  local status
  status="$(jq -r '.status' <<<"$receipt")"
  [[ "$status" == "0x1" || "$status" == "1" ]] || {
    echo "Transaction failed: $*" >&2
    jq . <<<"$receipt" >&2
    exit 1
  }
  local hash
  hash="$(jq -er '.transactionHash // .transaction_hash' <<<"$receipt")"
  transactions+=("$hash")
  printf '%s\n' "$hash"
}

quote_first() {
  awk 'NR == 1 { print $1 }'
}

minimum_99() {
  node -e 'console.log((BigInt(process.argv[1]) * 99n / 100n).toString())' "$1"
}

route_results='[]'
while IFS=$'\t' read -r symbol asset; do
  status="$(cast call "$router" \
    'routeStatus(address)((bytes32,uint128,uint128,uint128,bytes32,uint24,int24,address,bool,bytes32))' \
    "$asset" --rpc-url "$rpc_url")"
  [[ "$status" == *"true"* ]] || { echo "$symbol route is not ready" >&2; exit 1; }

  native_in=1000000000
  before="$(cast call "$asset" 'balanceOf(address)(uint256)' "$account" --rpc-url "$rpc_url" | quote_first)"
  quote="$(cast call "$router" 'quoteNativeToAsset(address,uint128)(uint256,uint256)' \
    "$asset" "$native_in" --rpc-url "$rpc_url" | quote_first)"
  minimum="$(minimum_99 "$quote")"
  deadline="$(( $(date +%s) + 600 ))"
  buy_tx="$(send "$router" 'swapExactNativeForAsset(address,uint256,address,uint256)' \
    "$asset" "$minimum" "$account" "$deadline" --value "$native_in")"
  after="$(cast call "$asset" 'balanceOf(address)(uint256)' "$account" --rpc-url "$rpc_url" | quote_first)"
  acquired="$(node -e 'console.log((BigInt(process.argv[2])-BigInt(process.argv[1])).toString())' "$before" "$after")"
  [[ "$acquired" -ge "$minimum" ]] || { echo "$symbol output delta is below minimum" >&2; exit 1; }

  sell_amount="$(node -e 'console.log((BigInt(process.argv[1])/2n).toString())' "$acquired")"
  approve_tx="$(send "$asset" 'approve(address,uint256)' "$router" "$sell_amount")"
  reverse_quote="$(cast call "$router" 'quoteAssetToNative(address,uint128)(uint256,uint256)' \
    "$asset" "$sell_amount" --from "$account" --rpc-url "$rpc_url" | quote_first)"
  reverse_minimum="$(minimum_99 "$reverse_quote")"
  sell_tx="$(send "$router" 'swapExactAssetForNative(address,uint128,uint256,address,uint256)' \
    "$asset" "$sell_amount" "$reverse_minimum" "$account" "$deadline")"
  allowance="$(cast call "$asset" 'allowance(address,address)(uint256)' \
    "$account" "$router" --rpc-url "$rpc_url" | quote_first)"
  [[ "$allowance" == "0" ]] || { echo "$symbol allowance was not fully consumed" >&2; exit 1; }

  route_results="$(jq \
    --arg symbol "$symbol" --arg asset "$asset" --arg acquired "$acquired" \
    --arg nativeToAsset "$buy_tx" --arg approval "$approve_tx" --arg assetToNative "$sell_tx" \
    '. + [{symbol:$symbol,asset:$asset,acquired:$acquired,transactions:{
      nativeToAsset:$nativeToAsset,approval:$approval,assetToNative:$assetToNative
    }}]' <<<"$route_results")"
done < <(jq -r '.assetRoutes[] | [.symbol,.address] | @tsv' "$manifest")

[[ "$(cast call "$market" 'graduated()(bool)' --rpc-url "$rpc_url")" == "false" ]] || {
  echo "Genesis market was already graduated; use a fresh rehearsal" >&2
  exit 1
}
graduation_tx="$(send "$market" 'buy(uint256)' 1 --value 3000000000000000 --gas-limit 12000000)"
[[ "$(cast call "$market" 'graduated()(bool)' --rpc-url "$rpc_url")" == "true" ]] || {
  echo "Bonding buy did not graduate the market" >&2
  exit 1
}
[[ "$(cast call "$market" 'graduationProgressBps()(uint256)' --rpc-url "$rpc_url" | quote_first)" == "10000" ]] || {
  echo "Graduated market does not report complete progress" >&2
  exit 1
}

position_id="$(cast call "$locker" 'positionTokenId()(uint256)' --rpc-url "$rpc_url" | quote_first)"
[[ "$position_id" != "0" ]] || { echo "Graduation did not lock a position" >&2; exit 1; }
position_manager="$(jq -er '.contracts.positionManager' "$manifest")"
owner="$(cast call "$position_manager" 'ownerOf(uint256)(address)' "$position_id" --rpc-url "$rpc_url")"
[[ "${owner,,}" == "${locker,,}" ]] || { echo "Locker does not own the position NFT" >&2; exit 1; }

post_buy_in=10000000000
post_quote="$(cast call "$market" 'quoteBuy(uint256)(uint256,uint256)' \
  "$post_buy_in" --rpc-url "$rpc_url" | awk 'NR == 2 { print $1 }')"
post_minimum="$(minimum_99 "$post_quote")"
post_buy_tx="$(send "$market" 'buy(uint256)' "$post_minimum" --value "$post_buy_in")"

sell_amount=100000000000000000000
approval_tx="$(send "$token" 'approve(address,uint256)' "$market" "$sell_amount")"
sell_quote="$(cast call "$market" 'quoteSell(uint256)(uint256,uint256)' \
  "$sell_amount" --from "$account" --rpc-url "$rpc_url" | awk 'NR == 2 { print $1 }')"
sell_minimum="$(minimum_99 "$sell_quote")"
post_sell_tx="$(send "$market" 'sell(uint256,uint256)' "$sell_amount" "$sell_minimum")"

conversion_results='[]'
for index in 0 1 2; do
  asset="$(cast call "$token" 'rewardAsset(uint256)(address)' "$index" --rpc-url "$rpc_url")"
  pending="$(cast call "$vault" 'leg(uint256)((address,uint16,uint256,uint256,uint256,uint256))' \
    "$index" --rpc-url "$rpc_url" | tr -d '()' | cut -d, -f3 | awk '{print $1}')"
  amount=1000000000000
  [[ "$pending" -ge "$amount" ]] || { echo "Basket leg $index lacks bounded pending native" >&2; exit 1; }
  output="$(cast call "$router" 'quoteNativeToAsset(address,uint128)(uint256,uint256)' \
    "$asset" "$amount" --rpc-url "$rpc_url" | quote_first)"
  minimum="$(minimum_99 "$output")"
  deadline="$(( $(date +%s) + 600 ))"
  conversion_tx="$(send "$vault" 'convertLeg(uint256,uint256,uint256,uint256)' \
    "$index" "$amount" "$minimum" "$deadline")"
  claimable="$(cast call "$token" 'withdrawableRewardOf(address,uint256)(uint256)' \
    "$account" "$index" --rpc-url "$rpc_url" | quote_first)"
  [[ "$claimable" -gt 0 ]] || { echo "Basket leg $index created no holder reward" >&2; exit 1; }
  claim_tx="$(send "$token" 'claim(uint256)' "$index")"
  conversion_results="$(jq \
    --argjson index "$index" --arg asset "$asset" --arg amount "$amount" \
    --arg output "$output" --arg conversion "$conversion_tx" --arg claim "$claim_tx" \
    '. + [{index:$index,asset:$asset,nativeInput:$amount,quotedOutput:$output,
      transactions:{conversion:$conversion,holderClaim:$claim}}]' <<<"$conversion_results")"
done

creator_claimable="$(cast call "$fee_router" \
  'launchAccount(address)((address,address,address,address,uint256,uint256,uint256,uint256,uint256,bool))' \
  "$token" --rpc-url "$rpc_url" | tr -d '()' | cut -d, -f7 | awk '{print $1}')"
[[ "$creator_claimable" -gt 0 ]] || { echo "Creator reward was not accrued" >&2; exit 1; }
creator_claim_tx="$(send "$fee_router" 'claimCreatorFees(address)' "$token")"
dao_claimable="$(cast call "$dao_token" 'claimableRewardOf(address)(uint256)' \
  "$account" --rpc-url "$rpc_url" | quote_first)"
[[ "$dao_claimable" -gt 0 ]] || { echo "RDAO reward was not accrued" >&2; exit 1; }
dao_claim_tx="$(send "$dao_token" 'claimRewards()')"

creator_liability="$(cast call "$fee_router" 'totalCreatorNativeLiability()(uint256)' \
  --rpc-url "$rpc_url" | quote_first)"
router_balance="$(cast balance "$fee_router" --rpc-url "$rpc_url")"
[[ "$router_balance" -ge "$creator_liability" ]] || {
  echo "Protocol fee router is insolvent" >&2
  exit 1
}

mkdir -p "$(dirname "$evidence")"
tmp="$(mktemp "$(dirname "$evidence")/.v4-smoke.XXXXXX")"
jq -n \
  --arg status "passed" \
  --arg gitCommit "$(git rev-parse HEAD)" \
  --argjson chainId 46630 \
  --arg account "$account" \
  --arg manifestSha256 "$(sha256sum "$manifest" | awk '{print $1}')" \
  --argjson routeResults "$route_results" \
  --arg graduation "$graduation_tx" \
  --arg postBuy "$post_buy_tx" \
  --arg approval "$approval_tx" \
  --arg postSell "$post_sell_tx" \
  --arg positionTokenId "$position_id" \
  --argjson conversions "$conversion_results" \
  --arg creatorClaim "$creator_claim_tx" \
  --arg daoClaim "$dao_claim_tx" \
  --arg creatorLiability "$creator_liability" \
  --arg feeRouterBalance "$router_balance" \
  '{
    status:$status,gitCommit:$gitCommit,chainId:$chainId,account:$account,
    manifestSha256:$manifestSha256,routeResults:$routeResults,
    market:{graduationTransaction:$graduation,postGraduationBuy:$postBuy,
      postGraduationApproval:$approval,postGraduationSell:$postSell,
      positionTokenId:$positionTokenId},
    basketConversions:$conversions,
    claims:{creator:$creatorClaim,rdao:$daoClaim},
    solvency:{creatorLiability:$creatorLiability,feeRouterBalance:$feeRouterBalance}
  }' >"$tmp"
mv "$tmp" "$evidence"
sha256sum "$evidence" >"$evidence.sha256"
jq . "$evidence"

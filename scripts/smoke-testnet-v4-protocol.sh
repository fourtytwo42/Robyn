#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_TESTNET_RPC_URL:?ROBYN_TESTNET_RPC_URL is required}"
manifest="${ROBYN_TESTNET_V4_PROTOCOL_MANIFEST:?ROBYN_TESTNET_V4_PROTOCOL_MANIFEST is required}"
evidence="${ROBYN_TESTNET_V4_SMOKE_EVIDENCE:-$repo_root/evidence/46630-v4-smoke.json}"
allow_live="${ROBYN_TESTNET_V4_SMOKE_ALLOW_LIVE:-false}"
minimum_final_balance_wei="${ROBYN_TESTNET_V4_SMOKE_MINIMUM_FINAL_BALANCE_WEI:-1500000000000000}"
journal="${ROBYN_TESTNET_V4_SMOKE_JOURNAL:-$evidence.journal.jsonl}"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

[[ -f "$manifest" ]] || { echo "Deployment manifest not found: $manifest" >&2; exit 1; }
[[ "$(cast chain-id --rpc-url "$rpc_url")" == "46630" ]] || {
  echo "Refusing v4 protocol smoke outside chain 46630" >&2
  exit 1
}

umask 077
live=false
if [[ "$rpc_url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]]; then
  account="$(
    if [[ -n "${ROBYN_TESTNET_V4_SMOKE_ACCOUNT:-}" ]]; then
      cast to-check-sum-address "$ROBYN_TESTNET_V4_SMOKE_ACCOUNT"
    else
      cast to-check-sum-address "$(jq -er '.deployer' "$manifest")"
    fi
  )"
  wallet_args=(--from "$account" --unlocked)
else
  live=true
  [[ "$allow_live" == "true" ]] || {
    echo "Live smoke requires ROBYN_TESTNET_V4_SMOKE_ALLOW_LIVE=true" >&2
    exit 1
  }
  keystore="${ROBYN_TESTNET_KEYSTORE:-${ROBYN_KEYSTORE:-}}"
  password_file="${ROBYN_TESTNET_PASSWORD_FILE:-${ROBYN_PASSWORD_FILE:-}}"
  [[ -f "$keystore" && -f "$password_file" ]] || {
    echo "Live smoke requires the protected testnet keystore and password file" >&2
    exit 1
  }
  account="$(cast wallet address --keystore "$keystore" --password-file "$password_file")"
  [[ "${account,,}" == "$(jq -er '.deployer' "$manifest" | tr '[:upper:]' '[:lower:]')" ]] || {
    echo "Live smoke keystore does not match the deployment creator" >&2
    exit 1
  }
  git fetch origin main >/dev/null
  [[ -z "$(git status --porcelain)" && "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || {
    echo "Live smoke requires a clean exact origin/main commit" >&2
    exit 1
  }
  wallet_args=(--keystore "$keystore" --password-file "$password_file")
  threshold_native="$(jq -er '.market.graduationThresholdNative' "$manifest")"
  starting_balance="$(cast balance "$account" --rpc-url "$rpc_url")"
  required_starting_balance="$(node -e \
    'console.log((BigInt(process.argv[1])+BigInt(process.argv[2])+500000000000000n).toString())' \
    "$threshold_native" "$minimum_final_balance_wei")"
  [[ "$starting_balance" -ge "$required_starting_balance" ]] || {
    echo "Live smoke balance cannot cover graduation, gas headroom, and the final reserve" >&2
    exit 1
  }
fi

[[ ! -e "$journal" ]] || {
  echo "Smoke journal already exists; reconcile it instead of replaying: $journal" >&2
  exit 1
}
mkdir -p "$(dirname "$journal")"
: >"$journal"
router="$(jq -er '.contracts.assetRouter' "$manifest")"
market="$(jq -er '.genesis.market' "$manifest")"
token="$(jq -er '.genesis.token' "$manifest")"
vault="$(jq -er '.genesis.vault' "$manifest")"
fee_router="$(jq -er '.contracts.protocolFeeRouter' "$manifest")"
dao_token="$(jq -er '.contracts.daoToken' "$manifest")"
locker="$(jq -er '.genesis.positionLocker' "$manifest")"

declare -a transactions=()
send() {
  local sequence hash receipt status
  sequence="$(( $(grep -c '"state":"submitted"' "$journal" || true) + 1 ))"
  hash="$(cast send --rpc-url "$rpc_url" "${wallet_args[@]}" --async "$@")"
  jq -nc --arg state submitted --argjson sequence "$sequence" --arg hash "$hash" \
    --arg submittedAt "$(date -u +%FT%TZ)" \
    '{state:$state,sequence:$sequence,hash:$hash,submittedAt:$submittedAt}' >>"$journal"
  receipt=''
  for _ in {1..240}; do
    if receipt="$(cast receipt "$hash" --rpc-url "$rpc_url" --json 2>/dev/null)"; then
      break
    fi
    sleep 0.5
  done
  [[ -n "$receipt" ]] || {
    echo "Timed out waiting for submitted transaction $hash" >&2
    exit 1
  }
  local status
  status="$(jq -r '.status' <<<"$receipt")"
  [[ "$status" == "0x1" || "$status" == "1" ]] || {
    echo "Transaction failed: $hash" >&2
    jq . <<<"$receipt" >&2
    exit 1
  }
  jq -nc --arg state confirmed --argjson sequence "$sequence" --arg hash "$hash" \
    --arg blockNumber "$(jq -er '.blockNumber' <<<"$receipt")" \
    --arg gasUsed "$(jq -er '.gasUsed' <<<"$receipt")" \
    --arg confirmedAt "$(date -u +%FT%TZ)" \
    '{state:$state,sequence:$sequence,hash:$hash,blockNumber:$blockNumber,
      gasUsed:$gasUsed,confirmedAt:$confirmedAt}' >>"$journal"
  transactions+=("$hash")
  printf '%s\n' "$hash"
}

quote_first() {
  awk 'NR == 1 { print $1 }'
}

minimum_99() {
  node -e 'console.log((BigInt(process.argv[1]) * 99n / 100n).toString())' "$1"
}

chain_deadline() {
  local timestamp
  timestamp="$(cast block latest --field timestamp --rpc-url "$rpc_url")"
  printf '%s\n' "$(( timestamp + 600 ))"
}
route_results='[]'
while IFS=$'\t' read -r symbol asset; do
  status="$(cast call "$router" \
    'executionRouteStatus(address)((uint8,uint128,uint128,bytes32,bool,bool,bool,bytes32))' \
    "$asset" --rpc-url "$rpc_url" --json)"
  [[ "$(jq -r '.[0][6]' <<<"$status")" == "true" ]] || {
    echo "$symbol execution route is not ready" >&2
    exit 1
  }

  native_in=1000000000
  before="$(cast call "$asset" 'balanceOf(address)(uint256)' "$account" --rpc-url "$rpc_url" | quote_first)"
  quote="$(cast call "$router" 'quoteNativeToAsset(address,uint128)(uint256,uint256)' \
    "$asset" "$native_in" --rpc-url "$rpc_url" | quote_first)"
  minimum="$(minimum_99 "$quote")"
  deadline="$(chain_deadline)"
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
done < <(
  jq -r '.assetRoutes[] | [.symbol,.address] | @tsv' \
    "$manifest"
)

[[ "$(cast call "$market" 'graduated()(bool)' --rpc-url "$rpc_url")" == "false" ]] || {
  echo "Genesis market was already graduated; use a fresh rehearsal" >&2
  exit 1
}
maximum_curve_purchase="$(
  cast call "$market" 'maximumCurvePurchase()(uint256)' --rpc-url "$rpc_url" | quote_first
)"
graduation_transactions='[]'
graduation_tx=''
for _ in {1..32}; do
  if [[ "$(cast call "$market" 'graduated()(bool)' --rpc-url "$rpc_url")" == "true" ]]; then
    break
  fi
  graduation_tx="$(
    send "$market" 'buy(uint256)' 1 --value "$maximum_curve_purchase" --gas-limit 12000000
  )"
  graduation_transactions="$(
    jq -c --arg transaction "$graduation_tx" '. + [$transaction]' <<<"$graduation_transactions"
  )"
done
[[ -n "$graduation_tx" ]] || {
  echo "No bounded bonding buy was required or executed" >&2
  exit 1
}
[[ "$(cast call "$market" 'graduated()(bool)' --rpc-url "$rpc_url")" == "true" ]] || {
  echo "Bounded bonding buys did not graduate the market" >&2
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
post_buy_tx="$(
  send "$market" 'buy(uint256)' "$post_minimum" --value "$post_buy_in" --gas-limit 2000000
)"

sell_amount=100000000000000000000
approval_tx="$(send "$token" 'approve(address,uint256)' "$market" "$sell_amount")"
sell_quote="$(cast call "$market" 'quoteSell(uint256)(uint256,uint256)' \
  "$sell_amount" --from "$account" --rpc-url "$rpc_url" | awk 'NR == 2 { print $1 }')"
sell_minimum="$(minimum_99 "$sell_quote")"
post_sell_tx="$(
  send "$market" 'sell(uint256,uint256)' "$sell_amount" "$sell_minimum" --gas-limit 2000000
)"
launch_account="$(cast call "$fee_router" \
  'launchAccount(address)((address,address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool))' \
  "$token" --rpc-url "$rpc_url" --json)"
pending_basket="$(jq -er '.[0][15]' <<<"$launch_account")"
dao_liability="$(cast call "$fee_router" 'totalDaoNativeLiability()(uint256)' \
  --rpc-url "$rpc_url" | quote_first)"
treasury_liability="$(cast call "$fee_router" 'totalTreasuryNativeLiability()(uint256)' \
  --rpc-url "$rpc_url" | quote_first)"
settlement_results='{}'
if [[ "$pending_basket" -gt 0 ]]; then
  settlement_tx="$(send "$fee_router" 'settleBasketFees(address,uint256)' \
    "$token" "$pending_basket")"
  settlement_results="$(jq --arg transaction "$settlement_tx" '.basket=$transaction' \
    <<<"$settlement_results")"
fi
if [[ "$dao_liability" -gt 0 ]]; then
  settlement_tx="$(send "$fee_router" 'settleDaoFees(uint256)' "$dao_liability")"
  settlement_results="$(jq --arg transaction "$settlement_tx" '.dao=$transaction' \
    <<<"$settlement_results")"
fi
if [[ "$treasury_liability" -gt 0 ]]; then
  settlement_tx="$(send "$fee_router" 'settleTreasuryFees(uint256)' "$treasury_liability")"
  settlement_results="$(jq --arg transaction "$settlement_tx" '.treasury=$transaction' \
    <<<"$settlement_results")"
fi

conversion_results='[]'
for index in 0 1 2; do
  asset="$(cast call "$token" 'rewardAsset(uint256)(address)' "$index" --rpc-url "$rpc_url")"
  pending="$(cast call "$vault" 'leg(uint256)((address,uint16,uint256,uint256,uint256,uint256))' \
    "$index" --rpc-url "$rpc_url" | tr -d '()' | cut -d, -f3 | awk '{print $1}')"
  route_status="$(cast call "$router" \
    'routeStatus(address)((bytes32,uint128,uint128,uint128,int24,int24,uint24,bool,bytes32,uint24,int24,address,bool,bytes32))' \
    "$asset" --rpc-url "$rpc_url")"
  maximum_native_input="$(
    printf '%s\n' "$route_status" | tr -d '()' | cut -d, -f4 | awk '{ print $1 }'
  )"
  amount="$(
    node -e \
      'const pending=BigInt(process.argv[1]); const maximum=BigInt(process.argv[2]); console.log((pending < maximum ? pending : maximum).toString())' \
      "$pending" "$maximum_native_input"
  )"
  [[ "$amount" -gt 0 ]] || { echo "Basket leg $index has no convertible pending native" >&2; exit 1; }
  output="$(cast call "$router" 'quoteNativeToAsset(address,uint128)(uint256,uint256)' \
    "$asset" "$amount" --rpc-url "$rpc_url" | quote_first)"
  minimum="$(minimum_99 "$output")"
  deadline="$(chain_deadline)"
  conversion_tx="$(send "$vault" 'convertLeg(uint256,uint256,uint256,uint256)' \
    "$index" "$amount" "$minimum" "$deadline")"
  if [[ "$live" != "true" ]]; then
    cast rpc evm_increaseTime 60 --rpc-url "$rpc_url" >/dev/null
    cast rpc evm_mine --rpc-url "$rpc_url" >/dev/null
  fi
  claimable=0
  for _ in {1..30}; do
    claimable="$(cast call "$token" 'withdrawableRewardOf(address,uint256)(uint256)' \
      "$account" "$index" --rpc-url "$rpc_url" | quote_first)"
    [[ "$claimable" -gt 0 ]] && break
    sleep 1
  done
  [[ "$claimable" -gt 0 ]] || { echo "Basket leg $index created no holder reward" >&2; exit 1; }
  claim_tx="$(send "$token" 'claim(uint256)' "$index")"
  conversion_results="$(jq \
    --argjson index "$index" --arg asset "$asset" --arg amount "$amount" \
    --arg output "$output" --arg conversion "$conversion_tx" --arg claim "$claim_tx" \
    '. + [{index:$index,asset:$asset,nativeInput:$amount,quotedOutput:$output,
      transactions:{conversion:$conversion,holderClaim:$claim}}]' <<<"$conversion_results")"
done

creator_claimable=0
for _ in {1..30}; do
  creator_claimable="$(cast call "$fee_router" \
    'claimableCreatorNativeByRecipient(address,address)(uint256)' \
    "$token" "$account" --rpc-url "$rpc_url" | quote_first)"
  [[ "$creator_claimable" -gt 0 ]] && break
  sleep 1
done
[[ "$creator_claimable" -gt 0 ]] || { echo "Creator reward was not accrued" >&2; exit 1; }
creator_claim_tx="$(send "$fee_router" 'claimCreatorFees(address)' "$token")"
dao_claimable=0
for _ in {1..30}; do
  dao_claimable="$(cast call "$dao_token" 'claimableRewardOf(address)(uint256)' \
    "$account" --rpc-url "$rpc_url" | quote_first)"
  [[ "$dao_claimable" -gt 0 ]] && break
  sleep 1
done
[[ "$dao_claimable" -gt 0 ]] || { echo "RDAO reward was not accrued" >&2; exit 1; }
dao_claim_tx="$(send "$dao_token" 'claimRewards()')"

creator_liability="$(cast call "$fee_router" 'totalCreatorNativeLiability()(uint256)' \
  --rpc-url "$rpc_url" | quote_first)"
router_balance="$(cast balance "$fee_router" --rpc-url "$rpc_url")"
[[ "$router_balance" -ge "$creator_liability" ]] || {
  echo "Protocol fee router is insolvent" >&2
  exit 1
}
if [[ "$live" == "true" ]]; then
  final_balance="$(cast balance "$account" --rpc-url "$rpc_url")"
  [[ "$final_balance" -ge "$minimum_final_balance_wei" ]] || {
    echo "Live smoke breached the protected final balance reserve" >&2
    exit 1
  }
fi

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
  --argjson graduationTransactions "$graduation_transactions" \
  --arg postBuy "$post_buy_tx" \
  --arg approval "$approval_tx" \
  --arg postSell "$post_sell_tx" \
  --arg positionTokenId "$position_id" \
  --argjson conversions "$conversion_results" \
  --argjson settlementResults "$settlement_results" \
  --arg creatorClaim "$creator_claim_tx" \
  --arg daoClaim "$dao_claim_tx" \
  --arg creatorLiability "$creator_liability" \
  --arg feeRouterBalance "$router_balance" \
  '{
    status:$status,gitCommit:$gitCommit,chainId:$chainId,account:$account,
    manifestSha256:$manifestSha256,routeResults:$routeResults,
    market:{graduationTransaction:$graduation,graduationTransactions:$graduationTransactions,
      postGraduationBuy:$postBuy,
      postGraduationApproval:$approval,postGraduationSell:$postSell,
      positionTokenId:$positionTokenId},
    settlements:$settlementResults,
    basketConversions:$conversions,
    claims:{creator:$creatorClaim,rdao:$daoClaim},
    solvency:{creatorLiability:$creatorLiability,feeRouterBalance:$feeRouterBalance}
  }' >"$tmp"
mv "$tmp" "$evidence"
sha256sum "$evidence" >"$evidence.sha256"
chmod 600 "$journal" "$evidence" "$evidence.sha256"
sha256sum "$journal" >"$journal.sha256"
jq . "$evidence"

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_OPERATOR_RPC_URL:-http://127.0.0.1:8545}"
manifest="${ROBYN_DEVNET_MANIFEST:-$repo_root/deployments/31337.json}"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

test "$(cast chain-id --rpc-url "$rpc_url")" = "31337"
test -f "$manifest"
existing="$(jq -r '.contracts.bondingMarketFactory // empty' "$manifest")"
if [[ -n "$existing" && "$(cast code "$existing" --rpc-url "$rpc_url")" != "0x" ]]; then
  echo "Existing live bonding deployment: $existing"
  exit 0
fi

deployer="$(cast rpc eth_accounts --rpc-url "$rpc_url" | jq -r '.[0]')"
base="$(jq -r '.contracts.baseAsset' "$manifest")"
factory="$(jq -r '.contracts.factory' "$manifest")"
legacy_market_factory="$(jq -r '.contracts.marketFactory' "$manifest")"
reward_assets="$(jq -r '.contracts.rewardAssets | join(",")' "$manifest")"
curve_tokens="800000000000000000000000000"
graduation_tokens="200000000000000000000000000"
virtual_tokens="1066666666666666666666666666"
virtual_base="2166666666666666666667"
threshold="6500000000000000000000"
initial_supply="1000000000000000000000000000"

forge build --root packages/contracts >/dev/null
market_factory="$(forge create src/devnet/DevnetMarketFactory.sol:DevnetMarketFactory --root packages/contracts --rpc-url "$rpc_url" --from "$deployer" --unlocked --broadcast --json --constructor-args "$base" "$factory" "$curve_tokens" "$graduation_tokens" "$virtual_tokens" "$virtual_base" "$threshold" "100" | jq -er '.deployedTo')"

send_transaction() {
  cast send --rpc-url "$rpc_url" --from "$deployer" --unlocked --json "$@" | jq -e '.status == "0x1" or .status == 1' >/dev/null
}

create_demo() {
  local name="$1" symbol="$2" buy_amount="$3"
  send_transaction "$factory" "createLaunch(string,string,uint256,address[],uint16[])" "$name" "$symbol" "$initial_supply" "[$reward_assets]" "[4000,4000,2000]"
  local id token vault market pool
  id="$(cast call "$factory" "launchCount()(uint256)" --rpc-url "$rpc_url" | awk '{print $1}')"
  token="$(cast call "$factory" "launchTokenById(uint256)(address)" "$id" --rpc-url "$rpc_url")"
  vault="$(cast call "$factory" "vaultByToken(address)(address)" "$token" --rpc-url "$rpc_url")"
  send_transaction "$market_factory" "createMarket(address)" "$token"
  market="$(cast call "$market_factory" "marketByToken(address)(address)" "$token" --rpc-url "$rpc_url")"
  pool="$(cast call "$market" "graduatedPool()(address)" --rpc-url "$rpc_url")"
  send_transaction "$token" "approve(address,uint256)" "$market" "$initial_supply"
  send_transaction "$market" "seed(uint256,uint256)" "$initial_supply" "0"
  send_transaction "$factory" "sealLaunchExclusions(address,address[])" "$token" "[$market,$pool]"
  send_transaction "$base" "approve(address,uint256)" "$market" "$buy_amount"
  send_transaction "$market" "buy(uint256,uint256)" "$buy_amount" "1"
  jq -n --arg id "$id" --arg token "$token" --arg vault "$vault" --arg market "$market" --arg pool "$pool" '{launchId:$id,token:$token,vault:$vault,market:$market,graduatedPool:$pool}'
}

bonding="$(create_demo "Curve Collective" "CURVE" "2500000000000000000000")"
graduated="$(create_demo "Graduate Club" "GRAD" "10000000000000000000000")"
block_number="$(cast block-number --rpc-url "$rpc_url")"
git_commit="$(git rev-parse HEAD)"
temporary_manifest="$(mktemp "$(dirname "$manifest")/.31337.XXXXXX")"
jq --arg legacy "$legacy_market_factory" --arg current "$market_factory" --arg block "$block_number" --arg commit "$git_commit" --arg curveTokens "$curve_tokens" --arg graduationTokens "$graduation_tokens" --arg virtualTokens "$virtual_tokens" --arg virtualBase "$virtual_base" --arg threshold "$threshold" --argjson bonding "$bonding" --argjson graduated "$graduated" '
  .contracts.legacyMarketFactories = ((.contracts.legacyMarketFactories // []) + [$legacy] | unique) |
  .contracts.marketFactory = $current |
  .contracts.bondingMarketFactory = $current |
  .bondingDeploymentBlock = ($block | tonumber) |
  .gitCommit = $commit |
  .market = {type:"bonding-curve-v1",feeBps:100,curveTokenAllocation:$curveTokens,graduationTokenAllocation:$graduationTokens,initialVirtualTokenReserve:$virtualTokens,initialVirtualBaseReserve:$virtualBase,graduationThresholdBase:$threshold} |
  .bondingDemos = [$bonding + {phase:"bonding"}, $graduated + {phase:"graduated"}]
' "$manifest" >"$temporary_manifest"
mv "$temporary_manifest" "$manifest"
echo "Deployed bonding factory $market_factory and two canonical demo markets"

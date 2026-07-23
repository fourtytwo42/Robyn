#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_OPERATOR_RPC_URL:-http://127.0.0.1:8545}"
manifest="${ROBYN_DEVNET_MANIFEST:-$repo_root/deployments/31337.json}"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

test "$(cast chain-id --rpc-url "$rpc_url")" = "31337"
test -f "$manifest"

deployer="$(jq -r '.deployer' "$manifest")"
base="$(jq -r '.contracts.baseAsset' "$manifest")"
factory="$(jq -r '.contracts.factory' "$manifest")"
market_factory="$(jq -r '.contracts.marketFactory' "$manifest")"
coordinator="$(jq -er '.contracts.atomicLaunchCoordinator' "$manifest")"
nvda="$(jq -r '.contracts.rewardAssets[0]' "$manifest")"
spy="$(jq -r '.contracts.rewardAssets[1]' "$manifest")"
eth_reward="$(jq -r '.contracts.rewardAssets[2]' "$manifest")"
initial_supply="1000000000000000000000000000"
max_uint="115792089237316195423570985008687907853269984665640564039457584007913129639935"

launch_count="$(cast call "$factory" 'launchCount()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')"
if [[ "$launch_count" != "1" ]]; then
  echo "Expected a fresh one-launch deployment; found $launch_count launches" >&2
  exit 1
fi

mapfile -t accounts < <(cast rpc eth_accounts --rpc-url "$rpc_url" | jq -r '.[]')
if [[ "${#accounts[@]}" -lt 7 ]]; then
  echo "At least seven unlocked Anvil accounts are required" >&2
  exit 1
fi
traders=("${accounts[1]}" "${accounts[2]}" "${accounts[3]}" "${accounts[4]}" "${accounts[5]}" "${accounts[6]}")

wei() {
  printf '%s000000000000000000' "$1"
}

send_as() {
  local sender="$1"
  shift
  cast send --rpc-url "$rpc_url" --from "$sender" --unlocked --json "$@" |
    jq -e '.status == "0x1" or .status == 1' >/dev/null
}

for trader in "${traders[@]}"; do
  send_as "$deployer" "$base" 'mint(address,uint256)' "$trader" "$(wei 100000)"
done

demo_log="$(mktemp)"
cleanup() {
  rm -f "$demo_log"
}
trap cleanup EXIT

record_launch() {
  local name="$1" symbol="$2" token="$3" vault="$4" market="$5" adapter="$6" locker="$7" pool="$8" trades="$9"
  local graduated progress phase
  graduated="$(cast call "$market" 'graduated()(bool)' --rpc-url "$rpc_url")"
  progress="$(cast call "$market" 'graduationProgressBps()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')"
  if [[ "$graduated" == "true" ]]; then
    phase="graduated"
  else
    phase="bonding"
  fi
  jq -cn \
    --arg name "$name" \
    --arg symbol "$symbol" \
    --arg token "$token" \
    --arg vault "$vault" \
    --arg market "$market" \
    --arg adapter "$adapter" \
    --arg locker "$locker" \
    --arg pool "$pool" \
    --arg phase "$phase" \
    --argjson progressBps "$progress" \
    --argjson seededTrades "$trades" \
    '{name:$name,symbol:$symbol,token:$token,vault:$vault,market:$market,graduationAdapter:$adapter,positionLocker:$locker,graduatedPool:$pool,phase:$phase,progressBps:$progressBps,seededTrades:$seededTrades}' >>"$demo_log"
}

create_launch() {
  local name="$1" symbol="$2" assets="$3" weights="$4"
  local id token vault market adapter locker pool salt
  salt="$(cast keccak "robyn-devnet-demo-v2:$symbol")"
  send_as "$deployer" "$coordinator" \
    'createLaunch((string,string,address[],uint16[],bytes32))' \
    "(\"$name\",\"$symbol\",$assets,$weights,$salt)"
  id="$(cast call "$factory" 'launchCount()(uint256)' --rpc-url "$rpc_url" | awk '{print $1}')"
  token="$(cast call "$factory" 'launchTokenById(uint256)(address)' "$id" --rpc-url "$rpc_url")"
  vault="$(cast call "$factory" 'vaultByToken(address)(address)' "$token" --rpc-url "$rpc_url")"
  market="$(cast call "$market_factory" 'marketByToken(address)(address)' "$token" --rpc-url "$rpc_url")"
  adapter="$(cast call "$market_factory" 'adapterByToken(address)(address)' "$token" --rpc-url "$rpc_url")"
  pool="$(cast call "$market" 'graduatedPool()(address)' --rpc-url "$rpc_url")"
  locker="$(cast call "$market" 'positionLocker()(address)' --rpc-url "$rpc_url")"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$token" "$vault" "$market" "$adapter" "$locker" "$pool"
}

buy() {
  local market="$1" trader="$2" amount="$3"
  send_as "$trader" "$base" 'approve(address,uint256)' "$market" "$max_uint"
  send_as "$trader" "$market" 'buy(uint256,uint256)' "$(wei "$amount")" 1
}

sell() {
  local token="$1" market="$2" trader="$3" token_amount="$4"
  send_as "$trader" "$token" 'approve(address,uint256)' "$market" "$max_uint"
  send_as "$trader" "$market" 'sell(uint256,uint256)' "$(wei "$token_amount")" 1
}

genesis_token="$(jq -r '.contracts.genesisToken' "$manifest")"
genesis_vault="$(jq -r '.contracts.genesisVault' "$manifest")"
genesis_market="$(jq -r '.contracts.genesisMarket' "$manifest")"
genesis_adapter="$(jq -r '.contracts.genesisGraduationAdapter' "$manifest")"
genesis_locker="$(jq -r '.contracts.genesisPositionLocker' "$manifest")"
genesis_pool="$(jq -r '.contracts.genesisGraduatedPool' "$manifest")"
buy "$genesis_market" "${traders[0]}" 900
buy "$genesis_market" "${traders[1]}" 700
sell "$genesis_token" "$genesis_market" "${traders[0]}" 15000000
buy "$genesis_market" "${traders[2]}" 1200
buy "$genesis_market" "${traders[3]}" 650
sell "$genesis_token" "$genesis_market" "${traders[1]}" 8000000
buy "$genesis_market" "${traders[4]}" 900
record_launch "Robyn Genesis" "ROBYN" "$genesis_token" "$genesis_vault" "$genesis_market" "$genesis_adapter" "$genesis_locker" "$genesis_pool" 7

IFS=$'\t' read -r soak_token soak_vault soak_market soak_adapter soak_locker soak_pool < <(create_launch "Soak Society" "SOAK" "[$nvda,$spy,$eth_reward]" '[2500,5000,2500]')
buy "$soak_market" "${traders[1]}" 400
buy "$soak_market" "${traders[2]}" 650
sell "$soak_token" "$soak_market" "${traders[1]}" 9000000
buy "$soak_market" "${traders[3]}" 800
buy "$soak_market" "${traders[5]}" 450
record_launch "Soak Society" "SOAK" "$soak_token" "$soak_vault" "$soak_market" "$soak_adapter" "$soak_locker" "$soak_pool" 5

IFS=$'\t' read -r one_token one_vault one_market one_adapter one_locker one_pool < <(create_launch "NVIDIA Orbit" "ONE" "[$nvda]" '[10000]')
buy "$one_market" "${traders[0]}" 250
buy "$one_market" "${traders[4]}" 325
sell "$one_token" "$one_market" "${traders[0]}" 5000000
buy "$one_market" "${traders[5]}" 475
record_launch "NVIDIA Orbit" "ONE" "$one_token" "$one_vault" "$one_market" "$one_adapter" "$one_locker" "$one_pool" 4

IFS=$'\t' read -r evid_token evid_vault evid_market evid_adapter evid_locker evid_pool < <(create_launch "Evidence Engine" "EVID" "[$nvda,$spy,$eth_reward]" '[2000,3000,5000]')
buy "$evid_market" "${traders[0]}" 1000
buy "$evid_market" "${traders[1]}" 1500
sell "$evid_token" "$evid_market" "${traders[0]}" 12000000
buy "$evid_market" "${traders[2]}" 2300
buy "$evid_market" "${traders[3]}" 5000
buy "$evid_market" "${traders[4]}" 600
sell "$evid_token" "$evid_market" "${traders[1]}" 7000000
record_launch "Evidence Engine" "EVID" "$evid_token" "$evid_vault" "$evid_market" "$evid_adapter" "$evid_locker" "$evid_pool" 7

IFS=$'\t' read -r myco_token myco_vault myco_market myco_adapter myco_locker myco_pool < <(create_launch "My Community" "MYCO" "[$nvda,$spy,$eth_reward]" '[6000,2000,2000]')
buy "$myco_market" "${traders[5]}" 800
buy "$myco_market" "${traders[2]}" 1200
buy "$myco_market" "${traders[4]}" 1500
sell "$myco_token" "$myco_market" "${traders[5]}" 10000000
buy "$myco_market" "${traders[0]}" 1100
record_launch "My Community" "MYCO" "$myco_token" "$myco_vault" "$myco_market" "$myco_adapter" "$myco_locker" "$myco_pool" 5

demo_array="$(mktemp)"
jq -s '.' "$demo_log" >"$demo_array"
temporary_manifest="$(mktemp "$(dirname "$manifest")/.31337.XXXXXX")"
jq --slurpfile demos "$demo_array" \
  --arg block "$(cast block-number --rpc-url "$rpc_url")" \
  '.demoLaunches = $demos[0] | .demoSeedBlock = ($block | tonumber)' \
  "$manifest" >"$temporary_manifest"
mv "$temporary_manifest" "$manifest"
rm -f "$demo_array"

echo "Seeded five bonding-generation demo tokens with 28 market trades"

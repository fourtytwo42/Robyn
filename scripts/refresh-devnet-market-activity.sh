#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_OPERATOR_RPC_URL:-http://127.0.0.1:8545}"
manifest="${ROBYN_DEVNET_MANIFEST:-$repo_root/deployments/31337.json}"
export PATH="$HOME/.foundry/bin:$PATH"

test "$(cast chain-id --rpc-url "$rpc_url")" = "31337"
test -f "$manifest"

base="$(jq -r '.contracts.baseAsset' "$manifest")"
mapfile -t accounts < <(cast rpc eth_accounts --rpc-url "$rpc_url" | jq -r '.[]')
trader="${accounts[6]}"
max_uint="115792089237316195423570985008687907853269984665640564039457584007913129639935"
now="$(date -u +%s)"
latest="$(cast block latest --rpc-url "$rpc_url" | awk '/timestamp/{print $2}')"

if (( latest < now - 60 )); then
  cast rpc anvil_setNextBlockTimestamp "$now" --rpc-url "$rpc_url" >/dev/null
fi

send_as() {
  cast send --rpc-url "$rpc_url" --from "$trader" --unlocked --json "$@" |
    jq -e '.status == "0x1" or .status == 1' >/dev/null
}

index=0
while IFS= read -r market; do
  amount=$((25 + index * 10))
  send_as "$base" 'approve(address,uint256)' "$market" "$max_uint"
  send_as "$market" 'buy(uint256,uint256)' "${amount}000000000000000000" 1
  index=$((index + 1))
done < <(jq -r '.demoLaunches[].market' "$manifest")

echo "Added $index timestamped canonical demo trades at $(date -u --date="@$now" +%FT%TZ)"

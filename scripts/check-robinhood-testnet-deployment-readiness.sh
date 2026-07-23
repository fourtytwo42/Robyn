#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
minimum_balance_wei="${ROBYN_TESTNET_MIN_DEPLOYER_BALANCE_WEI:-5000000000000000}"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

[[ "$minimum_balance_wei" =~ ^[0-9]+$ ]] || { echo "Minimum balance must be an integer" >&2; exit 1; }
[[ "$minimum_balance_wei" -ge 5000000000000000 ]] || { echo "Refusing to lower the committed 0.005 ETH readiness floor" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Readiness requires a clean worktree" >&2; exit 1; }
git_sha="$(git rev-parse HEAD)"
[[ "$git_sha" == "$(git rev-parse origin/main)" ]] || { echo "Readiness requires HEAD pushed to origin/main" >&2; exit 1; }

wallet="$("$repo_root/scripts/check-robinhood-testnet-wallet.sh")"
balance_wei="$(jq -r .balanceWei <<<"$wallet")"
[[ "$balance_wei" =~ ^[0-9]+$ ]] || { echo "Wallet balance is not an integer" >&2; exit 1; }
[[ "$balance_wei" -ge "$minimum_balance_wei" ]] || { echo "Deployer balance is below the readiness floor" >&2; exit 1; }

forge build --root packages/contracts >/dev/null
if grep -RqsE 'DEVNET_ONLY|robyn-devnet' packages/contracts/src/testnet; then
  echo "Devnet marker found in testnet contracts" >&2
  exit 1
fi

measurement="$("$repo_root/scripts/measure-robinhood-testnet-deployment-gas.sh")"
estimated_total_cost_wei="$(jq -r .estimatedTotalCostWei <<<"$measurement")"
[[ "$estimated_total_cost_wei" -gt 0 ]] || { echo "Measured execution plus L1 data cost must be positive" >&2; exit 1; }
[[ "$(jq -r .includesArbitrumL1DataFeeEstimate <<<"$measurement")" == "true" ]] || { echo "L1 data-fee estimate is required" >&2; exit 1; }
required_with_headroom=$((estimated_total_cost_wei + (estimated_total_cost_wei + 3) / 4))
[[ "$balance_wei" -ge "$required_with_headroom" ]] || {
  echo "Deployer balance does not cover the full measured bundle plus 25% headroom" >&2
  exit 1
}

jq -n \
  --arg checkedAt "$(date -u +%FT%TZ)" \
  --arg gitSha "$git_sha" \
  --argjson wallet "$wallet" \
  --argjson gasMeasurement "$measurement" \
  --arg minimumBalanceWei "$minimum_balance_wei" \
  --arg requiredWithHeadroomWei "$required_with_headroom" \
  '{schemaVersion: 2, checkedAt: $checkedAt, passed: true, gitSha: $gitSha, wallet: $wallet, minimumBalanceWei: $minimumBalanceWei, gasMeasurement: $gasMeasurement, requiredWith25PercentHeadroomWei: $requiredWithHeadroomWei, broadcastPerformed: false}'

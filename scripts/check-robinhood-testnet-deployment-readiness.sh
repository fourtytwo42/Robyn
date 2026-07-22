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
execution_cost_wei="$(jq -r .executionCostWei <<<"$measurement")"
[[ "$execution_cost_wei" -gt 0 ]] || { echo "Measured execution cost must be positive" >&2; exit 1; }
headroom_multiple=$((balance_wei / execution_cost_wei))
[[ "$headroom_multiple" -ge 20 ]] || { echo "Deployer has less than 20x measured execution-cost headroom" >&2; exit 1; }

jq -n \
  --arg checkedAt "$(date -u +%FT%TZ)" \
  --arg gitSha "$git_sha" \
  --argjson wallet "$wallet" \
  --argjson gasMeasurement "$measurement" \
  --arg minimumBalanceWei "$minimum_balance_wei" \
  --argjson executionHeadroomMultiple "$headroom_multiple" \
  '{schemaVersion: 1, checkedAt: $checkedAt, passed: true, gitSha: $gitSha, wallet: $wallet, minimumBalanceWei: $minimumBalanceWei, gasMeasurement: $gasMeasurement, executionHeadroomMultiple: $executionHeadroomMultiple, broadcastPerformed: false}'

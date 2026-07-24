#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="${1:-$repo_root/deployments/46630-uniswap-v4-shared.json}"
cd "$repo_root"

[[ -f "$manifest" ]] || {
  echo "Missing v4 venue manifest: $manifest" >&2
  exit 1
}

args=("$manifest")
if [[ "${ROBYN_V4_ALLOW_PENDING:-false}" == "true" ]]; then
  args+=(--allow-pending)
fi
node scripts/verify-testnet-uniswap-v4.mjs "${args[@]}"

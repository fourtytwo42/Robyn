#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="${1:-}"
output="${ROBYN_TESTNET_BUILD_OUTPUT:-/tmp/robyn-testnet-candidate}"
rpc_url="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
data_api_url="${ROBYN_TESTNET_DATA_API_URL:-}"
[[ -n "$manifest" && -f "$manifest" ]] || { echo "Usage: $0 TESTNET_MANIFEST" >&2; exit 1; }
cd "$repo_root"

jq -e '.environment == "robinhood-testnet" and .chainId == 46630 and .mockOnly == true' "$manifest" >/dev/null
if grep -RqsE 'DEVNET_ONLY|robyn-devnet' packages/contracts/src/testnet; then
  echo "Devnet marker found in testnet contract source" >&2
  exit 1
fi
rm -rf apps/web/.next "$output"
ROBYN_NETWORK_MODE=testnet \
NEXT_PUBLIC_ROBYN_NETWORK_MODE=testnet \
ROBYN_DEPLOYMENT_PATH="$(realpath "$manifest")" \
NEXT_PUBLIC_ROBYN_RPC_URL="$rpc_url" \
NEXT_PUBLIC_DATA_API_URL="$data_api_url" \
  pnpm --filter @robyn/web build
rm -rf apps/web/.next/cache

for marker in DEVNET_ONLY robyn-devnet robyn-devnet-session-key generatePrivateKey '"/faucet"'; do
  if grep -RasF -- "$marker" apps/web/.next >/dev/null; then
    echo "Forbidden testnet-bundle marker found: $marker" >&2
    exit 1
  fi
done
for required in eth_requestAccounts wallet_switchEthereumChain 0xb626; do
  grep -RasF -- "$required" apps/web/.next >/dev/null || {
    echo "Required injected-wallet marker missing: $required" >&2
    exit 1
  }
done

mkdir -p "$output"
cp -a apps/web/.next "$output/.next"
cp apps/web/package.json "$output/package.json"
cp "$manifest" "$output/deployment.json"
find "$output" -type f -print0 | sort -z | xargs -0 sha256sum > "$output/SHA256SUMS"
jq -n \
  --arg builtAt "$(date -u +%FT%TZ)" \
  --arg gitSha "$(git rev-parse HEAD)" \
  --arg rpcUrl "$rpc_url" \
  --arg dataApiUrl "$data_api_url" \
  --arg manifestSha256 "$(sha256sum "$manifest" | awk '{print $1}')" \
  '{schemaVersion: 1, builtAt: $builtAt, gitSha: $gitSha, environment: "robinhood-testnet", chainId: 46630, rpcUrl: $rpcUrl, dataApiUrl: $dataApiUrl, devnetControlsPresent: false, manifestSha256: $manifestSha256}' > "$output/build-evidence.json"
printf 'Built protected testnet web candidate at %s\n' "$output"

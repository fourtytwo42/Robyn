#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="${1:-}"
output="${ROBYN_TESTNET_BUILD_OUTPUT:-/tmp/robyn-testnet-candidate}"
rpc_url="${ROBYN_TESTNET_BROWSER_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
data_api_url="${ROBYN_TESTNET_DATA_API_URL:-}"
walletconnect_project_id="${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:-}"
app_url="${NEXT_PUBLIC_APP_URL:-}"
[[ -n "$manifest" && -f "$manifest" ]] || { echo "Usage: $0 TESTNET_MANIFEST" >&2; exit 1; }
cd "$repo_root"

jq -e '.environment == "robinhood-testnet" and .chainId == 46630 and .mockOnly == true' "$manifest" >/dev/null
[[ "$walletconnect_project_id" =~ ^[a-fA-F0-9]{32}$ ]] || {
  echo "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must be a 32-character WalletConnect project ID" >&2
  exit 1
}
[[ "$app_url" == https://* ]] || {
  echo "NEXT_PUBLIC_APP_URL must be a stable HTTPS URL" >&2
  exit 1
}
[[ "$rpc_url" == https://* ]] || {
  echo "ROBYN_TESTNET_BROWSER_RPC_URL must be a public HTTPS endpoint" >&2
  exit 1
}
if [[ "$rpc_url" =~ (localhost|127\.0\.0\.1|192\.168\.|10\.) ]]; then
  echo "Loopback/private RPC URL cannot enter a protected browser bundle" >&2
  exit 1
fi
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
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="$walletconnect_project_id" \
NEXT_PUBLIC_APP_URL="$app_url" \
  pnpm --filter @robyn/web build
rm -rf apps/web/.next/cache

for marker in DEVNET_ONLY robyn-devnet robyn-devnet-session-key generatePrivateKey '"/faucet"'; do
  if grep -RasF -- "$marker" apps/web/.next/static apps/web/.next/server >/dev/null; then
    echo "Forbidden testnet-bundle marker found: $marker" >&2
    exit 1
  fi
done
for required in "$walletconnect_project_id" WalletConnect 46630; do
  grep -RasF -- "$required" apps/web/.next >/dev/null || {
    echo "Required shared-wallet marker missing: $required" >&2
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
  '{schemaVersion: 2, builtAt: $builtAt, gitSha: $gitSha, environment: "robinhood-testnet", chainId: 46630, rpcUrl: $rpcUrl, publicRpcValidated: true, dataApiUrl: $dataApiUrl, walletLayer: "rainbowkit-wagmi", walletConnectConfigured: true, devnetControlsPresent: false, manifestSha256: $manifestSha256}' > "$output/build-evidence.json"
printf 'Built protected testnet web candidate at %s\n' "$output"

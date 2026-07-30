#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${ROBYN_TESTNET_SCHEMA13_REHEARSAL_PORT:-18546}"
local_rpc="http://127.0.0.1:${port}"
upstream_rpc="${ROBYN_TESTNET_RPC_URL:-http://127.0.0.1:18548}"
evidence_root="${ROBYN_SCHEMA13_REHEARSAL_EVIDENCE_ROOT:-/home/hendo420/robyn-evidence/schema13-mainnet-go/testnet-rehearsal}"
run_id="${ROBYN_SCHEMA13_REHEARSAL_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
output="${evidence_root}/${run_id}"
work="$(mktemp -d /tmp/robyn-schema13-rehearsal.XXXXXX)"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

cleanup() {
  if [[ -n "${anvil_pid:-}" ]]; then
    kill "$anvil_pid" >/dev/null 2>&1 || true
    wait "$anvil_pid" >/dev/null 2>&1 || true
  fi
  case "$work" in
    /tmp/robyn-schema13-rehearsal.*) rm -rf -- "$work" ;;
    *) echo "Refusing unsafe rehearsal cleanup path: $work" >&2; exit 98 ;;
  esac
}
trap cleanup EXIT

[[ "$EUID" -ne 0 ]] || {
  echo "Run as the unprivileged release operator" >&2
  exit 1
}
[[ -z "$(git status --porcelain)" ]] || {
  echo "Schema-13 rehearsal requires a clean checkout" >&2
  exit 1
}
git_sha="$(git rev-parse HEAD)"
[[ "$(git rev-parse '@{u}')" == "$git_sha" ]] || {
  echo "Schema-13 rehearsal requires a pushed commit" >&2
  exit 1
}
[[ "$(cast chain-id --rpc-url "$upstream_rpc")" == "46630" ]] || {
  echo "Schema-13 rehearsal upstream must be chain 46630" >&2
  exit 1
}
if cast chain-id --rpc-url "$local_rpc" >/dev/null 2>&1; then
  echo "Schema-13 rehearsal port ${port} is already in use" >&2
  exit 1
fi

mkdir -p "$output"
chmod 0700 "$output"
anvil \
  --host 127.0.0.1 \
  --port "$port" \
  --fork-url "$upstream_rpc" \
  --chain-id 46630 \
  --config-out "$work/anvil.json" \
  --silent >"$output/anvil.log" 2>&1 &
anvil_pid="$!"

for _ in $(seq 1 200); do
  if cast chain-id --rpc-url "$local_rpc" >/dev/null 2>&1 && [[ -s "$work/anvil.json" ]]; then
    break
  fi
  sleep 0.1
done
[[ "$(cast chain-id --rpc-url "$local_rpc")" == "46630" ]]

deployer="$(cast rpc eth_accounts --rpc-url "$local_rpc" | jq -er '.[0]')"
guardian="$(cast rpc eth_accounts --rpc-url "$local_rpc" | jq -er '.[1]')"
manifest="$output/46630-v4-schema13.rehearsal.json"
gas_evidence="$output/46630-v4-schema13.gas.json"

ROBYN_TESTNET_RPC_URL="$local_rpc" \
ROBYN_TESTNET_SCHEMA13_MANIFEST="$manifest" \
ROBYN_TESTNET_REHEARSAL=true \
ROBYN_ALLOW_UNLOCKED_REHEARSAL=true \
ROBYN_TESTNET_REHEARSAL_DEPLOYER="$deployer" \
ROBYN_GUARDIAN_ADDRESS="$guardian" \
ROBYN_TESTNET_SCHEMA13_BROADCAST=true \
ROBYN_TESTNET_SCHEMA13_VERIFICATION_REPORT="$output/verification.json" \
  scripts/deploy-testnet-schema13-protocol.sh >"$output/deploy.log"

ROBYN_TESTNET_RPC_URL="$local_rpc" \
ROBYN_TESTNET_PRICING_RPC_URL="$upstream_rpc" \
ROBYN_TESTNET_V4_PROTOCOL_MANIFEST="$manifest" \
ROBYN_TESTNET_V4_GAS_EVIDENCE="$gas_evidence" \
  scripts/measure-testnet-v4-deployment-gas.sh >"$output/gas.log"

jq -e \
  --arg gitSha "$git_sha" \
  '.gitCommit == $gitSha
   and .headroomBps >= 2500
   and .reserveWei >= "1500000000000000"
   and .transactionCount >= "97"
   and .sufficientBalance == true' \
  "$gas_evidence" >/dev/null

jq -n \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg gitSha "$git_sha" \
  --arg forkBlock "$(cast block-number --rpc-url "$local_rpc")" \
  --arg manifestSha256 "$(sha256sum "$manifest" | cut -d' ' -f1)" \
  --arg gasEvidenceSha256 "$(sha256sum "$gas_evidence" | cut -d' ' -f1)" \
  --arg transactionCount "$(jq -r '.transactionCount' "$gas_evidence")" \
  --arg totalGas "$(jq -r '.totalGas' "$gas_evidence")" \
  --arg requiredWithReserveWei "$(jq -r '.requiredWithReserveWei' "$gas_evidence")" \
  '{
    schemaVersion:1,
    generatedAt:$generatedAt,
    chainId:46630,
    gitSha:$gitSha,
    forkBlock:$forkBlock,
    manifestSha256:$manifestSha256,
    gasEvidenceSha256:$gasEvidenceSha256,
    transactionCount:$transactionCount,
    totalGas:$totalGas,
    requiredWithReserveWei:$requiredWithReserveWei,
    liveBroadcast:false,
    passed:true
  }' >"$output/summary.json"

(cd "$output" && sha256sum ./* >SHA256SUMS)
printf 'schema13TestnetRehearsal=passed\nsummary=%s\n' "$output/summary.json"

#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
[[ "$EUID" -ne 0 ]] || { echo "run as the unprivileged operator" >&2; exit 1; }

schema18_manifest="${1:?usage: run-schema19-mainnet-rehearsal.sh SCHEMA18_MANIFEST ROUTE_SOURCE EVIDENCE_DIR}"
route_source="${2:?missing route source}"
evidence="${3:?missing evidence directory}"
rpc_live="${ROBYN_SCHEMA19_MAINNET_RPC_URL:-http://127.0.0.1:18549}"
rpc_fork=http://127.0.0.1:28548
anvil="$HOME/.foundry/bin/anvil"
forge="$HOME/.foundry/bin/forge"

[[ "$rpc_live" == http://127.0.0.1:* || "$rpc_live" == http://localhost:* ]] || {
  echo "Mainnet rehearsal requires the loopback LAN gateway" >&2
  exit 1
}
[[ -x "$anvil" && -x "$forge" ]]
[[ -z "$(git status --porcelain)" ]]
[[ "$(git rev-parse HEAD)" == "$(git rev-parse '@{u}')" ]]
[[ ! -e "$evidence" ]] || { echo "evidence directory already exists" >&2; exit 1; }
mkdir -m 0700 -p "$evidence"

input="$evidence/protected-input.json"
prepared="$evidence/prepared-deployment.json"
ledger="$evidence/deployment-receipt-ledger.json"
verified="$evidence/deployment-verification.json"
manifest="$evidence/schema19-mainnet-rehearsal-manifest.json"
lifecycle="$evidence/lifecycle"

ROBYN_SCHEMA19_MAINNET_RPC_URL="$rpc_live" \
  node scripts/prepare-schema19-mainnet-input.mjs \
  "$schema18_manifest" "$route_source" "$input"
node scripts/prepare-schema19-deployment.mjs "$input" "$prepared"

fork_block="$(jq -r .snapshotBlock "$input")"
deployer="$(jq -r .deployer "$input")"
nohup "$anvil" \
  --fork-url "$rpc_live" \
  --fork-block-number "$fork_block" \
  --chain-id 4663 \
  --host 127.0.0.1 \
  --port 28548 \
  --auto-impersonate \
  --silent >"$evidence/anvil.log" 2>&1 &
anvil_pid=$!
cleanup() {
  kill "$anvil_pid" 2>/dev/null || true
  wait "$anvil_pid" 2>/dev/null || true
}
trap cleanup EXIT
anvil_ready=false
for _ in $(seq 1 60); do
  kill -0 "$anvil_pid" 2>/dev/null || break
  response="$(curl -fsS -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
    "$rpc_fork" 2>/dev/null || true)"
  if [[ -n "$response" ]] && jq -e '.result == "0x1237"' <<<"$response" >/dev/null; then
    anvil_ready=true
    break
  fi
  sleep 1
done
if [[ "$anvil_ready" != true ]]; then
  cat "$evidence/anvil.log" >&2
  echo "pinned Anvil fork failed readiness" >&2
  exit 1
fi
set_balance_response="$(curl -fsS -H 'content-type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"anvil_setBalance\",\"params\":[\"$deployer\",\"0x56bc75e2d63100000\"]}" \
  "$rpc_fork")"
jq -e 'has("error") | not' <<<"$set_balance_response" >/dev/null
funded_balance="$($HOME/.foundry/bin/cast balance --rpc-url "$rpc_fork" "$deployer")"
[[ "$funded_balance" == 100000000000000000000 ]]

rm -rf packages/contracts/broadcast/DeploySchema19.s.sol/4663
SCHEMA19_DEPLOYMENT_INPUT="$prepared" \
  "$forge" script script/DeploySchema19.s.sol:DeploySchema19 \
    --root packages/contracts \
    --rpc-url "$rpc_fork" \
    --sender "$deployer" \
    --unlocked \
    --broadcast \
    --slow \
    --skip-simulation \
    -vv >"$evidence/deployment.log" 2>&1
cp packages/contracts/broadcast/DeploySchema19.s.sol/4663/run-latest.json "$ledger"

ROBYN_SCHEMA19_RPC_URL="$rpc_fork" \
  node scripts/verify-schema19-deployment.mjs "$prepared" "$verified"
node scripts/finalize-schema19-deployment-manifest.mjs \
  "$verified" "$prepared" "$input" "$ledger" "$manifest"

export ROBYN_SCHEMA19_NETWORK=mainnet-fork
export ROBYN_SCHEMA19_MAINNET_RELEASE_SHA=a67288133f09bce68b7386009d702c14dfb8bbab
export ROBYN_SCHEMA19_MAINNET_MANIFEST="$manifest"
export ROBYN_SCHEMA19_MAINNET_EVIDENCE="$lifecycle"
export ROBYN_SCHEMA19_MAINNET_RPC_URL="$rpc_fork"
for stage in verify routes launch maintenance claims unwind post-settle shutdown reconcile status; do
  node scripts/run-schema19-testnet-lifecycle.mjs "$stage" \
    >"$evidence/lifecycle-$stage.json"
done

node scripts/seal-schema19-mainnet-rehearsal.mjs \
  "$input" "$prepared" "$ledger" "$verified" "$manifest" "$lifecycle" \
  "$evidence/rehearsal-report.json"
(cd "$evidence" && sha256sum -- *.json lifecycle/*.jsonl lifecycle/*.json > SHA256SUMS)
sha256sum -c "$evidence/SHA256SUMS"
cat "$evidence/rehearsal-report.json"

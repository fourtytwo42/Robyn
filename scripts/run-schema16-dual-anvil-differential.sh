#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
baseline_sha="${ROBYN_SCHEMA15_BASELINE_SHA:-5899a5fc99dde04f60f1bba88bc9716e99dcd45f}"
upstream_rpc="${ROBYN_TESTNET_RPC_URL:-http://127.0.0.1:18548}"
baseline_port="${ROBYN_SCHEMA16_DIFF_BASELINE_PORT:-28546}"
candidate_port="${ROBYN_SCHEMA16_DIFF_CANDIDATE_PORT:-28547}"
release_sha="${1:-$(git -C "$repo_root" rev-parse HEAD)}"
run_id="${ROBYN_SCHEMA16_DIFF_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
evidence="${ROBYN_SCHEMA16_DIFF_EVIDENCE_ROOT:-/home/hendo420/robyn-evidence/schema16-differential}/${release_sha}/${run_id}"
work="$(mktemp -d /tmp/robyn-schema16-differential.XXXXXX)"
baseline_worktree="$work/schema15"
baseline_pid=""
candidate_pid=""
export PATH="$HOME/.foundry/bin:$PATH"

cleanup() {
  for pid in "$baseline_pid" "$candidate_pid"; do
    [[ -z "$pid" ]] || kill "$pid" >/dev/null 2>&1 || true
  done
  wait "$baseline_pid" "$candidate_pid" >/dev/null 2>&1 || true
  if [[ -d "$baseline_worktree" ]]; then
    git -C "$repo_root" worktree remove --force "$baseline_worktree" >/dev/null 2>&1 || true
  fi
  case "$work" in
    /tmp/robyn-schema16-differential.*) rm -rf -- "$work" ;;
    *) echo "Refusing unsafe differential cleanup: $work" >&2 ;;
  esac
}
trap cleanup EXIT

[[ "$EUID" -ne 0 ]] || { echo "Run as the unprivileged release operator" >&2; exit 2; }
cd "$repo_root"
[[ "$release_sha" == "$(git rev-parse HEAD)" && -z "$(git status --porcelain)" ]] || {
  echo "Differential requires the exact clean candidate HEAD" >&2
  exit 2
}
[[ "$(git rev-parse '@{u}')" == "$release_sha" ]] || {
  echo "Differential requires the exact pushed candidate" >&2
  exit 2
}
git merge-base --is-ancestor "$baseline_sha" "$release_sha"
[[ "$(cast chain-id --rpc-url "$upstream_rpc")" == "46630" ]]
for port in "$baseline_port" "$candidate_port"; do
  ! cast chain-id --rpc-url "http://127.0.0.1:${port}" >/dev/null 2>&1 || {
    echo "Differential port $port is already in use" >&2
    exit 2
  }
done

mkdir -p "$evidence"
chmod 0700 "$evidence"
fork_block="$(cast block-number --rpc-url "$upstream_rpc")"
fork_timestamp="$(
  cast block "$fork_block" --rpc-url "$upstream_rpc" --json |
    jq -er '.timestamp'
)"
start_timestamp=$((fork_timestamp + 1))
git worktree add --detach "$baseline_worktree" "$baseline_sha" >/dev/null
ln -s "$repo_root/node_modules" "$baseline_worktree/node_modules"

anvil --host 127.0.0.1 --port "$baseline_port" --fork-url "$upstream_rpc" \
  --fork-block-number "$fork_block" --chain-id 46630 \
  --timestamp "$start_timestamp" --silent \
  >"$evidence/baseline-anvil.log" 2>&1 &
baseline_pid="$!"
anvil --host 127.0.0.1 --port "$candidate_port" --fork-url "$upstream_rpc" \
  --fork-block-number "$fork_block" --chain-id 46630 \
  --timestamp "$start_timestamp" --silent \
  >"$evidence/candidate-anvil.log" 2>&1 &
candidate_pid="$!"
for port in "$baseline_port" "$candidate_port"; do
  for _ in $(seq 1 300); do
    [[ "$(cast chain-id --rpc-url "http://127.0.0.1:${port}" 2>/dev/null || true)" == "46630" ]] && break
    sleep 0.1
  done
  [[ "$(cast chain-id --rpc-url "http://127.0.0.1:${port}")" == "46630" ]]
  cast rpc anvil_setBlockTimestampInterval 0 \
    --rpc-url "http://127.0.0.1:${port}" >/dev/null
done

(cd "$baseline_worktree" && forge build --root packages/contracts) \
  >"$evidence/baseline-build.log" 2>&1
(cd "$repo_root" && forge build --root packages/contracts) \
  >"$evidence/candidate-build.log" 2>&1
baseline_rpc="http://127.0.0.1:${baseline_port}"
candidate_rpc="http://127.0.0.1:${candidate_port}"
deployer="$(cast rpc eth_accounts --rpc-url "$baseline_rpc" | jq -er '.[0]')"
guardian="$(cast rpc eth_accounts --rpc-url "$baseline_rpc" | jq -er '.[1]')"

(
  cd "$baseline_worktree"
  ROBYN_TESTNET_RPC_URL="$baseline_rpc" \
  ROBYN_TESTNET_SCHEMA15_MANIFEST="$evidence/baseline-manifest-original.json" \
  ROBYN_TESTNET_REHEARSAL=true \
  ROBYN_ALLOW_UNLOCKED_REHEARSAL=true \
  ROBYN_TESTNET_REHEARSAL_DEPLOYER="$deployer" \
  ROBYN_GUARDIAN_ADDRESS="$guardian" \
  ROBYN_TESTNET_SCHEMA15_BROADCAST=true \
  ROBYN_TESTNET_SCHEMA15_VERIFICATION_REPORT="$evidence/baseline-verification.json" \
    scripts/deploy-testnet-schema15-protocol.sh
) >"$evidence/baseline-deploy.log" 2>&1
ROBYN_TESTNET_RPC_URL="$candidate_rpc" \
ROBYN_TESTNET_SCHEMA16_MANIFEST="$evidence/candidate-manifest.json" \
ROBYN_TESTNET_REHEARSAL=true \
ROBYN_ALLOW_UNLOCKED_REHEARSAL=true \
ROBYN_TESTNET_REHEARSAL_DEPLOYER="$deployer" \
ROBYN_GUARDIAN_ADDRESS="$guardian" \
ROBYN_TESTNET_SCHEMA16_BROADCAST=true \
ROBYN_TESTNET_SCHEMA16_VERIFICATION_REPORT="$evidence/candidate-verification.json" \
  scripts/deploy-testnet-schema16-protocol.sh \
  >"$evidence/candidate-deploy.log" 2>&1
jq '.schemaVersion=16' "$evidence/baseline-manifest-original.json" \
  >"$evidence/baseline-manifest.json"

activate_public() {
  local rpc="$1"
  local manifest="$2"
  local timelock coordinator
  timelock="$(jq -r .contracts.timelock "$manifest")"
  coordinator="$(jq -r .contracts.atomicLaunchCoordinator "$manifest")"
  cast rpc anvil_impersonateAccount "$timelock" --rpc-url "$rpc" >/dev/null
  cast rpc anvil_setBalance "$timelock" 0x3635C9ADC5DEA00000 --rpc-url "$rpc" >/dev/null
  cast send "$coordinator" 'setPublicMode()' --from "$timelock" --unlocked \
    --rpc-url "$rpc" >/dev/null
  cast rpc anvil_stopImpersonatingAccount "$timelock" --rpc-url "$rpc" >/dev/null
}
activate_public "$baseline_rpc" "$evidence/baseline-manifest.json"
activate_public "$candidate_rpc" "$evidence/candidate-manifest.json"

passphrase="$work/passphrase"
key_file="$work/rehearsal.key"
printf '%s\n' 'schema16-differential-disposable-passphrase' >"$passphrase"
printf '%s\n' '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' >"$key_file"
chmod 0600 "$passphrase" "$key_file"
campaign_id="schema16-diff-${release_sha:0:8}"
baseline_state="$work/baseline-state"
candidate_state="$work/candidate-state"
mkdir -p "$baseline_state" "$candidate_state"
operator="$(cast rpc eth_accounts --rpc-url "$baseline_rpc" | jq -er '.[9]')"

campaign() {
  local command="$1" rpc="$2" manifest="$3" state="$4"
  ROBYN_CAMPAIGN_REHEARSAL_KEY_FILE="$key_file" \
    node scripts/testnet-assurance-campaign.mjs "$command" \
    --campaign "$campaign_id" \
    --manifest "$manifest" \
    --state-dir "$state" \
    --passphrase-file "$passphrase" \
    --rpc-url "$rpc" \
    --keeper-address "$operator" \
    --rehearsal \
    --metadata-uri ipfs://bafkreif2akiscaildcwr6zeux4w6i2s5kmibuf6j4jvcrbozme2q \
    --gas-price-wei 10000000000 \
    --l1-base-fee-wei 1
}

prepare_graduations() {
  local rpc="$1" state="$2" receipt_log="$3"
  local buyer market threshold raised fee maximum required_net gross value
  buyer="$(cast rpc eth_accounts --rpc-url "$rpc" | jq -er '.[8]')"
  : >"$receipt_log"
  for launch_index in 0 1 2; do
    market="$(jq -er --argjson index "$launch_index" '.launches[$index].market' "$state/state.json")"
    gross=0
    for _ in $(seq 1 20); do
      threshold="$(cast call "$market" 'graduationThresholdNative()(uint256)' --rpc-url "$rpc" --json | jq -er '.[0]')"
      raised="$(cast call "$market" 'nativeRaised()(uint256)' --rpc-url "$rpc" --json | jq -er '.[0]')"
      fee="$(cast call "$market" 'feeBps()(uint256)' --rpc-url "$rpc" --json | jq -er '.[0]')"
      maximum="$(cast call "$market" 'maximumCurvePurchase()(uint256)' --rpc-url "$rpc" --json | jq -er '.[0]')"
      if (( raised >= threshold )); then
        gross=0
        break
      fi
      required_net=$((threshold - raised))
      gross="$(
        node -e \
          'const [net, fee] = process.argv.slice(1).map(BigInt); process.stdout.write(((net * 10000n + (10000n - fee) - 1n) / (10000n - fee)).toString())' \
          "$required_net" "$fee"
      )"
      (( gross > 100000000000000 )) || break
      value=$((gross - 100000000000000))
      (( value <= maximum )) || value="$maximum"
      cast send "$market" 'buy(uint256)' 1 \
        --from "$buyer" \
        --unlocked \
        --value "$value" \
        --rpc-url "$rpc" \
        --json >>"$receipt_log"
    done
    (( gross <= 100000000000000 )) || {
      echo "Unable to prepare launch $launch_index within the fixed graduation bound" >&2
      return 1
    }
  done
}

campaign init "$baseline_rpc" "$evidence/baseline-manifest.json" "$baseline_state" \
  >"$evidence/baseline-campaign.log" 2>&1
cp "$baseline_state/encrypted-root.json" "$candidate_state/encrypted-root.json"
cp "$baseline_state/state.json" "$candidate_state/state.json"
cp "$baseline_state/evidence.json" "$candidate_state/evidence.json"
for side in baseline candidate; do
  if [[ "$side" == baseline ]]; then
    rpc="$baseline_rpc"; manifest="$evidence/baseline-manifest.json"; state="$baseline_state"
  else
    rpc="$candidate_rpc"; manifest="$evidence/candidate-manifest.json"; state="$candidate_state"
  fi
  for phase in preflight fund launches trading conversions governance claims; do
    campaign "$phase" "$rpc" "$manifest" "$state" \
      >>"$evidence/${side}-campaign.log" 2>&1
    if [[ "$phase" == launches ]]; then
      prepare_graduations "$rpc" "$state" "$evidence/${side}-graduation-prep.jsonl"
    fi
  done
  cp "$state/evidence.json" "$evidence/${side}-campaign-state.json"
  node scripts/capture-schema16-differential-state.mjs \
    --rpc-url "$rpc" \
    --manifest "$manifest" \
    --campaign-state "$state/state.json" \
    --output "$evidence/${side}-state.json"
done

node scripts/compare-schema16-differential.mjs \
  "$evidence/baseline-state.json" \
  "$evidence/candidate-state.json" \
  "$evidence/comparison.json"
jq -n \
  --arg baselineSha "$baseline_sha" \
  --arg candidateSha "$release_sha" \
  --arg forkBlock "$fork_block" \
  --arg completedAt "$(date -u +%FT%TZ)" \
  --slurpfile comparison "$evidence/comparison.json" \
  '{
    schemaVersion:1,
    baselineSha:$baselineSha,
    candidateSha:$candidateSha,
    chainId:46630,
    forkBlock:$forkBlock,
    completedAt:$completedAt,
    comparison:$comparison[0],
    passed:$comparison[0].passed
  }' >"$evidence/summary.json"
(
  cd "$evidence"
  find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 |
    sort -z | xargs -0 sha256sum >SHA256SUMS
  sha256sum -c SHA256SUMS >/dev/null
)
printf 'schema16Differential=passed evidence=%s\n' "$evidence"

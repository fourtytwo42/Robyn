#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

deep_evidence=""
output=""
while (($#)); do
  case "$1" in
    --deep-evidence) deep_evidence="${2:?missing deep evidence}"; shift 2 ;;
    --output) output="${2:?missing output}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$deep_evidence" && -f "$deep_evidence/summary.json" ]] || {
  echo "--deep-evidence must contain summary.json" >&2; exit 2;
}
head_sha="$(git rev-parse HEAD)"
[[ -z "$(git status --porcelain)" ]] || { echo "Eight-hour soak requires a clean checkout" >&2; exit 3; }
[[ "$(git rev-parse '@{u}')" == "$head_sha" ]] || { echo "Eight-hour soak requires exact pushed HEAD" >&2; exit 3; }
jq -e --arg sha "$head_sha" '.schema==20 and .tier=="deep" and .passed==true and .releaseSha==$sha' \
  "$deep_evidence/summary.json" >/dev/null || { echo "Passing deep evidence for exact HEAD required" >&2; exit 3; }
(cd "$deep_evidence" && sha256sum -c SHA256SUMS >/dev/null)

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="${output:-/home/hendo420/robyn-evidence/devnet-soak/${head_sha}/${timestamp}-schema20-eight-hour}"
mkdir -p "$output"
chmod 0700 "$output"
output="$(realpath "$output")"
case "$output" in
  /home/hendo420/robyn-evidence/devnet-soak/*) ;;
  *) echo "Unsafe soak evidence path" >&2; exit 3 ;;
esac

duration_seconds=28800
sample_seconds=60
sample_count=480
chain_advance_per_sample=3540
started_epoch="$(date +%s)"
started_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
anvil_pid=""
state_path="$output/anvil-state.json"
events="$output/events.jsonl"
samples="$output/samples.jsonl"
actions="$output/action-journal.jsonl"
touch "$events" "$samples" "$actions"
chmod 0600 "$events" "$samples" "$actions"

stop_anvil() {
  if [[ -n "$anvil_pid" ]]; then
    kill "$anvil_pid" >/dev/null 2>&1 || true
    wait "$anvil_pid" >/dev/null 2>&1 || true
    anvil_pid=""
  fi
}
seal_failure() {
  local status=$?
  if ((status != 0)); then
    jq -n --arg releaseSha "$head_sha" --arg startedAt "$started_iso" \
      --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --argjson wallSeconds "$(( $(date +%s) - started_epoch ))" \
      '{schema:20,releaseSha:$releaseSha,startedAt:$startedAt,completedAt:$completedAt,wallSeconds:$wallSeconds,requiredWallSeconds:28800,passed:false}' \
      >"$output/summary.json"
    (cd "$output" && find . -maxdepth 1 -type f ! -name SHA256SUMS -printf '%P\n' | sort | xargs -r sha256sum >.SHA256SUMS.tmp && mv .SHA256SUMS.tmp SHA256SUMS)
  fi
  stop_anvil
  exit "$status"
}
trap seal_failure EXIT

event() {
  jq -cn --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg event "$1" --arg detail "${2:-}" \
    '{at:$at,event:$event,detail:$detail}' >>"$events"
}
start_anvil() {
  local load=()
  [[ -s "$state_path" ]] && load=(--load-state "$state_path")
  anvil --host 127.0.0.1 --port 28547 --chain-id 31337 --accounts 10 --balance 10000 \
    --code-size-limit 1000000 --disable-block-gas-limit \
    --dump-state "$state_path" "${load[@]}" --silent >>"$output/anvil.log" 2>&1 &
  anvil_pid="$!"
  for _ in $(seq 1 200); do
    [[ "$(cast chain-id --rpc-url http://127.0.0.1:28547 2>/dev/null || true)" == "31337" ]] && return 0
    sleep 0.1
  done
  echo "Anvil failed to become ready" >&2
  return 1
}

if cast chain-id --rpc-url http://127.0.0.1:28547 >/dev/null 2>&1; then
  echo "Loopback soak port 28547 is already in use" >&2
  exit 4
fi
start_anvil
event anvil_started

node scripts/run-schema20-rdao-anvil-broadcast.mjs \
  --rpc-url http://127.0.0.1:28547 --output "$output/deployment.json" \
  >"$output/deployment.log" 2>&1
node scripts/run-schema20-rdao-lifecycle.mjs \
  --rpc-url http://127.0.0.1:28547 --deployment "$output/deployment.json" \
  --output "$output/lifecycle.json" >"$output/lifecycle.log" 2>&1
node scripts/snapshot-schema20-soak.mjs \
  --rpc-url http://127.0.0.1:28547 --lifecycle "$output/lifecycle.json" \
  >>"$samples"
initial_chain_timestamp="$(tail -1 "$samples" | jq -r '.chainTimestamp')"
event lifecycle_passed

ROBYN_TORTURE_LAUNCH_COUNT=64 ROBYN_TORTURE_ACTION_COUNT=100000 \
  ROBYN_TORTURE_SEED_COUNT=50 ROBYN_TORTURE_BASE_SEED=2048001 \
  forge test --root packages/contracts \
    --match-path test/RobynV4HundredsUsersSimulation.t.sol -vv \
    >"$output/simulation.log" 2>&1
event simulation_passed "512 wallets, 64 launches, 100000 actions, 50 seeds"

for minute in $(seq 1 "$sample_count"); do
  target_epoch=$((started_epoch + minute * sample_seconds))
  now="$(date +%s)"
  ((now < target_epoch)) && sleep "$((target_epoch - now))"
  cast rpc --rpc-url http://127.0.0.1:28547 evm_increaseTime "$chain_advance_per_sample" >/dev/null
  cast rpc --rpc-url http://127.0.0.1:28547 evm_mine >/dev/null
  node scripts/snapshot-schema20-soak.mjs \
    --rpc-url http://127.0.0.1:28547 --lifecycle "$output/lifecycle.json" \
    >>"$samples"
  if ((minute % 10 == 0)); then
    cycle=$((minute / 10))
    node scripts/run-schema20-soak-actions.mjs \
      --rpc-url http://127.0.0.1:28547 --lifecycle "$output/lifecycle.json" \
      --journal "$actions" --cycle "$cycle" >>"$output/actions.log" 2>&1
    node scripts/snapshot-schema20-soak.mjs \
      --rpc-url http://127.0.0.1:28547 --lifecycle "$output/lifecycle.json" \
      >>"$samples"
    event durable_inspection "minute=$minute cycle=$cycle"
  fi
  if ((minute == 120 || minute == 240 || minute == 360)); then
    stop_anvil
    if cast chain-id --rpc-url http://127.0.0.1:28547 >/dev/null 2>&1; then
      echo "RPC degradation injection did not stop the isolated node" >&2
      exit 5
    fi
    event rpc_degraded_expected "minute=$minute"
    [[ -s "$state_path" ]] || { echo "Anvil state dump missing" >&2; exit 5; }
    start_anvil
    node scripts/snapshot-schema20-soak.mjs \
      --rpc-url http://127.0.0.1:28547 --lifecycle "$output/lifecycle.json" \
      >>"$samples"
    event process_restart_recovered "minute=$minute"
  fi
done

completed_epoch="$(date +%s)"
wall_seconds=$((completed_epoch - started_epoch))
((wall_seconds >= duration_seconds)) || { echo "Soak ended before eight real hours" >&2; exit 6; }
final_chain_timestamp="$(tail -1 "$samples" | jq -r '.chainTimestamp')"
chain_seconds=$((final_chain_timestamp - initial_chain_timestamp))
((chain_seconds >= 1728000)) || { echo "Soak did not cover 20 simulated days" >&2; exit 6; }
confirmed="$(jq -s '[.[] | select(.state=="confirmed")] | length' "$actions")"
duplicates="$(jq -s '[.[] | select(.state=="confirmed") | .idempotencyKey] | length - (unique | length)' "$actions")"
((duplicates == 0)) || { echo "Duplicate confirmed idempotency key" >&2; exit 6; }

jq -n \
  --arg releaseSha "$head_sha" --arg startedAt "$started_iso" \
  --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg deepEvidence "$(realpath "$deep_evidence")" \
  --argjson wallSeconds "$wall_seconds" --argjson chainSeconds "$chain_seconds" \
  --argjson oneMinuteSamples "$(wc -l <"$samples")" \
  --argjson confirmedMaintenanceTransactions "$confirmed" \
  '{schema:20,releaseSha:$releaseSha,startedAt:$startedAt,completedAt:$completedAt,
    deepEvidence:$deepEvidence,wallSeconds:$wallSeconds,requiredWallSeconds:28800,
    chainSeconds:$chainSeconds,requiredChainSeconds:1728000,oneMinuteSamples:$oneMinuteSamples,
    confirmedMaintenanceTransactions:$confirmedMaintenanceTransactions,simulation:{wallets:512,launches:64,actions:100000,seeds:50},passed:true,
    assuranceScope:"internal-only"}' >"$output/summary.json"
(cd "$output" && find . -maxdepth 1 -type f ! -name SHA256SUMS -printf '%P\n' | sort | xargs -r sha256sum >.SHA256SUMS.tmp && mv .SHA256SUMS.tmp SHA256SUMS && sha256sum -c SHA256SUMS >/dev/null)
chmod 0600 "$output"/*
trap - EXIT
stop_anvil
echo "$output"

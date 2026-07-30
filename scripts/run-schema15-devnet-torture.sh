#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

tier=""
seed=""
release_sha=""
output=""
while (($#)); do
  case "$1" in
    --tier) tier="${2:?missing tier}"; shift 2 ;;
    --seed) seed="${2:?missing seed}"; shift 2 ;;
    --release-sha) release_sha="${2:?missing release SHA}"; shift 2 ;;
    --output) output="${2:?missing output path}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ "$tier" == "fast" || "$tier" == "deep" ]] || {
  echo "--tier must be fast or deep" >&2
  exit 2
}
[[ "$seed" =~ ^[0-9]+$ ]] || {
  echo "--seed must be an unsigned decimal integer" >&2
  exit 2
}
[[ "$EUID" -ne 0 ]] || {
  echo "Run the torture gate as the unprivileged release operator" >&2
  exit 2
}

head_sha="$(git rev-parse HEAD)"
release_sha="${release_sha:-$head_sha}"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ && "$release_sha" == "$head_sha" ]] || {
  echo "Requested release SHA must exactly match HEAD" >&2
  exit 3
}
[[ -z "$(git status --porcelain)" ]] || {
  echo "Schema-15 torture requires a clean checkout" >&2
  exit 3
}
upstream="$(git rev-parse '@{u}')"
[[ "$upstream" == "$head_sha" ]] || {
  echo "Schema-15 torture requires the exact pushed commit" >&2
  exit 3
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="${output:-/home/hendo420/robyn-evidence/devnet-torture/${head_sha}/${timestamp}-${tier}}"
mkdir -p "$output"
chmod 0700 "$output"
output="$(realpath "$output")"
case "$output" in
  /home/hendo420/robyn-evidence/devnet-torture/*) ;;
  *) echo "Output must be below the protected Devnet torture evidence root" >&2; exit 3 ;;
esac

work="$(mktemp -d /tmp/robyn-schema15-torture.XXXXXX)"
anvil_pid=""
coverage_node_modules_created=false
cleanup() {
  if [[ -n "$anvil_pid" ]]; then
    kill "$anvil_pid" >/dev/null 2>&1 || true
    wait "$anvil_pid" >/dev/null 2>&1 || true
  fi
  case "$work" in
    /tmp/robyn-schema15-torture.*) rm -rf -- "$work" ;;
    *) echo "Refusing unsafe torture cleanup path: $work" >&2 ;;
  esac
  if [[ "$coverage_node_modules_created" == "true" ]]; then
    rm -- "$repo_root/packages/contracts/node_modules"
  fi
}

events="$output/events.jsonl"
touch "$events"
chmod 0600 "$events"
started_epoch="$(date +%s)"
failed_phase=""

finish() {
  local status=$?
  if ((status != 0)) && [[ ! -f "$output/summary.json" ]]; then
    jq -n \
      --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --arg tier "$tier" \
      --arg seed "$seed" \
      --arg releaseSha "$head_sha" \
      --arg durationSeconds "$(( $(date +%s) - started_epoch ))" \
      --arg failedPhase "${failed_phase:-bootstrap}" \
      '{
        schemaVersion:1,completedAt:$completedAt,schema:15,tier:$tier,seed:$seed,
        releaseSha:$releaseSha,durationSeconds:($durationSeconds|tonumber),
        passed:false,failedPhase:$failedPhase,assuranceScope:"internal-only"
      }' >"$output/summary.json"
    chmod 0600 "$output/summary.json"
    (cd "$output" && find . -maxdepth 1 -type f ! -name SHA256SUMS -printf '%P\n' \
      | sort | xargs -r sha256sum >SHA256SUMS)
    chmod 0600 "$output/SHA256SUMS"
  fi
  cleanup
  exit "$status"
}
trap finish EXIT

record_event() {
  local phase="$1" status="$2" duration="$3" log="$4" command="$5"
  local log_hash=""
  [[ -f "$log" ]] && log_hash="$(sha256sum "$log" | cut -d' ' -f1)"
  jq -cn \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg phase "$phase" \
    --arg status "$status" \
    --arg durationSeconds "$duration" \
    --arg log "$(basename "$log")" \
    --arg logSha256 "$log_hash" \
    --arg command "$command" \
    '{at:$at,phase:$phase,status:$status,durationSeconds:($durationSeconds|tonumber),
      log:$log,logSha256:$logSha256,command:$command}' >>"$events"
}

run_phase() {
  local phase="$1" command_label="$2"
  shift 2
  local log="$output/${phase}.log"
  local phase_started status
  phase_started="$(date +%s)"
  set +e
  "$@" >"$log" 2>&1
  status=$?
  set -e
  local duration=$(( $(date +%s) - phase_started ))
  if ((status == 0)); then
    record_event "$phase" passed "$duration" "$log" "$command_label"
  else
    record_event "$phase" failed "$duration" "$log" "$command_label"
    failed_phase="$phase"
    return "$status"
  fi
}

fuzz_runs=1024
invariant_runs=256
invariant_depth=128
simulation_launches=32
simulation_actions=25000
simulation_seeds=20
invariant_seed_count=1
if [[ "$tier" == "deep" ]]; then
  fuzz_runs=10000
  invariant_runs=1024
  invariant_depth=256
  simulation_launches=64
  simulation_actions=100000
  simulation_seeds=50
  invariant_seed_count=20
fi

jq -n \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg tier "$tier" \
  --arg seed "$seed" \
  --arg releaseSha "$head_sha" \
  --arg branch "$(git branch --show-current)" \
  --arg upstream "$upstream" \
  --arg forgeVersion "$(forge --version | head -1)" \
  --arg anvilVersion "$(anvil --version | head -1)" \
  --argjson fuzzRuns "$fuzz_runs" \
  --argjson invariantRuns "$invariant_runs" \
  --argjson invariantDepth "$invariant_depth" \
  --argjson simulationLaunches "$simulation_launches" \
  --argjson simulationActions "$simulation_actions" \
  --argjson simulationSeeds "$simulation_seeds" \
  '{
    schemaVersion:1,generatedAt:$generatedAt,schema:15,tier:$tier,
    seed:$seed,releaseSha:$releaseSha,branch:$branch,upstream:$upstream,
    chainId:31337,anvilPort:28546,mainnetAccess:false,testnetWrites:false,
    forgeVersion:$forgeVersion,anvilVersion:$anvilVersion,
    configuration:{
      fuzzRuns:$fuzzRuns,invariantRuns:$invariantRuns,invariantDepth:$invariantDepth,
      wallets:512,simulationLaunches:$simulationLaunches,
      simulationActions:$simulationActions,simulationSeeds:$simulationSeeds
    }
  }' >"$output/run.json"
chmod 0600 "$output/run.json"

if cast chain-id --rpc-url http://127.0.0.1:28546 >/dev/null 2>&1; then
  echo "Loopback torture port 28546 is already in use" >&2
  exit 4
fi
mkdir -p "$work/anvil-state"
anvil \
  --host 127.0.0.1 \
  --port 28546 \
  --chain-id 31337 \
  --accounts 10 \
  --balance 10000 \
  --config-out "$work/anvil-state/accounts.json" \
  --silent >"$output/anvil.log" 2>&1 &
anvil_pid="$!"
for _ in $(seq 1 200); do
  if [[ "$(cast chain-id --rpc-url http://127.0.0.1:28546 2>/dev/null || true)" == "31337" ]]; then
    break
  fi
  sleep 0.1
done
[[ "$(cast chain-id --rpc-url http://127.0.0.1:28546)" == "31337" ]] || {
  echo "Isolated Anvil did not start on chain 31337" >&2
  exit 4
}

run_phase compile "forge build exact Schema-15 contracts" \
  forge build --root packages/contracts

run_phase coverage_scope \
  "derive exact production and accelerated Schema-15 artifact closure" \
  node scripts/build-schema15-coverage-scope.mjs \
    --definition scripts/schema15-coverage-scope.json \
    --contracts-root packages/contracts \
    --release-sha "$head_sha" \
    --output "$output/coverage-scope.json"
scope_sha="$(jq -er '.scopeSha256' "$output/coverage-scope.json")"
jq --arg coverageScopeSha256 "$scope_sha" \
  '. + {coverageScopeSha256:$coverageScopeSha256}' \
  "$output/run.json" >"$work/run-scoped.json"
mv "$work/run-scoped.json" "$output/run.json"
chmod 0600 "$output/run.json"

run_phase unit_and_deterministic \
  "forge test all unit and deterministic scenarios; fuzz=${fuzz_runs}" \
  env FOUNDRY_FUZZ_RUNS="$fuzz_runs" \
    FOUNDRY_FUZZ_SEED="$seed" \
    forge test --root packages/contracts -vv

for ((offset=0; offset<invariant_seed_count; ++offset)); do
  current_seed="$((seed + offset))"
  run_phase "invariant_protocol_${offset}" \
    "Schema-15 protocol invariants runs=${invariant_runs} depth=${invariant_depth} seed=${current_seed}" \
    env FOUNDRY_INVARIANT_RUNS="$invariant_runs" \
      FOUNDRY_INVARIANT_DEPTH="$invariant_depth" \
      FOUNDRY_FUZZ_SEED="$current_seed" \
      forge test --root packages/contracts \
        --match-path test/RobynProtocolInvariant.t.sol -vv
  run_phase "invariant_v4_${offset}" \
    "Schema-15 v4 invariants runs=${invariant_runs} depth=${invariant_depth} seed=${current_seed}" \
    env FOUNDRY_INVARIANT_RUNS="$invariant_runs" \
      FOUNDRY_INVARIANT_DEPTH="$invariant_depth" \
      FOUNDRY_FUZZ_SEED="$current_seed" \
      forge test --root packages/contracts \
        --match-path test/RobynV4ProtocolInvariant.t.sol -vv
done

run_phase economic_simulation \
  "512-wallet simulation launches=${simulation_launches} actions=${simulation_actions} seeds=${simulation_seeds}" \
  env ROBYN_TORTURE_LAUNCH_COUNT="$simulation_launches" \
    ROBYN_TORTURE_ACTION_COUNT="$simulation_actions" \
    ROBYN_TORTURE_SEED_COUNT="$simulation_seeds" \
    ROBYN_TORTURE_BASE_SEED="$seed" \
    forge test --root packages/contracts \
      --match-path test/RobynV4HundredsUsersSimulation.t.sol -vv

run_phase anvil_broadcast \
  "ephemeral-key exact launch-token production/accelerated broadcast lifecycle on 31337" \
  node scripts/run-schema15-anvil-broadcast.mjs \
    --rpc-url http://127.0.0.1:28546 \
    --output "$output/anvil-broadcast.json"

if [[ ! -e "$repo_root/packages/contracts/node_modules" ]]; then
  ln -s ../../node_modules "$repo_root/packages/contracts/node_modules"
  coverage_node_modules_created=true
fi
[[ -L "$repo_root/packages/contracts/node_modules" ]] || {
  echo "Coverage dependency path must be the local node_modules symlink" >&2
  exit 4
}

run_phase coverage \
  "forge coverage LCOV for protocol sources with normalized local remappings" \
  forge coverage --root packages/contracts --ir-minimum \
    --skip Schema15DevnetTorture \
    --skip RobinhoodMainnet \
    --skip RobynV4HundredsUsersSimulation \
    --skip SchemaV4HundredsUsersSimulation \
    --no-match-coverage node_modules \
    --report lcov \
    --report-file "$output/lcov.info" \
    -R @openzeppelin/contracts/=node_modules/@openzeppelin/contracts/ \
    -R forge-std/=node_modules/@uniswap/v4-core/lib/forge-std/src/ \
    -R @uniswap/v4-core/=node_modules/@uniswap/v4-core/ \
    -R @uniswap/v4-periphery/=node_modules/@uniswap/v4-periphery/ \
    -R permit2/=node_modules/@uniswap/v4-periphery/lib/permit2/ \
    -R solmate/=node_modules/@uniswap/v4-periphery/lib/permit2/lib/solmate/

run_phase evidence_validation \
  "validate action matrix and 90/80 coverage thresholds" \
  node scripts/validate-schema15-torture-evidence.mjs \
    --matrix scripts/schema15-torture-matrix.json \
    --scope "$output/coverage-scope.json" \
    --test-log "$output/unit_and_deterministic.log" \
    --lcov "$output/lcov.info" \
    --output "$output/validation.json"

completed_epoch="$(date +%s)"
jq -n \
  --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg tier "$tier" \
  --arg seed "$seed" \
  --arg releaseSha "$head_sha" \
  --arg durationSeconds "$((completed_epoch - started_epoch))" \
  --arg evidenceEventsSha256 "$(sha256sum "$events" | cut -d' ' -f1)" \
  '{
    schemaVersion:1,completedAt:$completedAt,schema:15,tier:$tier,seed:$seed,
    releaseSha:$releaseSha,durationSeconds:($durationSeconds|tonumber),
    passed:true,failedPhase:null,evidenceEventsSha256:$evidenceEventsSha256,
    assuranceScope:"internal-only",
    exclusions:["independent audit","external penetration test","legal review",
      "Mainnet liquidity validation","Mainnet deployment authorization"]
  }' >"$output/summary.json"
chmod 0600 "$output/summary.json"
(cd "$output" && find . -maxdepth 1 -type f ! -name SHA256SUMS -printf '%P\n' \
  | sort | xargs sha256sum >SHA256SUMS)
chmod 0600 "$output/SHA256SUMS"
(cd "$output" && sha256sum -c SHA256SUMS >/dev/null)
printf 'schema15DevnetTorture=passed\ntier=%s\nseed=%s\nevidence=%s\n' \
  "$tier" "$seed" "$output/summary.json"

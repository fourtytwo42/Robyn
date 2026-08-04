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
  echo "Schema-20 torture requires a clean checkout" >&2
  exit 3
}
upstream="$(git rev-parse '@{u}')"
[[ "$upstream" == "$head_sha" ]] || {
  echo "Schema-20 torture requires the exact pushed commit" >&2
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

work="$(mktemp -d /tmp/robyn-schema20-torture.XXXXXX)"
anvil_pid=""
cleanup() {
  if [[ -n "$anvil_pid" ]]; then
    kill "$anvil_pid" >/dev/null 2>&1 || true
    wait "$anvil_pid" >/dev/null 2>&1 || true
  fi
  case "$work" in
    /tmp/robyn-schema20-torture.*) rm -rf -- "$work" ;;
    *) echo "Refusing unsafe torture cleanup path: $work" >&2 ;;
  esac
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
        schemaVersion:1,completedAt:$completedAt,schema:20,tier:$tier,seed:$seed,
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

prepare_coverage_project() {
  local project="$1" scope="$2"
  mkdir -p "$project/packages/contracts/test"
  cp "$repo_root/packages/contracts/foundry.toml" "$project/packages/contracts/foundry.toml"
  cp -a "$repo_root/packages/contracts/src" "$project/packages/contracts/src"
  while IFS= read -r source; do
    local target="$project/packages/contracts/$source"
    case "$target" in
      "$project"/packages/contracts/src/*) rm -f -- "$target" ;;
      *) echo "Refusing coverage exclusion outside temporary src: $target" >&2; return 1 ;;
    esac
  done < <(jq -r '.coverageCompileExcludedSources[]' "$scope")
  while IFS= read -r test_file; do
    cp "$repo_root/packages/contracts/test/$test_file" "$project/packages/contracts/test/$test_file"
  done < <(jq -r '.coverageTests[]' "$scope")
  for support in fixtures harness mocks; do
    if [[ -d "$repo_root/packages/contracts/test/$support" ]]; then
      cp -a "$repo_root/packages/contracts/test/$support" \
        "$project/packages/contracts/test/$support"
    fi
  done
  ln -s "$repo_root/node_modules" "$project/node_modules"
  ln -s ../../node_modules "$project/packages/contracts/node_modules"
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
    schemaVersion:1,generatedAt:$generatedAt,schema:20,tier:$tier,
    seed:$seed,releaseSha:$releaseSha,branch:$branch,upstream:$upstream,
    chainId:31337,anvilPort:28547,mainnetAccess:false,testnetWrites:false,
    forgeVersion:$forgeVersion,anvilVersion:$anvilVersion,
    configuration:{
      fuzzRuns:$fuzzRuns,invariantRuns:$invariantRuns,invariantDepth:$invariantDepth,
      wallets:512,simulationLaunches:$simulationLaunches,
      simulationActions:$simulationActions,simulationSeeds:$simulationSeeds
    }
  }' >"$output/run.json"
chmod 0600 "$output/run.json"

if cast chain-id --rpc-url http://127.0.0.1:28547 >/dev/null 2>&1; then
  echo "Loopback torture port 28547 is already in use" >&2
  exit 4
fi
mkdir -p "$work/anvil-state"
anvil \
  --host 127.0.0.1 \
  --port 28547 \
  --chain-id 31337 \
  --accounts 10 \
  --balance 10000 \
  --code-size-limit 1000000 \
  --disable-block-gas-limit \
  --config-out "$work/anvil-state/accounts.json" \
  --silent >"$output/anvil.log" 2>&1 &
anvil_pid="$!"
for _ in $(seq 1 200); do
  if [[ "$(cast chain-id --rpc-url http://127.0.0.1:28547 2>/dev/null || true)" == "31337" ]]; then
    break
  fi
  sleep 0.1
done
[[ "$(cast chain-id --rpc-url http://127.0.0.1:28547)" == "31337" ]] || {
  echo "Isolated Anvil did not start on chain 31337" >&2
  exit 4
}

run_phase compile "forge build exact Schema-20 contracts" \
  forge build --root packages/contracts

run_phase coverage_scope \
  "derive exact production and accelerated Schema-20 artifact closure" \
  node scripts/build-schema-coverage-scope.mjs \
    --definition scripts/schema20-coverage-scope.json \
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
    "Schema-20 protocol invariants runs=${invariant_runs} depth=${invariant_depth} seed=${current_seed}" \
    env FOUNDRY_INVARIANT_RUNS="$invariant_runs" \
      FOUNDRY_INVARIANT_DEPTH="$invariant_depth" \
      FOUNDRY_FUZZ_SEED="$current_seed" \
      forge test --root packages/contracts \
        --match-path test/RobynProtocolInvariant.t.sol -vv
  run_phase "invariant_v4_${offset}" \
    "Schema-20 v4 invariants runs=${invariant_runs} depth=${invariant_depth} seed=${current_seed}" \
    env FOUNDRY_INVARIANT_RUNS="$invariant_runs" \
      FOUNDRY_INVARIANT_DEPTH="$invariant_depth" \
      FOUNDRY_FUZZ_SEED="$current_seed" \
      forge test --root packages/contracts \
        --match-path test/RobynV4ProtocolInvariant.t.sol -vv
  run_phase "invariant_schema20_maintenance_${offset}" \
    "Schema-20 maintenance invariants runs=${invariant_runs} depth=${invariant_depth} seed=${current_seed}" \
    env FOUNDRY_INVARIANT_RUNS="$invariant_runs" \
      FOUNDRY_INVARIANT_DEPTH="$invariant_depth" \
      FOUNDRY_FUZZ_SEED="$current_seed" \
      forge test --root packages/contracts \
        --match-path test/Schema19MaintenanceInvariant.t.sol -vv

  run_phase "invariant_schema20_rdao_${offset}" \
    "Schema-20 RDAO invariants runs=${invariant_runs} depth=${invariant_depth} seed=${current_seed}" \
    env FOUNDRY_INVARIANT_RUNS="$invariant_runs" \
      FOUNDRY_INVARIANT_DEPTH="$invariant_depth" \
      FOUNDRY_FUZZ_SEED="$current_seed" \
      forge test --root packages/contracts \
        --match-path test/Schema20RdaoInvariant.t.sol -vv

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
  node scripts/run-schema20-rdao-anvil-broadcast.mjs \
    --rpc-url http://127.0.0.1:28547 \
    --output "$output/anvil-broadcast.json"

coverage_project="$work/coverage-project"
run_phase coverage_project \
  "prepare exact Schema-20 source and test compile closure" \
  prepare_coverage_project "$coverage_project" "$output/coverage-scope.json"

run_phase coverage \
  "forge coverage LCOV for the optimizer-disabled exact Schema-20 compile closure" \
  forge coverage --root "$coverage_project/packages/contracts" \
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
  node scripts/validate-schema20-torture-evidence.mjs \
    --matrix scripts/schema20-torture-matrix.json \
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
        schemaVersion:1,completedAt:$completedAt,schema:20,tier:$tier,seed:$seed,
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
printf 'schema20DevnetTorture=passed\ntier=%s\nseed=%s\nevidence=%s\n' \
  "$tier" "$seed" "$output/summary.json"

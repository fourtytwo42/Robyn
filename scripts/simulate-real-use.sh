#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

evidence_root="${ROBYN_SIMULATION_EVIDENCE_ROOT:-$repo_root/evidence/system-simulation}"
run_id="${ROBYN_SIMULATION_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
run_dir="$evidence_root/$run_id"
mkdir -p "$run_dir"

started_at="$(date -u +%FT%TZ)"
started_seconds="$(date +%s)"
git_sha="$(git rev-parse HEAD)"

set +e
forge test \
  --root packages/contracts \
  --match-contract SchemaV4HundredsUsersSimulationTest \
  -vv \
  | tee "$run_dir/contracts.log"
contract_status="${PIPESTATUS[0]}"

LOAD_DURATION_SECONDS="${LOAD_DURATION_SECONDS:-60}" \
LOAD_REQUESTS_PER_SECOND="${LOAD_REQUESTS_PER_SECOND:-100}" \
LOAD_CONCURRENCY="${LOAD_CONCURRENCY:-200}" \
LOAD_VIRTUAL_USERS="${LOAD_VIRTUAL_USERS:-256}" \
LOAD_USE_INTERNAL_BACKENDS=true \
LOAD_P95_LIMIT_MS="${LOAD_P95_LIMIT_MS:-750}" \
LOAD_OUTPUT="$run_dir/http-load.json" \
  node scripts/load-test.mjs | tee "$run_dir/http-load.log"
http_status="${PIPESTATUS[0]}"
set -e

finished_at="$(date -u +%FT%TZ)"
finished_seconds="$(date +%s)"
jq -n \
  --arg runId "$run_id" \
  --arg gitSha "$git_sha" \
  --arg startedAt "$started_at" \
  --arg finishedAt "$finished_at" \
  --argjson durationSeconds "$((finished_seconds - started_seconds))" \
  --argjson modeledUsers 256 \
  --argjson launches 8 \
  --argjson governanceVoters 100 \
  --argjson contractStatus "$contract_status" \
  --argjson httpStatus "$http_status" \
  --slurpfile http "$run_dir/http-load.json" \
  '{
    schemaVersion: 1,
    runId: $runId,
    gitSha: $gitSha,
    startedAt: $startedAt,
    finishedAt: $finishedAt,
    durationSeconds: $durationSeconds,
    passed: ($contractStatus == 0 and $httpStatus == 0 and $http[0].passed == true),
    phases: {
      contracts: {status: $contractStatus, passed: ($contractStatus == 0)},
      http: {status: $httpStatus, passed: ($httpStatus == 0 and $http[0].passed == true)}
    },
    workload: {
      modeledUsers: $modeledUsers,
      launches: $launches,
      governanceVoters: $governanceVoters,
      lifecycle: [
        "atomic launch",
        "bonding buys and sells",
        "automatic graduation",
        "post-graduation buy and sell",
        "basket conversion",
        "native fee conversion",
        "holder claims",
        "creator batch claims",
        "RDAO transfer-aware rewards",
        "delegation",
        "proposal voting",
        "timelock execution"
      ]
    },
    http: $http[0]
  }' > "$run_dir/summary.json"

sha256sum "$run_dir/contracts.log" "$run_dir/http-load.json" "$run_dir/summary.json" \
  > "$run_dir/SHA256SUMS"
cat "$run_dir/summary.json"
if [[ "$contract_status" -ne 0 || "$http_status" -ne 0 ]]; then
  exit 1
fi

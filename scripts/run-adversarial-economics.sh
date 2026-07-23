#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
evidence_root="${ECONOMIC_EVIDENCE_ROOT:-/var/backups/robyn/economic-simulation}"
run_id="${ECONOMIC_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
output="${evidence_root}/${run_id}"
mkdir -p "${output}"
export PATH="$HOME/.foundry/bin:$PATH"
export FOUNDRY_PROFILE=assurance

cd "${repo}"
git_sha="$(git rev-parse HEAD)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

forge test \
  --root packages/contracts \
  --match-contract SchemaV4HundredsUsersSimulationTest \
  -vv >"${output}/economic-campaign.log" 2>&1

forge test \
  --root packages/contracts \
  --match-contract RobynProtocolInvariantTest \
  -vv >"${output}/assurance-invariants.log" 2>&1

finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
economic_hash="$(sha256sum "${output}/economic-campaign.log" | cut -d' ' -f1)"
invariant_hash="$(sha256sum "${output}/assurance-invariants.log" | cut -d' ' -f1)"

jq -n \
  --arg generatedAt "${finished_at}" \
  --arg startedAt "${started_at}" \
  --arg gitSha "${git_sha}" \
  --arg economicLogSha256 "${economic_hash}" \
  --arg invariantLogSha256 "${invariant_hash}" \
  '{
    schemaVersion: 1,
    generatedAt: $generatedAt,
    startedAt: $startedAt,
    gitSha: $gitSha,
    campaign: {
      wallets: 512,
      launches: 32,
      economicActions: 25000,
      deterministicSeeds: 20,
      delegatedVoters: 100
    },
    invariants: {
      runs: 256,
      depth: 128,
      failOnRevert: true
    },
    assertions: [
      "fixed launch and RDAO supply",
      "50/25/20/5 fee conservation",
      "creator and DAO liability solvency",
      "immutable launch/factory bindings",
      "sealed reward exclusions",
      "atomic rollback and pause safety",
      "allowance cleanup and bounded conversion",
      "governance snapshot and timelock execution"
    ],
    evidence: {
      economicLogSha256: $economicLogSha256,
      invariantLogSha256: $invariantLogSha256
    },
    passed: true
  }' >"${output}/summary.json"

(
  cd "${output}"
  sha256sum economic-campaign.log assurance-invariants.log summary.json >SHA256SUMS
)
printf 'economicSimulation=passed\nrun=%s\ngitSha=%s\nsummary=%s\n' \
  "${run_id}" "${git_sha}" "${output}/summary.json"

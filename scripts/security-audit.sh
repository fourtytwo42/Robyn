#!/usr/bin/env bash
set -euo pipefail

repo="/home/hendo420/Robyn"
output="${SECURITY_AUDIT_OUTPUT:-/tmp/robyn-security-audit.json}"
work="$(mktemp -d)"
trap 'rm -rf -- "${work}"' EXIT
export PATH="/home/hendo420/.foundry/bin:${PATH}"
slither="/home/hendo420/.local/bin/slither"
solc="/home/hendo420/.local/share/svm/0.8.30/solc-0.8.30"

for tool in forge gitleaks jq node pnpm; do
  command -v "${tool}" >/dev/null || {
    echo "Missing required security tool: ${tool}" >&2
    exit 1
  }
done
[[ -x "${slither}" ]] || {
  echo "Missing Slither at ${slither}" >&2
  exit 1
}
[[ -x "${solc}" ]] || {
  echo "Missing solc 0.8.30 at ${solc}" >&2
  exit 1
}

cd "${repo}"
gitleaks git --redact --report-format json --report-path "${work}/gitleaks.json" . >/dev/null
jq -e 'length == 0' "${work}/gitleaks.json" >/dev/null
pnpm audit --audit-level high --json >"${work}/pnpm-audit.json"
pnpm licenses list --json >"${work}/licenses.json"
forge test --root packages/contracts >/dev/null

set +e
(
  cd packages/contracts
  "${slither}" src     --solc "${solc}"     --solc-remaps '@openzeppelin/contracts/=/home/hendo420/Robyn/node_modules/@openzeppelin/contracts/'     --solc-args '--base-path /home/hendo420/Robyn/packages/contracts --allow-paths /home/hendo420/Robyn/node_modules'     --exclude-dependencies     --filter-paths 'src/devnet'     --json "${work}/slither.json" >/dev/null 2>"${work}/slither.log"
)
slither_status=$?
set -e
jq -e '.success == true' "${work}/slither.json" >/dev/null
high_count="$(jq '[.results.detectors[]? | select(.impact == "High")]|length' "${work}/slither.json")"
[[ "${high_count}" -eq 0 ]]

jq -n   --arg generatedAt "$(date --iso-8601=seconds)"   --arg gitSha "$(git rev-parse HEAD)"   --arg gitleaksVersion "$(gitleaks version)"   --arg slitherVersion "$("${slither}" --version)"   --argjson slitherStatus "${slither_status}"   --slurpfile slither "${work}/slither.json"   --slurpfile licenses "${work}/licenses.json"   '{
    schemaVersion: 1,
    generatedAt: $generatedAt,
    gitSha: $gitSha,
    gitleaks: {version: $gitleaksVersion, historyFindings: 0},
    dependencyAudit: {highOrCriticalKnownVulnerabilities: 0},
    contracts: {
      foundrySuitesPassed: true,
      slitherVersion: $slitherVersion,
      slitherExitStatus: $slitherStatus,
      findingsByImpact: (
        [$slither[0].results.detectors[]?.impact]
        | sort
        | group_by(.)
        | map({key: .[0], value: length})
        | from_entries
      ),
      unresolvedHigh: 0,
      findings: [
        $slither[0].results.detectors[]?
        | {check, impact, confidence, summary: (.description | split("\n")[0])}
      ]
    },
    licenseInventory: {
      groups: ($licenses[0] | keys | length),
      packages: ($licenses[0] | to_entries | map(.value | length) | add),
      reviewedCopyleftRuntimePackages: [
        $licenses[0]["AGPL-3.0"][]? | {name, versions, license}
      ]
    },
    passed: true
  }' >"${output}"
jq -e '.passed == true and .contracts.unresolvedHigh == 0' "${output}" >/dev/null
cat "${output}"

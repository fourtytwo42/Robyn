#!/usr/bin/env bash
set -euo pipefail

repo=$(cd $(dirname ${BASH_SOURCE[0]})/.. && pwd)
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
router_bytecode="$(forge inspect --root packages/contracts RobynV4AssetRouter deployedBytecode)"
router_bytecode="${router_bytecode#0x}"
router_bytecode_bytes=$(( ${#router_bytecode} / 2 ))
if (( router_bytecode_bytes > 24576 )); then
  echo "RobynV4AssetRouter runtime bytecode is ${router_bytecode_bytes} bytes; EIP-170 permits at most 24576" >&2
  exit 1
fi

set +e
(
  cd packages/contracts
  "${slither}" src \
    --solc "${solc}" \
    --solc-remaps=@openzeppelin/contracts/=${repo}/node_modules/@openzeppelin/contracts/ \
    --solc-args=--base-path\ ${repo}/packages/contracts\ --allow-paths\ ${repo}/node_modules \
    --exclude-dependencies \
    --include-paths 'src/(Robyn(LaunchToken|TokenSink)\.sol|dao/Robyn(DaoToken|TestnetGovernor)\.sol|uniswap/(I?Robyn(ExecutionAdapter|PriceGuard)|Robyn(Native(BasketVaultV2|LaunchDeployerV4|LaunchFactoryV4|ProtocolFeeRouterV4|VaultDeployerV4)|V4(AdapterDeployer|AssetRouter|BondingCurveMarket|FeeAndPhaseHook|FeePositionLocker|GraduationAdapter|LaunchCoordinatorV5|LockerDeployer|MarketDeployer|MarketFactory|TestAssetLiquidityLocker)|ZeroExAllowanceHolderAdapter))\.sol)' \
    --json "${work}/slither.json" >/dev/null 2>"${work}/slither.log"
)
slither_status=$?
set -e
jq -e '.success == true' "${work}/slither.json" >/dev/null
high_count="$(jq '[.results.detectors[]? | select(.impact == "High")]|length' "${work}/slither.json")"
reviewed_high=0
while IFS=$'\t' read -r check description; do
  case "${check}" in
    arbitrary-send-eth)
      if [[ "${description}" == *"RobynNativeProtocolFeeRouterV4.settleBasketFees"* && "${description}" == *"account.vault.recordFees"* ]]; then
        reviewed_high=$((reviewed_high + 1))
      elif [[ "${description}" == *"RobynV4AssetRouter._swapExactAssetForNative"* &&
              "${description}" == *"recipient.call{value: amountIn}"* ]]; then
        reviewed_high=$((reviewed_high + 1))
      else
        echo "Untriaged high Slither detector in the active remediation scope: ${check}" >&2
        exit 1
      fi
      ;;
    reentrancy-balance)
      if [[ "${description}" == *"RobynNativeBasketVaultV2._convertLeg"* ||
            "${description}" == *"RobynV4AssetRouter._swapExactAssetForNative"* ||
            "${description}" == *"RobynV4AssetRouter._swapExactNativeForAsset"* ]]; then
        reviewed_high=$((reviewed_high + 1))
      else
        echo "Untriaged high Slither detector in the active remediation scope: ${check}" >&2
        exit 1
      fi
      ;;
    reentrancy-eth)
      if [[ "${description}" == *"RobynV4BondingCurveMarket._buyBonding"* && "${description}" == *"curveNativePrincipal = 0"* ]]; then
        reviewed_high=$((reviewed_high + 1))
      elif [[ "${description}" == *"RobynNativeBasketVaultV2._convertLeg"* ]]; then
        reviewed_high=$((reviewed_high + 1))
      else
        echo "Untriaged high Slither detector in the active remediation scope: ${check}" >&2
        exit 1
      fi
      ;;
    *)
      echo "Untriaged high Slither detector in the active remediation scope: ${check}" >&2
      exit 1
      ;;
  esac
done < <(jq -r '.results.detectors[]? | select(.impact == "High") | [.check,.description] | @tsv' "${work}/slither.json")
[[ "${reviewed_high}" -eq "${high_count}" ]]
medium_count="$(jq '[.results.detectors[]? | select(.impact == "Medium")]|length' "${work}/slither.json")"
while IFS= read -r check; do
  case "${check}" in
    incorrect-equality|reentrancy-no-eth|uninitialized-local|unused-return) ;;
    *)
      echo "Untriaged medium Slither detector in active remediation scope: ${check}" >&2
      exit 1
      ;;
  esac
done < <(jq -r '.results.detectors[]? | select(.impact == "Medium") | .check' "${work}/slither.json" | sort -u)

jq -n   --arg generatedAt "$(date --iso-8601=seconds)"   --arg gitSha "$(git rev-parse HEAD)"   --arg gitleaksVersion "$(gitleaks version)"   --arg slitherVersion "$("${slither}" --version)"   --argjson slitherStatus "${slither_status}"   --argjson routerBytecodeBytes "${router_bytecode_bytes}"   --argjson reviewedHigh "${reviewed_high}"   --argjson reviewedMedium "${medium_count}"   --slurpfile slither "${work}/slither.json"   --slurpfile licenses "${work}/licenses.json"   '{
    schemaVersion: 1,
    generatedAt: $generatedAt,
    gitSha: $gitSha,
    gitleaks: {version: $gitleaksVersion, historyFindings: 0},
    dependencyAudit: {highOrCriticalKnownVulnerabilities: 0},
    contracts: {
      foundrySuitesPassed: true,
      eip170: {
        maximumRuntimeBytes: 24576,
        robynV4AssetRouterRuntimeBytes: $routerBytecodeBytes,
        passed: ($routerBytecodeBytes <= 24576)
      },
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
      unresolvedMedium: 0,
      reviewedHigh: $reviewedHigh,
      reviewedMedium: $reviewedMedium,
      highTriagePolicy: {
        checks: ["arbitrary-send-eth", "reentrancy-balance", "reentrancy-eth"],
        rationaleDocument: "docs/assurance/security-remediation-review.md"
      },
      mediumTriagePolicy: {
        checks: ["incorrect-equality", "reentrancy-no-eth", "uninitialized-local", "unused-return"],
        rationaleDocument: "docs/protocol-security-review.md"
      },
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
jq -e '.passed == true and .contracts.unresolvedHigh == 0 and .contracts.unresolvedMedium == 0' "${output}" >/dev/null
cat "${output}"

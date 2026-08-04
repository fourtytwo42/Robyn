#!/usr/bin/env bash
set -euo pipefail
[[ "$(id -un)" == "robyn-release" ]] || { echo "run as robyn-release" >&2; exit 1; }
source_root="${1:?source root required}"
output_root="${2:?output root required}"
scope="${3:?change scope required}"
acceptance_root="${4:?acceptance root required}"
build_env=/etc/robyn/release-builder.env
[[ -r "${build_env}" ]] || { echo "release builder environment missing" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${build_env}"
set +a
manifest_input="${ROBYN_RELEASE_MANIFEST_INPUT:-${ROBYN_MAINNET_MANIFEST:-}}"
next_secrets="${ROBYN_NEXT_BUILD_SECRETS_FILE:-/etc/robyn/next-build-secrets.json}"
: "${manifest_input:?release manifest input is required}"
: "${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:?}"
[[ -r "${next_secrets}" ]] || { echo "protected Next build secrets are missing" >&2; exit 1; }
cd "${source_root}"
source_sha="$(git rev-parse HEAD)"
[[ -z "$(git status --porcelain)" ]]
application_release_sha="$(jq -r .applicationReleaseSha config/production-mainnet.json)"
[[ "${application_release_sha}" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid application release SHA" >&2; exit 1; }
git cat-file -e "${application_release_sha}^{commit}"
git diff --quiet "${application_release_sha}" HEAD -- apps packages pnpm-lock.yaml pnpm-workspace.yaml || {
  echo "application runtime source differs from qualified application release" >&2
  exit 1
}
[[ "$(git rev-parse HEAD:packages/contracts/src)" == "$(jq -r .contractClosureHash config/production-mainnet.json)" ]]
[[ -r "${manifest_input}" ]] || { echo "release manifest input is not readable" >&2; exit 1; }
[[ "$(sha256sum "${manifest_input}" | cut -d' ' -f1)" == "$(jq -r .deploymentManifestHash config/production-mainnet.json)" ]] || { echo "release manifest input hash mismatch" >&2; exit 1; }
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(
  node scripts/prepare-next-build-inputs.mjs "${source_root}" "${next_secrets}"
)"
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
COREPACK_DEFAULT_TO_LATEST=0 pnpm install --frozen-lockfile
pnpm --filter @robyn/db --filter @robyn/api --filter @robyn/indexer --filter @robyn/artifacts --filter @robyn/rpc-gateway --recursive run build
ROBYN_BUILD_ID="${source_sha}" ROBYN_NETWORK_MODE=mainnet NEXT_PUBLIC_ROBYN_NETWORK_MODE=mainnet ROBYN_DEPLOYMENT_PATH="${manifest_input}" NEXT_PUBLIC_ROBYN_RPC_URL=https://sherwoodforest.trade/rpc NEXT_PUBLIC_DATA_API_URL=https://sherwoodforest.trade/api NEXT_PUBLIC_ROBYN_EXPLORER_URL=https://explorer.chain.robinhood.com NEXT_PUBLIC_APP_URL=https://sherwoodforest.trade pnpm --filter @robyn/web build
rm -rf apps/web/.next/cache
runtime="${output_root}/runtime"
rm -rf "${output_root}"
install -d -m 0750 "${runtime}/apps" "${runtime}/packages/db" "${runtime}/infrastructure/pm2" "${runtime}/scripts/lib" "${runtime}/config" "${runtime}/deployments" "${runtime}/release-evidence"
cp -a package.json pnpm-lock.yaml pnpm-workspace.yaml node_modules "${runtime}/"
for app in web api indexer artifacts rpc-gateway; do
  install -d "${runtime}/apps/${app}"
  cp -a "apps/${app}/package.json" "${runtime}/apps/${app}/"
  [[ ! -e "apps/${app}/node_modules" ]] || cp -a "apps/${app}/node_modules" "${runtime}/apps/${app}/"
done
cp -a apps/web/.next apps/web/public "${runtime}/apps/web/"
for app in api indexer artifacts rpc-gateway; do cp -a "apps/${app}/dist" "${runtime}/apps/${app}/"; done
cp -a packages/db/package.json packages/db/dist packages/db/migrations "${runtime}/packages/db/"
[[ ! -e packages/db/node_modules ]] || cp -a packages/db/node_modules "${runtime}/packages/db/"
cp infrastructure/pm2/ecosystem.mainnet.production.cjs "${runtime}/infrastructure/pm2/"
cp scripts/start-production-api.sh scripts/start-production-artifacts.sh scripts/validate-production-release.mjs "${runtime}/scripts/"
cp scripts/lib/production-release.mjs "${runtime}/scripts/lib/"
cp config/production-mainnet.json "${runtime}/config/"
cp "${manifest_input}" "${runtime}/deployments/4663-mainnet.json"
cp "${acceptance_root}"/{devnet,testnet,mainnet-staging}.json "${runtime}/release-evidence/"
pnpm list --depth Infinity --json >"${output_root}/dependencies.json"
node scripts/generate-cyclonedx-sbom.mjs "${output_root}/dependencies.json" "${runtime}/release-evidence/cyclonedx-sbom.json" "${source_sha}"
rm -f "${output_root}/dependencies.json"
(
  cd "${runtime}"
  find . -type f ! -name release-files.sha256 -print0 | sort -z | xargs -0 sha256sum > release-files.sha256
)
application_hash="$(sha256sum "${runtime}/release-files.sha256" | cut -d' ' -f1)"
migration_hash="$(node --input-type=module -e "import {hashMigrationSet} from './scripts/lib/production-release.mjs'; console.log(hashMigrationSet('packages/db/migrations'))")"
topology_hash="$(sha256sum infrastructure/pm2/ecosystem.mainnet.production.cjs | cut -d' ' -f1)"
previous="${ROBYN_REQUIRED_PREVIOUS_RELEASE:-}"
acceptance="$(for item in devnet testnet mainnet-staging; do
  jq -n --arg environment "${item}" --arg sha256 "$(sha256sum "${acceptance_root}/${item}.json" | cut -d' ' -f1)" '{environment:$environment,sha256:$sha256}'
done | jq -s .)"
(
  cd "${runtime}"
  tar --zstd -cf "${output_root}/runtime.tar.zst" .
  sha256sum "${output_root}/runtime.tar.zst" | sed 's#  .*/#  #' > "${output_root}/runtime.tar.zst.sha256"
)
runtime_archive_hash="$(sha256sum "${output_root}/runtime.tar.zst" | cut -d' ' -f1)"
jq -n --arg sourceSha "${source_sha}" --arg applicationReleaseSha "${application_release_sha}" --arg applicationArtifactHash "${application_hash}" --arg runtimeArchiveHash "${runtime_archive_hash}" --arg changeScope "${scope}" --arg contractClosureHash "$(jq -r .contractClosureHash config/production-mainnet.json)" --arg deploymentManifestHash "$(jq -r .deploymentManifestHash config/production-mainnet.json)" --arg migrationSetHash "${migration_hash}" --arg processTopologyHash "${topology_hash}" --arg requiredPreviousRelease "${previous}" --argjson acceptanceReferences "${acceptance}" '{
  schemaVersion:2,sourceSha:$sourceSha,applicationReleaseSha:$applicationReleaseSha,applicationArtifactHash:$applicationArtifactHash,
  runtimeArchiveHash:$runtimeArchiveHash,
  changeScope:$changeScope,contractClosureHash:$contractClosureHash,
  deploymentManifestHash:$deploymentManifestHash,chainId:4663,
  migrationSetHash:$migrationSetHash,processTopologyHash:$processTopologyHash,
  requiredPreviousRelease:(if $requiredPreviousRelease == "" then null else $requiredPreviousRelease end),
  acceptanceReferences:$acceptanceReferences,
  rpcPolicy:{primary:"lan-only",probeOnly:true,automaticFallback:false,transactionSubmissionDefault:false}
}' >"${output_root}/production-release.json"
rm -rf "${runtime}"
chmod 0444 "${output_root}/production-release.json" "${output_root}/runtime.tar.zst" "${output_root}/runtime.tar.zst.sha256"

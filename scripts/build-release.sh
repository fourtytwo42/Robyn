#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo}"

if [[ "${EUID}" -eq 0 ]]; then
  echo "build releases as the unprivileged operator" >&2
  exit 1
fi

git_sha="$(git rev-parse HEAD)"
release_id="${1:-${git_sha}}"
staging="/opt/robyn/staging/${release_id}.$$"
target="/opt/robyn/releases/${release_id}"
security_json="/tmp/robyn-release-security-$$.json"
gate_log="/tmp/robyn-release-gates-$$.log"
archive="/tmp/robyn-release-source-$$.tar"
next_secrets="${ROBYN_NEXT_BUILD_SECRETS_FILE:-/home/hendo420/.config/robyn/next-build-secrets.json}"
source_epoch="$(git show -s --format=%ct "${git_sha}")"

cleanup() {
  rm -f "${security_json}" "${gate_log}" "${archive}"
  if [[ -d "${staging}" ]]; then
    chmod -R u+w "${staging}" 2>/dev/null || true
    rm -rf "${staging}"
  fi
}
trap cleanup EXIT

[[ "${release_id}" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "invalid release id" >&2
  exit 1
}
[[ -z "$(git status --porcelain)" ]] || {
  echo "worktree must be clean" >&2
  exit 1
}
[[ "$(git rev-parse '@{u}')" == "${git_sha}" ]] || {
  echo "HEAD must exactly match its pushed upstream" >&2
  exit 1
}
[[ -r "${next_secrets}" ]] || {
  echo "missing protected Next build secrets: ${next_secrets}" >&2
  exit 1
}
[[ ! -e "${target}" ]] || {
  echo "release already exists: ${target}" >&2
  exit 1
}
[[ -d /opt/robyn/releases && -d /opt/robyn/staging ]] || {
  echo "run scripts/install-release-system.sh first" >&2
  exit 1
}

export TZ=UTC
export LC_ALL=C
export SOURCE_DATE_EPOCH="${source_epoch}"
export ROBYN_BUILD_ID="${git_sha}"
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(
  node scripts/prepare-next-build-inputs.mjs "${repo}" "${next_secrets}"
)"

{
  pnpm format
  pnpm lint
  node scripts/validate-pm2-config.mjs
  scripts/test-release-immutability.sh
  pnpm typecheck
  pnpm test
  pnpm build
  scripts/verify-creator-data-plane.sh
  python3 scripts/validate-user-stories.py
  SECURITY_AUDIT_OUTPUT="${security_json}" scripts/security-audit.sh
} 2>&1 | tee "${gate_log}"

mkdir -p "${staging}/release-evidence"
git archive --format=tar "${git_sha}" -o "${archive}"
source_archive_sha="$(sha256sum "${archive}" | cut -d' ' -f1)"
tar -xf "${archive}" -C "${staging}"
cp "${security_json}" "${staging}/release-evidence/static-security-audit.json"
cp "${gate_log}" "${staging}/release-evidence/release-gates.log"

(
  cd "${staging}"
  pnpm install --frozen-lockfile --package-import-method=copy
  export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(
    node scripts/prepare-next-build-inputs.mjs "${staging}" "${next_secrets}"
  )"
  pnpm build
  pnpm list --depth Infinity --json > release-evidence/dependencies.json
  pnpm licenses list --json > release-evidence/licenses.json
  node scripts/generate-cyclonedx-sbom.mjs \
    release-evidence/dependencies.json \
    release-evidence/cyclonedx-sbom.json \
    "${git_sha}"

  {
    find apps -type f \( -path '*/.next/*' -o -path '*/dist/*' \) -print0
    find packages -type f -path '*/dist/*' -print0
    find deployments infrastructure/pm2 scripts -type f -print0
    printf '%s\0' package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json
    find release-evidence -type f -print0
  } | sort -z | xargs -0 sha256sum > release-files.sha256

  lock_sha="$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)"
  files_sha="$(sha256sum release-files.sha256 | cut -d' ' -f1)"
  dependencies_sha="$(sha256sum release-evidence/dependencies.json | cut -d' ' -f1)"
  licenses_sha="$(sha256sum release-evidence/licenses.json | cut -d' ' -f1)"
  sbom_sha="$(sha256sum release-evidence/cyclonedx-sbom.json | cut -d' ' -f1)"
  next_secrets_sha="$(sha256sum "${next_secrets}" | cut -d' ' -f1)"
  migrations_json="$(find packages/db -type f -path '*/migrations/*' -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum | jq -R -s 'split("\n") | map(select(length > 0))')"

  jq -n \
    --arg releaseId "${release_id}" \
    --arg gitSha "${git_sha}" \
    --arg gitCommittedAt "$(git -C "${repo}" show -s --format=%cI "${git_sha}")" \
    --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg sourceArchiveSha256 "${source_archive_sha}" \
    --arg lockSha256 "${lock_sha}" \
    --arg releaseFilesSha256 "${files_sha}" \
    --arg dependenciesSha256 "${dependencies_sha}" \
    --arg licensesSha256 "${licenses_sha}" \
    --arg cycloneDxSbomSha256 "${sbom_sha}" \
    --arg nextBuildSecretsSha256 "${next_secrets_sha}" \
    --arg nodeVersion "$(node --version)" \
    --arg pnpmVersion "$(pnpm --version)" \
    --argjson migrations "${migrations_json}" \
    '{
      schemaVersion: 1,
      releaseId: $releaseId,
      gitSha: $gitSha,
      gitCommittedAt: $gitCommittedAt,
      createdAt: $createdAt,
      sourceArchiveSha256: $sourceArchiveSha256,
      lockSha256: $lockSha256,
      releaseFilesSha256: $releaseFilesSha256,
      dependenciesSha256: $dependenciesSha256,
      licensesSha256: $licensesSha256,
      cycloneDxSbomSha256: $cycloneDxSbomSha256,
      nextBuildSecretsSha256: $nextBuildSecretsSha256,
      nodeVersion: $nodeVersion,
      pnpmVersion: $pnpmVersion,
      packageImportMethod: "copy",
      migrations: $migrations,
      gates: ["format", "lint", "pm2-config", "immutability-validator", "typecheck", "test", "build", "creator-data-plane", "traceability", "security-audit"],
      deferredGates: ["robinhood-testnet-journey", "robinhood-testnet-stack"]
    }' > release-manifest.json
  sha256sum release-manifest.json > release-manifest.json.sha256
)

chmod -R a-w "${staging}"
"${staging}/scripts/verify-release-immutability.sh" "${staging}"
chmod u+w "${staging}"
mv "${staging}" "${target}"
staging=""
chmod a-w "${target}"
if ! "${target}/scripts/verify-release-immutability.sh" "${target}"; then
  chmod -R u+w "${target}" 2>/dev/null || true
  rm -rf -- "${target}"
  echo "final release immutability validation failed" >&2
  exit 1
fi

printf 'release=%s\n' "${target}"
printf 'gitSha=%s\n' "${git_sha}"
printf 'manifestSha256=%s\n' "$(cut -d' ' -f1 "${target}/release-manifest.json.sha256")"

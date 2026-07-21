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
testnet_journey_json="/tmp/robyn-testnet-journey-$$.json"
testnet_stack_json="/tmp/robyn-testnet-stack-$$.json"

cleanup() {
  rm -f "${security_json}" "${gate_log}" "${archive}" "${testnet_journey_json}" "${testnet_stack_json}"
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
[[ "$(git rev-parse origin/main)" == "${git_sha}" ]] || {
  echo "HEAD must exactly match pushed origin/main" >&2
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

{
  pnpm format
  pnpm lint
  node scripts/validate-pm2-config.mjs
  scripts/test-release-immutability.sh
  pnpm typecheck
  pnpm test
  pnpm build
  python3 scripts/validate-user-stories.py
  SECURITY_AUDIT_OUTPUT="${security_json}" scripts/security-audit.sh
  ROBYN_TESTNET_REHEARSAL_EVIDENCE="${testnet_journey_json}" scripts/rehearse-testnet.sh
  ROBYN_TESTNET_STACK_EVIDENCE="${testnet_stack_json}" scripts/rehearse-testnet-stack.sh
} 2>&1 | tee "${gate_log}"

mkdir -p "${staging}/release-evidence"
git archive --format=tar "${git_sha}" -o "${archive}"
source_archive_sha="$(sha256sum "${archive}" | cut -d' ' -f1)"
tar -xf "${archive}" -C "${staging}"
cp "${security_json}" "${staging}/release-evidence/static-security-audit.json"
cp "${gate_log}" "${staging}/release-evidence/release-gates.log"
cp "${testnet_journey_json}" "${staging}/release-evidence/testnet-journey.json"
cp "${testnet_stack_json}" "${staging}/release-evidence/testnet-stack.json"

(
  cd "${staging}"
  pnpm install --frozen-lockfile --package-import-method=copy
  pnpm build
  pnpm list --depth Infinity --json > release-evidence/dependencies.json

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
      nodeVersion: $nodeVersion,
      pnpmVersion: $pnpmVersion,
      packageImportMethod: "copy",
      migrations: $migrations,
      gates: ["format", "lint", "pm2-config", "immutability-validator", "typecheck", "test", "build", "traceability", "security-audit", "testnet-journey", "testnet-stack"]
    }' > release-manifest.json
  sha256sum release-manifest.json > release-manifest.json.sha256
)

chmod -R a-w "${staging}"
"${staging}/scripts/verify-release-immutability.sh" "${staging}"
mv "${staging}" "${target}"
staging=""

printf 'release=%s\n' "${target}"
printf 'gitSha=%s\n' "${git_sha}"
printf 'manifestSha256=%s\n' "$(cut -d' ' -f1 "${target}/release-manifest.json.sha256")"

#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
[[ "$EUID" -ne 0 ]] || { echo "build as the unprivileged operator" >&2; exit 1; }

git_sha="$(git rev-parse HEAD)"
release_id="${1:-$git_sha}"
target="/opt/robyn/testnet-releases/$release_id"
staging="/opt/robyn/testnet-staging/$release_id.$$"
repro_staging="/opt/robyn/testnet-staging/$release_id.repro.$$"
archive="/tmp/robyn-testnet-source-$$.tar"
deployment_manifest="${ROBYN_TESTNET_DEPLOYMENT_MANIFEST:-deployments/46630-v4-schema19.json}"
gate_log="/tmp/robyn-testnet-gates-$$.log"
security_json="/tmp/robyn-testnet-security-$$.json"
gitleaks_json="/tmp/robyn-testnet-gitleaks-$$.json"
dependency_audit_json="/tmp/robyn-testnet-dependency-audit-$$.json"
freeze_evidence="/tmp/robyn-testnet-contract-freeze-$$.json"
release_env="${ROBYN_TESTNET_RELEASE_ENV:-/home/hendo420/.config/robyn/testnet/release.env}"
next_secrets="${ROBYN_NEXT_BUILD_SECRETS_FILE:-/home/hendo420/.config/robyn/next-build-secrets.json}"
cleanup() {
  rm -f "$archive" "$gate_log" "$security_json" "$gitleaks_json" \
    "$dependency_audit_json" "$freeze_evidence"
  if [[ -d "$staging" ]]; then chmod -R u+w "$staging" 2>/dev/null || true; rm -rf "$staging"; fi
  if [[ -d "$repro_staging" ]]; then chmod -R u+w "$repro_staging" 2>/dev/null || true; rm -rf "$repro_staging"; fi
}
trap cleanup EXIT

[[ "$release_id" =~ ^[A-Za-z0-9._-]+$ ]]
[[ -z "$(git status --porcelain)" ]] || { echo "worktree must be clean" >&2; exit 1; }
[[ "$(git rev-parse '@{u}')" == "$git_sha" ]] || { echo "HEAD must equal pushed upstream" >&2; exit 1; }
[[ -r "$release_env" && -r "$next_secrets" ]]
[[ ! -e "$target" ]] || { echo "release exists: $target" >&2; exit 1; }
mkdir -p /opt/robyn/testnet-releases /opt/robyn/testnet-staging

[[ -r "$deployment_manifest" ]] || { echo "missing Testnet deployment manifest: $deployment_manifest" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$release_env"
set +a
node scripts/validate-public-release-environment.mjs \
  testnet \
  "$deployment_manifest" \
  "$NEXT_PUBLIC_APP_URL" \
  "$ROBYN_TESTNET_RPC_URL" \
  "${NEXT_PUBLIC_ROBYN_EXPLORER_URL:-https://explorer.testnet.chain.robinhood.com}"
export TZ=UTC LC_ALL=C SOURCE_DATE_EPOCH
SOURCE_DATE_EPOCH="$(git show -s --format=%ct "$git_sha")"
export ROBYN_BUILD_ID="$git_sha"
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(
  node scripts/prepare-next-build-inputs.mjs "$repo" "$next_secrets"
)"

{
  pnpm format
  pnpm test:testnet-application-scope
  node --test scripts/test/testnet-endurance-policy.test.mjs
  node scripts/verify-schema19-contract-freeze.mjs > "$freeze_evidence"
  gitleaks git --redact --report-format json --report-path "$gitleaks_json" .
  pnpm audit --audit-level high --json > "$dependency_audit_json"
  jq -n \
    --arg generatedAt "$(date -u +%FT%TZ)" \
    --arg gitSha "$git_sha" \
    --slurpfile gitleaks "$gitleaks_json" \
    --slurpfile dependencyAudit "$dependency_audit_json" \
    '{schemaVersion:1,generatedAt:$generatedAt,gitSha:$gitSha,scope:"application-only",contractMode:"frozen-schema19",gitleaksFindings:($gitleaks[0]|length),dependencyAudit:$dependencyAudit[0],passed:(($gitleaks[0]|length)==0)}' \
    > "$security_json"
  jq -e '.passed == true' "$security_json" >/dev/null
} 2>&1 | tee "$gate_log"

git archive --format=tar "$git_sha" -o "$archive"
source_sha="$(sha256sum "$archive" | cut -d' ' -f1)"
mkdir -p "$staging/release-evidence" "$repro_staging"
tar -xf "$archive" -C "$staging"
tar -xf "$archive" -C "$repro_staging"
cp "$gate_log" "$staging/release-evidence/release-gates.log"
cp "$security_json" "$staging/release-evidence/static-security-audit.json"
cp "$freeze_evidence" "$staging/release-evidence/frozen-contract-qualification.json"

build_runtime() {
  local build_root="$1"
  (
    cd "$build_root"
    pnpm install --frozen-lockfile --package-import-method=copy
    export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(
      node scripts/prepare-next-build-inputs.mjs "$build_root" "$next_secrets"
    )"
    pnpm --filter @robyn/api \
      --filter @robyn/artifacts \
      --filter @robyn/db \
      --filter @robyn/indexer \
      --filter @robyn/rpc-gateway \
      --recursive run build
    ROBYN_NETWORK_MODE=testnet \
    NEXT_PUBLIC_ROBYN_NETWORK_MODE=testnet \
    ROBYN_DEPLOYMENT_PATH="$build_root/$deployment_manifest" \
    NEXT_PUBLIC_ROBYN_RPC_URL="$ROBYN_TESTNET_RPC_URL" \
    NEXT_PUBLIC_ROBYN_EXPLORER_URL="${NEXT_PUBLIC_ROBYN_EXPLORER_URL:-https://explorer.testnet.chain.robinhood.com}" \
    NEXT_PUBLIC_DATA_API_URL="" \
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID" \
    NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" \
      pnpm --filter @robyn/web build
    rm -rf apps/web/.next/cache
    for required_runtime_file in \
      apps/web/.next/BUILD_ID \
      apps/web/.next/prerender-manifest.json \
      apps/web/.next/required-server-files.json \
      apps/web/.next/routes-manifest.json; do
      [[ -s "$required_runtime_file" ]] || {
        echo "missing required Next runtime file: $required_runtime_file" >&2
        exit 1
      }
    done
  )
}

runtime_checksums() {
  local build_root="$1"
  local output="$2"
  (
    cd "$build_root"
    {
      find apps -type f \( -path '*/.next/*' -o -path '*/dist/*' \) -print0
      find packages -type f -path '*/dist/*' -print0
    } | sort -z | xargs -0 sha256sum > "$output"
  )
}

build_runtime "$staging"
build_runtime "$repro_staging"
runtime_checksums "$staging" "$staging/release-evidence/runtime-build-a.sha256"
runtime_checksums "$repro_staging" "$staging/release-evidence/runtime-build-b.sha256"
cmp "$staging/release-evidence/runtime-build-a.sha256" \
  "$staging/release-evidence/runtime-build-b.sha256"
rm -rf "$repro_staging"
repro_staging=""

(
  cd "$staging"
  for marker in DEVNET_ONLY robyn-devnet-session-key generatePrivateKey '"/api/faucet"'; do
    if grep -RasF -- "$marker" apps/web/.next/static apps/web/.next/server; then
      echo "forbidden Testnet runtime marker: $marker" >&2
      exit 1
    fi
  done
  for required in "$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID" WalletConnect 46630; do
    grep -RasF -- "$required" apps/web/.next >/dev/null
  done

  pnpm list --depth Infinity --json > release-evidence/dependencies.json
  pnpm licenses list --json > release-evidence/licenses.json
  node scripts/generate-cyclonedx-sbom.mjs \
    release-evidence/dependencies.json \
    release-evidence/cyclonedx-sbom.json "$git_sha"

  {
    find apps -type f \( -path '*/.next/*' -o -path '*/dist/*' \) -print0
    find packages -type f -path '*/dist/*' -print0
    find deployments infrastructure scripts -type f -print0
    printf '%s\0' package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json
    find release-evidence -type f -print0
  } | sort -z | xargs -0 sha256sum > testnet-release-files.sha256

  jq -n \
    --arg releaseId "$release_id" \
    --arg gitSha "$git_sha" \
    --arg createdAt "$(date -u +%FT%TZ)" \
    --arg sourceArchiveSha256 "$source_sha" \
    --arg deploymentManifestSha256 "$(sha256sum "$deployment_manifest" | cut -d' ' -f1)" \
    --arg contractFreezeSha256 "$(sha256sum config/schema19-contract-freeze.json | cut -d' ' -f1)" \
    --arg nodeVersion "$(node --version)" \
    --arg pnpmVersion "$(pnpm --version)" \
    '{schemaVersion:1,releaseId:$releaseId,gitSha:$gitSha,createdAt:$createdAt,environment:"robinhood-testnet",chainId:46630,sourceArchiveSha256:$sourceArchiveSha256,deploymentManifestSha256:$deploymentManifestSha256,contractFreezeSha256:$contractFreezeSha256,nodeVersion:$nodeVersion,pnpmVersion:$pnpmVersion,packageImportMethod:"copy",publicRpc:"https://rpc.testnet.chain.robinhood.com",contractMode:"frozen-schema19",gates:["format","application-tests","frozen-contract-attestation","endurance-policy","application-security-audit","two-build-reproducibility","protected-bundle"]}' \
    > testnet-release-manifest.json
  sha256sum testnet-release-manifest.json > testnet-release-manifest.json.sha256
  sha256sum -c testnet-release-files.sha256 >/dev/null
)

find "$staging" -mindepth 1 -exec chmod a-w {} +
mv "$staging" "$target"
staging=""
chmod a-w "$target"
printf 'release=%s\ngitSha=%s\ncontractMode=frozen-schema19\n' "$target" "$git_sha"

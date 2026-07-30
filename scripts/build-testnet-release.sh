#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
[[ "$EUID" -ne 0 ]] || { echo "build as the unprivileged operator" >&2; exit 1; }

git_sha="$(git rev-parse HEAD)"
release_id="${1:-$git_sha}"
target="/opt/robyn/testnet-releases/$release_id"
staging="/opt/robyn/testnet-staging/$release_id.$$"
archive="/tmp/robyn-testnet-source-$$.tar"
deployment_manifest="${ROBYN_TESTNET_DEPLOYMENT_MANIFEST:-deployments/46630-v4-schema13.json}"
gate_log="/tmp/robyn-testnet-gates-$$.log"
security_json="/tmp/robyn-testnet-security-$$.json"
release_env="${ROBYN_TESTNET_RELEASE_ENV:-/home/hendo420/.config/robyn/testnet/release.env}"
next_secrets="${ROBYN_NEXT_BUILD_SECRETS_FILE:-/home/hendo420/.config/robyn/next-build-secrets.json}"
cleanup() {
  rm -f "$archive" "$gate_log" "$security_json"
  if [[ -d "$staging" ]]; then chmod -R u+w "$staging" 2>/dev/null || true; rm -rf "$staging"; fi
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
  pnpm lint
  pnpm typecheck
  pnpm test
  node --test scripts/test/testnet-endurance-policy.test.mjs
  SECURITY_AUDIT_OUTPUT="$security_json" scripts/security-audit.sh
} 2>&1 | tee "$gate_log"

git archive --format=tar "$git_sha" -o "$archive"
source_sha="$(sha256sum "$archive" | cut -d' ' -f1)"
mkdir -p "$staging/release-evidence"
tar -xf "$archive" -C "$staging"
cp "$gate_log" "$staging/release-evidence/release-gates.log"
cp "$security_json" "$staging/release-evidence/static-security-audit.json"

(
  cd "$staging"
  pnpm install --frozen-lockfile --package-import-method=copy
  PATH="$HOME/.foundry/bin:$PATH" forge build --root packages/contracts
  export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(
    node scripts/prepare-next-build-inputs.mjs "$staging" "$next_secrets"
  )"
  # Turbo's strict environment boundary intentionally omits deployment and
  # public-wallet variables. Build non-web services through pnpm recursion,
  # then build the web package directly so Next resolves only testnet aliases.
  pnpm --filter @robyn/api \
    --filter @robyn/artifacts \
    --filter @robyn/db \
    --filter @robyn/indexer \
    --filter @robyn/keeper \
    --filter @robyn/rpc-gateway \
    --recursive run build
  ROBYN_NETWORK_MODE=testnet \
  NEXT_PUBLIC_ROBYN_NETWORK_MODE=testnet \
  ROBYN_DEPLOYMENT_PATH="$staging/$deployment_manifest" \
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

  for marker in DEVNET_ONLY robyn-devnet-session-key generatePrivateKey '"/api/faucet"'; do
    ! grep -RasF -- "$marker" apps/web/.next/static apps/web/.next/server
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
    find packages -type f \( -path '*/dist/*' -o -path '*/out/*' \) -print0
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
    --arg nodeVersion "$(node --version)" \
    --arg pnpmVersion "$(pnpm --version)" \
    '{
      schemaVersion:1,
      releaseId:$releaseId,
      gitSha:$gitSha,
      createdAt:$createdAt,
      environment:"robinhood-testnet",
      chainId:46630,
      sourceArchiveSha256:$sourceArchiveSha256,
      deploymentManifestSha256:$deploymentManifestSha256,
      nodeVersion:$nodeVersion,
      pnpmVersion:$pnpmVersion,
      packageImportMethod:"copy",
      publicRpc:"https://rpc.testnet.chain.robinhood.com",
      gates:["format","lint","typecheck","tests","endurance-policy","security-audit","protected-bundle"]
    }' > testnet-release-manifest.json
  sha256sum testnet-release-manifest.json > testnet-release-manifest.json.sha256
  sha256sum -c testnet-release-files.sha256 >/dev/null
)

find "$staging" -mindepth 1 -exec chmod a-w {} +
mv "$staging" "$target"
staging=""
chmod a-w "$target"
printf 'release=%s\ngitSha=%s\n' "$target" "$git_sha"

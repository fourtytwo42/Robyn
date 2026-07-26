#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
[[ "$EUID" -ne 0 ]] || {
  echo "build as the unprivileged operator" >&2
  exit 1
}

git_sha="$(git rev-parse HEAD)"
release_id="${1:-$git_sha}"
target="/opt/robyn/mainnet-releases/$release_id"
staging="/opt/robyn/mainnet-staging/$release_id.$$"
archive="/tmp/sherwood-mainnet-source-$$.tar"
release_env="${ROBYN_MAINNET_RELEASE_ENV:-/home/hendo420/.config/robyn/mainnet/release.env}"
next_secrets="${ROBYN_NEXT_BUILD_SECRETS_FILE:-/home/hendo420/.config/robyn/next-build-secrets.json}"

cleanup() {
  rm -f "$archive"
  if [[ -d "$staging" ]]; then
    chmod -R u+w "$staging" 2>/dev/null || true
    rm -rf "$staging"
  fi
}
trap cleanup EXIT

[[ "$release_id" =~ ^[A-Za-z0-9._-]+$ ]]
[[ -z "$(git status --porcelain)" ]] || {
  echo "worktree must be clean" >&2
  exit 1
}
[[ "$(git rev-parse '@{u}')" == "$git_sha" ]] || {
  echo "HEAD must equal pushed upstream" >&2
  exit 1
}
[[ -r "$release_env" && -r "$next_secrets" ]] || {
  echo "mainnet release configuration is not installed" >&2
  exit 1
}

set -a
# shellcheck disable=SC1090
source "$release_env"
set +a

: "${ROBYN_MAINNET_MANIFEST:?ROBYN_MAINNET_MANIFEST is required}"
: "${ROBYN_MAINNET_RPC_URL:?ROBYN_MAINNET_RPC_URL is required}"
: "${ROBYN_MAINNET_EXPLORER_URL:?ROBYN_MAINNET_EXPLORER_URL is required}"
: "${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:?NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required}"
: "${NEXT_PUBLIC_APP_URL:?NEXT_PUBLIC_APP_URL is required}"
[[ -r "$ROBYN_MAINNET_MANIFEST" ]]
[[ ! -e "$target" ]] || {
  echo "release exists: $target" >&2
  exit 1
}

node scripts/validate-public-release-environment.mjs \
  mainnet \
  "$ROBYN_MAINNET_MANIFEST" \
  "$NEXT_PUBLIC_APP_URL" \
  "$ROBYN_MAINNET_RPC_URL" \
  "$ROBYN_MAINNET_EXPLORER_URL"

pnpm format
pnpm lint
pnpm typecheck
pnpm test
node --test scripts/test/public-release-environment.test.mjs
scripts/security-audit.sh

mkdir -p /opt/robyn/mainnet-releases /opt/robyn/mainnet-staging
git archive --format=tar "$git_sha" -o "$archive"
mkdir -p "$staging"
tar -xf "$archive" -C "$staging"
cp "$ROBYN_MAINNET_MANIFEST" "$staging/deployments/4663-mainnet.json"

(
  cd "$staging"
  pnpm install --frozen-lockfile --package-import-method=copy
  PATH="$HOME/.foundry/bin:$PATH" forge build --root packages/contracts
  pnpm --filter @robyn/api \
    --filter @robyn/artifacts \
    --filter @robyn/db \
    --filter @robyn/indexer \
    --filter @robyn/keeper \
    --filter @robyn/rpc-gateway \
    --recursive run build
  ROBYN_NETWORK_MODE=mainnet \
  NEXT_PUBLIC_ROBYN_NETWORK_MODE=mainnet \
  ROBYN_DEPLOYMENT_PATH="$staging/deployments/4663-mainnet.json" \
  NEXT_PUBLIC_ROBYN_RPC_URL="$ROBYN_MAINNET_RPC_URL" \
  NEXT_PUBLIC_ROBYN_EXPLORER_URL="$ROBYN_MAINNET_EXPLORER_URL" \
  NEXT_PUBLIC_DATA_API_URL="" \
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID" \
  NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" \
    pnpm --filter @robyn/web build
  rm -rf apps/web/.next/cache

  # The shared source intentionally contains inactive testnet profile constants.
  # Public-mode unit tests and browser acceptance prove that those branches do
  # not render in a mainnet build. Keep the bundle scan focused on privileged
  # devnet capabilities and key material, which must never ship at all.
  for forbidden in \
    DEVNET_ONLY \
    robyn-devnet-session-key; do
    ! grep -RasF -- "$forbidden" apps/web/.next/static
  done

  jq -n \
    --arg releaseId "$release_id" \
    --arg gitSha "$git_sha" \
    --arg createdAt "$(date -u +%FT%TZ)" \
    --arg deploymentManifestSha256 "$(sha256sum deployments/4663-mainnet.json | cut -d' ' -f1)" \
    '{
      releaseId:$releaseId,
      gitSha:$gitSha,
      createdAt:$createdAt,
      environment:"robinhood-mainnet",
      chainId:4663,
      deploymentManifestSha256:$deploymentManifestSha256,
      activation:"not-authorized-by-build"
    }' > mainnet-release-manifest.json
)

find "$staging" -mindepth 1 -exec chmod a-w {} +
mv "$staging" "$target"
staging=""
chmod a-w "$target"
printf 'mainnetCandidate=%s\ngitSha=%s\n' "$target" "$git_sha"

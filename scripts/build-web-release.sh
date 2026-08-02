#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
network="${1:-}"
release_id="${2:-$(git rev-parse HEAD)}"

case "$network" in
  devnet)
    release_root=/opt/robyn/releases
    staging_root=/opt/robyn/staging
    deployment_manifest=deployments/31337.json
    release_env=""
    chain_id=31337
    ;;
  testnet)
    release_root=/opt/robyn/testnet-releases
    staging_root=/opt/robyn/testnet-staging
    deployment_manifest="${ROBYN_TESTNET_DEPLOYMENT_MANIFEST:-deployments/46630-v4-schema18.json}"
    release_env="${ROBYN_TESTNET_RELEASE_ENV:-/home/hendo420/.config/robyn/testnet/release.env}"
    chain_id=46630
    ;;
  mainnet)
    release_root=/opt/robyn/mainnet-releases
    staging_root=/opt/robyn/mainnet-staging
    deployment_manifest=""
    release_env="${ROBYN_MAINNET_RELEASE_ENV:-/home/hendo420/.config/robyn/mainnet/release.env}"
    chain_id=4663
    ;;
  *)
    echo "usage: scripts/build-web-release.sh devnet|testnet|mainnet [release-id]" >&2
    exit 1
    ;;
esac

[[ "$EUID" -ne 0 ]] || { echo "build as the unprivileged operator" >&2; exit 1; }
[[ "$release_id" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid release id" >&2; exit 1; }
git_sha="$(git rev-parse HEAD)"
[[ -z "$(git status --porcelain)" ]] || { echo "worktree must be clean" >&2; exit 1; }
[[ "$(git rev-parse '@{u}')" == "$git_sha" ]] || { echo "HEAD must equal pushed upstream" >&2; exit 1; }

next_secrets="${ROBYN_NEXT_BUILD_SECRETS_FILE:-/home/hendo420/.config/robyn/next-build-secrets.json}"
[[ -r "$next_secrets" ]] || { echo "missing protected Next build secrets" >&2; exit 1; }
if [[ -n "$release_env" ]]; then
  [[ -r "$release_env" ]] || { echo "missing protected $network release environment" >&2; exit 1; }
  set -a
  # shellcheck disable=SC1090
  source "$release_env"
  set +a
fi
if [[ "$network" == mainnet ]]; then
  : "${ROBYN_MAINNET_MANIFEST:?ROBYN_MAINNET_MANIFEST is required}"
  deployment_manifest="$ROBYN_MAINNET_MANIFEST"
fi
[[ -r "$deployment_manifest" ]] || { echo "missing deployment manifest: $deployment_manifest" >&2; exit 1; }

target="$release_root/$release_id"
staging="$staging_root/$release_id.$$"
archive="/tmp/robyn-web-release-$$.tar"
freeze_evidence="/tmp/robyn-contract-freeze-$$.json"
audit_json="/tmp/robyn-web-audit-$$.json"
cleanup() {
  rm -f "$archive" "$freeze_evidence" "$audit_json"
  if [[ -d "$staging" ]]; then chmod -R u+w "$staging" 2>/dev/null || true; rm -rf "$staging"; fi
}
trap cleanup EXIT
[[ ! -e "$target" ]] || { echo "release exists: $target" >&2; exit 1; }

node scripts/verify-schema18-contract-freeze.mjs > "$freeze_evidence"
pnpm exec prettier --check apps/web config/schema18-contract-freeze.json scripts/verify-schema18-contract-freeze.mjs scripts/test/schema18-contract-freeze.test.mjs
bash -n scripts/build-web-release.sh
pnpm --filter @robyn/web lint
pnpm --filter @robyn/web typecheck
pnpm --filter @robyn/web test
node --test scripts/test/schema18-contract-freeze.test.mjs
gitleaks git --redact . >/dev/null
pnpm audit --audit-level high --json > "$audit_json"

mkdir -p "$release_root" "$staging_root" "$staging/release-evidence"
git archive --format=tar "$git_sha" -o "$archive"
tar -xf "$archive" -C "$staging"
cp "$freeze_evidence" "$staging/release-evidence/frozen-contract-qualification.json"
cp "$audit_json" "$staging/release-evidence/application-dependency-audit.json"
if [[ "$network" == mainnet ]]; then
  cp "$deployment_manifest" "$staging/deployments/4663-mainnet.json"
  deployment_manifest="$staging/deployments/4663-mainnet.json"
else
  deployment_manifest="$staging/$deployment_manifest"
fi

export TZ=UTC LC_ALL=C SOURCE_DATE_EPOCH
SOURCE_DATE_EPOCH="$(git show -s --format=%ct "$git_sha")"
export ROBYN_BUILD_ID="$git_sha"
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(node scripts/prepare-next-build-inputs.mjs "$staging" "$next_secrets")"

(
  cd "$staging"
  pnpm install --frozen-lockfile --package-import-method=copy
  if [[ "$network" == devnet ]]; then
    ROBYN_NETWORK_MODE=devnet NEXT_PUBLIC_ROBYN_NETWORK_MODE=devnet ROBYN_DEPLOYMENT_PATH="$deployment_manifest" pnpm --filter @robyn/web build
  elif [[ "$network" == testnet ]]; then
    node scripts/validate-public-release-environment.mjs testnet "$deployment_manifest" "$NEXT_PUBLIC_APP_URL" "$ROBYN_TESTNET_RPC_URL" "${NEXT_PUBLIC_ROBYN_EXPLORER_URL:-https://explorer.testnet.chain.robinhood.com}"
    ROBYN_NETWORK_MODE=testnet NEXT_PUBLIC_ROBYN_NETWORK_MODE=testnet ROBYN_DEPLOYMENT_PATH="$deployment_manifest" NEXT_PUBLIC_ROBYN_RPC_URL="$ROBYN_TESTNET_RPC_URL" NEXT_PUBLIC_ROBYN_EXPLORER_URL="${NEXT_PUBLIC_ROBYN_EXPLORER_URL:-https://explorer.testnet.chain.robinhood.com}" NEXT_PUBLIC_DATA_API_URL="" NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID" NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" pnpm --filter @robyn/web build
  else
    node scripts/validate-public-release-environment.mjs mainnet "$deployment_manifest" "$NEXT_PUBLIC_APP_URL" "$ROBYN_MAINNET_RPC_URL" "$ROBYN_MAINNET_EXPLORER_URL"
    ROBYN_NETWORK_MODE=mainnet NEXT_PUBLIC_ROBYN_NETWORK_MODE=mainnet ROBYN_DEPLOYMENT_PATH="$deployment_manifest" NEXT_PUBLIC_ROBYN_RPC_URL="$ROBYN_MAINNET_RPC_URL" NEXT_PUBLIC_ROBYN_EXPLORER_URL="$ROBYN_MAINNET_EXPLORER_URL" NEXT_PUBLIC_DATA_API_URL="" NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID" NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" pnpm --filter @robyn/web build
  fi
  rm -rf apps/web/.next/cache
  [[ -s apps/web/.next/BUILD_ID ]]
  find apps/web/.next -type f -print0 | sort -z | xargs -0 sha256sum > web-release-files.sha256
  jq -n \
    --arg releaseId "$release_id" \
    --arg gitSha "$git_sha" \
    --arg createdAt "$(date -u +%FT%TZ)" \
    --arg network "$network" \
    --argjson chainId "$chain_id" \
    --arg contractFreezeSha256 "$(sha256sum config/schema18-contract-freeze.json | cut -d' ' -f1)" \
    --arg deploymentManifestSha256 "$(sha256sum "$deployment_manifest" | cut -d' ' -f1)" \
    '{schemaVersion:1,releaseId:$releaseId,gitSha:$gitSha,createdAt:$createdAt,scope:"web-only",network:$network,chainId:$chainId,contractFreezeSha256:$contractFreezeSha256,deploymentManifestSha256:$deploymentManifestSha256,gates:["frozen-contract-attestation","web-format","web-lint","web-typecheck","web-tests","gitleaks","dependency-audit","protected-web-build"]}' > web-release-manifest.json
  sha256sum web-release-manifest.json > web-release-manifest.json.sha256
  sha256sum -c web-release-files.sha256 >/dev/null
)

find "$staging" -mindepth 1 -exec chmod a-w {} +
mv "$staging" "$target"
staging=""
chmod a-w "$target"
printf 'webRelease=%s\ngitSha=%s\ncontractMode=frozen-schema18\n' "$target" "$git_sha"

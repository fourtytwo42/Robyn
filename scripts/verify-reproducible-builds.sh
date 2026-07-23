#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run as the unprivileged release operator." >&2
  exit 1
fi

repo="/home/hendo420/Robyn"
evidence_root="${REPRO_EVIDENCE_ROOT:-/var/backups/robyn/reproducibility}"
run_id="${REPRO_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
output="${evidence_root}/${run_id}"
fixed_root="/var/tmp/robyn-reproducible-build"
work="${fixed_root}/source"
next_secrets="${ROBYN_NEXT_BUILD_SECRETS_FILE:-/home/hendo420/.config/robyn/next-build-secrets.json}"
git_sha="$(git -C "${repo}" rev-parse HEAD)"
epoch="$(git -C "${repo}" show -s --format=%ct "${git_sha}")"
mkdir -p "${output}"
chmod 0700 "${output}"

if [[ -n "$(git -C "${repo}" status --porcelain)" ]]; then
  echo "Refusing reproducibility check for a dirty checkout." >&2
  exit 1
fi
if [[ "$(git -C "${repo}" rev-parse '@{u}')" != "${git_sha}" ]]; then
  echo "Refusing reproducibility check for an unpushed commit." >&2
  exit 1
fi
rm -rf -- "${fixed_root}"
mkdir -p "${fixed_root}/store-a" "${fixed_root}/store-b"
[[ -r "${next_secrets}" ]] || {
  echo "Missing protected Next build secrets: ${next_secrets}" >&2
  exit 1
}
next_secrets_sha="$(sha256sum "${next_secrets}" | cut -d' ' -f1)"

archive="${output}/source.tar"
git -C "${repo}" archive --format=tar "${git_sha}" -o "${archive}"
source_sha="$(sha256sum "${archive}" | cut -d' ' -f1)"

build_one() {
  local side="$1" store="${fixed_root}/store-$1"
  rm -rf -- "${work}"
  mkdir -p "${work}"
  tar -xf "${archive}" -C "${work}"
  cd "${work}"
  export TZ=UTC
  export LC_ALL=C
  export SOURCE_DATE_EPOCH="${epoch}"
  export ROBYN_BUILD_ID="${git_sha}"
  export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(
    node scripts/prepare-next-build-inputs.mjs "${work}" "${next_secrets}"
  )"
  pnpm install --frozen-lockfile --package-import-method=copy \
    --store-dir "${store}" >"${output}/${side}-install.log"
  pnpm build >"${output}/${side}-build.log"
  PATH=/home/hendo420/.foundry/bin:${PATH} forge build \
    --root packages/contracts --out contracts-out \
    >"${output}/${side}-contracts.log"
  pnpm list --depth Infinity --json >"${output}/${side}-dependencies.json"
  pnpm licenses list --json >"${output}/${side}-licenses.json"
  node scripts/generate-cyclonedx-sbom.mjs \
    "${output}/${side}-dependencies.json" \
    "${output}/${side}-cyclonedx-sbom.json" \
    "${git_sha}"

  find apps packages -type f \
    \( -path '*/dist/*' -o -path '*/.next/*' \) \
    ! -path '*/.next/cache/*' ! -name trace -print0 | sort -z |
    while IFS= read -r -d '' application_file; do
      case "${application_file}" in
        *.json)
          if jq -e . "${application_file}" >/dev/null 2>&1; then
            digest="$(jq -cS . "${application_file}" | sha256sum | cut -d' ' -f1)"
          else
            digest="$(sha256sum "${application_file}" | cut -d' ' -f1)"
          fi
          ;;
        *client-reference-manifest.js)
          manifest_json="$(sed -E 's/^.*]=//' "${application_file}")"
          digest="$(jq -cS . <<<"${manifest_json}" | sha256sum | cut -d' ' -f1)"
          ;;
        *)
          digest="$(sha256sum "${application_file}" | cut -d' ' -f1)"
          ;;
      esac
      printf '%s  %s\n' "${digest}" "${application_file}"
    done >"${output}/${side}-application.sha256"
  find packages/contracts/contracts-out -type f -name '*.json' -print0 |
    sort -z |
    while IFS= read -r -d '' artifact; do
      relative="${artifact#packages/contracts/contracts-out/}"
      digest="$(jq -cS \
        '{abi,bytecode:.bytecode.object,deployedBytecode:.deployedBytecode.object,storageLayout}' \
        "${artifact}" | sha256sum | cut -d' ' -f1)"
      printf '%s  %s\n' "${digest}" "${relative}"
    done >"${output}/${side}-contracts-semantic.sha256"
  {
    find packages/db/migrations scripts infrastructure -type f -print0
    printf '%s\0' package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json
  } | sort -z | xargs -0 sha256sum >"${output}/${side}-operations.sha256"
  jq -cS . "${output}/${side}-dependencies.json" \
    >"${output}/${side}-dependencies.canonical.json"
  jq -cS . "${output}/${side}-licenses.json" \
    >"${output}/${side}-licenses.canonical.json"
  jq -cS . "${output}/${side}-cyclonedx-sbom.json" \
    >"${output}/${side}-cyclonedx-sbom.canonical.json"
}

build_one a
cp -a "${work}/apps/web/.next" "${fixed_root}/second-web-build"
build_one b

compare() {
  local subject="$1"
  if ! cmp -s "${output}/a-${subject}" "${output}/b-${subject}"; then
    diff -u "${output}/a-${subject}" "${output}/b-${subject}" \
      >"${output}/${subject}.diff" || true
    echo "Reproducibility mismatch: ${subject}" >&2
    return 1
  fi
}

compare application.sha256
compare contracts-semantic.sha256
compare operations.sha256
compare dependencies.canonical.json
compare licenses.canonical.json
compare cyclonedx-sbom.canonical.json

cd "${work}"
PORT=3300 HOSTNAME=127.0.0.1 \
  ROBYN_NETWORK_MODE=devnet \
  ROBYN_INTERNAL_API_URL=http://127.0.0.1:3100 \
  pnpm --filter @robyn/web start >"${output}/second-build-serve.log" 2>&1 &
serve_pid="$!"
cleanup_serve() {
  kill "${serve_pid}" >/dev/null 2>&1 || true
  wait "${serve_pid}" >/dev/null 2>&1 || true
}
trap cleanup_serve EXIT
served=0
for _ in {1..60}; do
  if curl -fsS --max-time 3 http://127.0.0.1:3300/discover \
    >"${output}/second-build-discover.html" 2>/dev/null; then
    served=1
    break
  fi
  sleep 0.5
done
if [[ "${served}" != "1" ]]; then
  echo "Second clean build did not serve successfully." >&2
  exit 1
fi
grep -Eq 'Development network only|Controlled development network' \
  "${output}/second-build-discover.html"
cleanup_serve
trap - EXIT

jq -n \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg gitSha "${git_sha}" \
  --arg sourceArchiveSha256 "${source_sha}" \
  --arg nodeVersion "$(node --version)" \
  --arg pnpmVersion "$(pnpm --version)" \
  --arg forgeVersion "$(PATH=/home/hendo420/.foundry/bin:${PATH} forge --version | head -1)" \
  --arg nextBuildSecretsSha256 "${next_secrets_sha}" \
  '{
    schemaVersion:1,generatedAt:$generatedAt,gitSha:$gitSha,
    sourceArchiveSha256:$sourceArchiveSha256,
    nextBuildSecretsSha256:$nextBuildSecretsSha256,
    toolchain:{node:$nodeVersion,pnpm:$pnpmVersion,foundry:$forgeVersion},
    cleanArchives:2,freshPnpmStores:2,
    normalizationRules:[
      "both independent archives build sequentially at /var/tmp/robyn-reproducible-build/source because Next and Solidity JSON containers embed absolute source roots",
      "Next BUILD_ID is the exact Git SHA",
      "Next preview and Server Actions cryptographic values come from one protected VM build input; evidence records only its SHA-256",
      "TZ=UTC, LC_ALL=C and SOURCE_DATE_EPOCH=commit timestamp",
      "Next cache and trace telemetry are excluded",
      "JSON and Next client-reference manifests are canonicalized by recursively sorting object keys while preserving array order",
      "CycloneDX 1.5 SBOM content is derived from the exact pnpm dependency graph and release commit",
      "contract comparison selects ABI, creation bytecode, runtime bytecode and storage layout and excludes absolute-path metadata"
    ],
    comparisons:{
      applicationBundles:true,contractSemantics:true,operations:true,
      dependencyGraph:true,licenses:true,cycloneDxSbom:true,secondArtifactServed:true
    },
    passed:true
  }' >"${output}/summary.json"
(cd "${output}" && sha256sum ./* >SHA256SUMS)
printf 'reproducibility=passed\nsummary=%s\n' "${output}/summary.json"

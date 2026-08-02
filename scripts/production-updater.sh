#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "production updater must run as root" >&2; exit 1; }
exec 9>/run/lock/robyn-production-updater.lock
flock -n 9 || exit 0

config=/etc/robyn/release-agent/config.env
[[ -r "${config}" ]] || { echo "missing release-agent config" >&2; exit 1; }
LC_ALL=C grep -q $'\r' "${config}" && { echo "release-agent config must use LF line endings" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${config}"
set +a
: "${ROBYN_GITHUB_REPOSITORY:?}"
: "${ROBYN_RELEASE_TAG_PREFIX:=mainnet-prod-}"
: "${ROBYN_RELEASE_ALLOWED_SIGNERS:=/etc/robyn/release-agent/allowed_signers}"
: "${ROBYN_RELEASE_DOWNLOAD_ROOT:=/var/lib/robyn-release/downloads}"
: "${ROBYN_RELEASE_ROOT:=/opt/robyn/releases}"

api="https://api.github.com/repos/${ROBYN_GITHUB_REPOSITORY}"
headers=(-H "X-GitHub-Api-Version: 2022-11-28")
if [[ -n "${ROBYN_GITHUB_TOKEN_FILE:-}" ]]; then
  [[ -r "${ROBYN_GITHUB_TOKEN_FILE}" ]] || { echo "GitHub token file missing" >&2; exit 1; }
  headers+=(-H "Authorization: Bearer $(<"${ROBYN_GITHUB_TOKEN_FILE}")")
fi
release_json="$(curl -fsS "${headers[@]}" -H "Accept: application/vnd.github+json" "${api}/releases?per_page=30" |
  jq -c --arg prefix "${ROBYN_RELEASE_TAG_PREFIX}" '[.[] | select(.draft == false and .prerelease == false and (.tag_name | startswith($prefix)))] | sort_by(.published_at) | last')"
[[ "${release_json}" != "null" ]] || exit 0
tag="$(jq -r .tag_name <<<"${release_json}")"
[[ "${tag}" =~ ^mainnet-prod-[0-9]{8}-[0-9a-f]{7,40}$ ]] || { echo "invalid production tag" >&2; exit 1; }
state=/var/lib/robyn-release/deployed-tag
[[ ! -r "${state}" || "$(<"${state}")" != "${tag}" ]] || exit 0

work="$(mktemp -d "${ROBYN_RELEASE_DOWNLOAD_ROOT}/${tag}.XXXXXX")"
staging=""
case "${work}" in
  "${ROBYN_RELEASE_DOWNLOAD_ROOT}/${tag}."*) ;;
  *) echo "unsafe updater work path" >&2; exit 1 ;;
esac
cleanup() {
  case "${work}" in "${ROBYN_RELEASE_DOWNLOAD_ROOT}/${tag}."*) rm -rf -- "${work}" ;; esac
  if [[ -n "${staging}" ]]; then
    case "${staging}" in /opt/robyn/staging/*) rm -rf -- "${staging}" ;; esac
  fi
}
trap cleanup EXIT
for asset in production-release.json production-release.json.sig runtime.tar.zst runtime.tar.zst.sha256; do
  url="$(jq -r --arg name "${asset}" '.assets[] | select(.name == $name) | .url' <<<"${release_json}")"
  [[ -n "${url}" && "${url}" != "null" ]] || { echo "missing release asset: ${asset}" >&2; exit 1; }
  curl -fsSL --proto '=https' --proto-redir '=https' --max-redirs 3 \
    "${headers[@]}" -H "Accept: application/octet-stream" "${url}" -o "${work}/${asset}"
done
(
  cd "${work}"
  ssh-keygen -Y verify -f "${ROBYN_RELEASE_ALLOWED_SIGNERS}" -I sherwoodforest-mainnet-release -n file -s production-release.json.sig < production-release.json
)
source_sha="$(jq -r .sourceSha "${work}/production-release.json")"
[[ "${source_sha}" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid source SHA" >&2; exit 1; }
[[ "${tag}" == *"-${source_sha:0:7}" ]] || { echo "tag/source mismatch" >&2; exit 1; }
expected_runtime_hash="$(jq -r .runtimeArchiveHash "${work}/production-release.json")"
[[ "${expected_runtime_hash}" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid signed runtime hash" >&2; exit 1; }
actual_runtime_hash="$(sha256sum "${work}/runtime.tar.zst" | cut -d' ' -f1)"
[[ "${actual_runtime_hash}" == "${expected_runtime_hash}" ]] || { echo "signed runtime hash mismatch" >&2; exit 1; }
declared_runtime_hash="$(awk 'NR == 1 { print $1 }' "${work}/runtime.tar.zst.sha256")"
[[ "${declared_runtime_hash}" == "${expected_runtime_hash}" ]] || { echo "release checksum asset mismatch" >&2; exit 1; }
target="${ROBYN_RELEASE_ROOT}/${source_sha}"
[[ ! -e "${target}" ]] || { echo "release source SHA already exists" >&2; exit 1; }
staging="/opt/robyn/staging/${source_sha}.$$"
mkdir -p "${staging}"
tar --no-same-owner --zstd -xf "${work}/runtime.tar.zst" -C "${staging}"
cp "${work}/production-release.json" "${staging}/production-release.json"
current_source=""
[[ -L /opt/robyn/current ]] && current_source="$(basename "$(readlink -f /opt/robyn/current)")"
node "${staging}/scripts/validate-production-release.mjs" "${staging}/production-release.json" "${staging}" "${current_source}"

old_target=""
[[ -L /opt/robyn/current ]] && old_target="$(readlink -f /opt/robyn/current)"
mv "${staging}" "${target}"
staging=""
chmod -R a+rX,go-w "${target}"
chmod -R a-w "${target}"
temporary="/opt/robyn/current.next.$$"
ln -s "${target}" "${temporary}"
mv -Tf "${temporary}" /opt/robyn/current

start_release() {
  local root="${1}"
  set -a
  # shellcheck disable=SC1091
  source /etc/robyn/mainnet/runtime.env
  set +a
  export ROBYN_PRODUCTION_RELEASE_ROOT="${root}"
  runuser -u robynapp -- env \
    HOME=/var/lib/robynapp \
    PM2_HOME=/var/lib/robynapp/.pm2 \
    ROBYN_PRODUCTION_RELEASE_ROOT="${root}" \
    ROBYN_MAINNET_MANIFEST="${ROBYN_MAINNET_MANIFEST}" \
    ROBYN_MAINNET_PRIMARY_RPC_URL="${ROBYN_MAINNET_PRIMARY_RPC_URL}" \
    ROBYN_MAINNET_PROBE_RPC_URL="${ROBYN_MAINNET_PROBE_RPC_URL}" \
    ROBYN_MAINNET_DATABASE="${ROBYN_MAINNET_DATABASE}" \
    ROBYN_MAINNET_AUTH_ORIGINS="${ROBYN_MAINNET_AUTH_ORIGINS}" \
    ROBYN_MAINNET_TRANSACTION_SUBMISSION_AUTHORIZED="${ROBYN_MAINNET_TRANSACTION_SUBMISSION_AUTHORIZED}" \
    ROBYN_RELEASE_SHA="$(basename "${root}")" \
    /usr/local/bin/pm2 startOrReload "${root}/infrastructure/pm2/ecosystem.mainnet.production.cjs" --update-env
}

rollback() {
  if [[ -n "${old_target}" ]]; then
    local back="/opt/robyn/current.rollback.$$"
    ln -s "${old_target}" "${back}"
    mv -Tf "${back}" /opt/robyn/current
    start_release "${old_target}" || true
  fi
}
trap 'rollback' ERR

set -a
# shellcheck disable=SC1091
source /etc/robyn/mainnet/runtime.env
set +a
runuser -u robynapp -- env PGHOST=/var/run/postgresql PGDATABASE="${ROBYN_MAINNET_DATABASE}" PGUSER=robynapp /opt/node-v24.18.0-linux-x64/bin/node "${target}/packages/db/dist/migrate.js"
start_release "${target}"

healthy=false
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:18549/health >/dev/null &&
    curl -fsS http://127.0.0.1:3121/status >/dev/null &&
    curl -fsS http://127.0.0.1:3220/health >/dev/null &&
    curl -fsS http://127.0.0.1:3022/api/health >/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done
[[ "${healthy}" == true ]] || { echo "production release health failed" >&2; false; }
runuser -u robynapp -- env HOME=/var/lib/robynapp PM2_HOME=/var/lib/robynapp/.pm2 /usr/local/bin/pm2 save --force
printf '%s\n' "${tag}" >"${state}"
jq -n --arg deployedAt "$(date -u +%FT%TZ)" --arg tag "${tag}" --arg sourceSha "${source_sha}" '{deployedAt:$deployedAt,tag:$tag,sourceSha:$sourceSha}' >"/var/lib/robyn-release/${tag}.json"
trap - ERR

#!/usr/bin/env bash
set -euo pipefail

release_id="${1:?usage: promote-release.sh RELEASE_ID}"
root=/opt/robyn
target="${root}/releases/${release_id}"
current="${root}/current"
previous="${root}/previous"
history=/var/lib/robyn/release-history
pm2_home=/home/hendo420/.pm2
legacy_root="${ROBYN_LEGACY_ROOT:-/home/hendo420/Robyn}"
pm2_bin="${target}/node_modules/.bin/pm2"

[[ -d "${target}" ]] || {
  echo "unknown release: ${target}" >&2
  exit 1
}
(
  cd "${target}"
  sha256sum -c release-manifest.json.sha256 >/dev/null
  sha256sum -c release-files.sha256 >/dev/null
)

old_target=""
if [[ -L "${current}" ]]; then
  old_target="$(readlink -f "${current}")"
fi

atomic_link() {
  local destination="${1}"
  local link="${2}"
  local temporary="${link}.next.$$"
  ln -s "${destination}" "${temporary}"
  mv -Tf "${temporary}" "${link}"
}

switch_processes() {
  local process_root="${1}"
  local ecosystem="${2}"
  PM2_HOME="${pm2_home}" "${pm2_bin}" delete all >/dev/null 2>&1 || true
  ROBYN_RELEASE_ROOT="${process_root}" PM2_HOME="${pm2_home}" "${pm2_bin}" start "${ecosystem}"
}

rollback_failed_promotion() {
  if [[ -n "${old_target}" ]]; then
    atomic_link "${old_target}" "${current}"
    switch_processes "${old_target}" "${current}/infrastructure/pm2/ecosystem.config.cjs"
  else
    rm -f "${current}"
    switch_processes "${legacy_root}" "${legacy_root}/infrastructure/pm2/ecosystem.config.cjs"
  fi
  PM2_HOME="${pm2_home}" "${pm2_bin}" save --force
}

atomic_link "${target}" "${current}"
if ! switch_processes "${target}" "${current}/infrastructure/pm2/ecosystem.config.cjs"; then
  rollback_failed_promotion
  exit 1
fi

healthy=false
for _ in $(seq 1 30); do
  if "${target}/scripts/verify-release.sh" "${current}" >/tmp/robyn-release-verify.json 2>/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "${healthy}" != true ]]; then
  echo "release health verification failed; restoring prior release" >&2
  rollback_failed_promotion
  exit 1
fi

if [[ -n "${old_target}" && "${old_target}" != "${target}" ]]; then
  atomic_link "${old_target}" "${previous}"
fi
PM2_HOME="${pm2_home}" "${pm2_bin}" save --force

mkdir -p "${history}"
history_file="${history}/$(date -u +%Y%m%dT%H%M%SZ)-promote-${release_id}.json"
jq --arg action promote --arg previous "${old_target}" '. + {action:$action,previousRelease:$previous}' /tmp/robyn-release-verify.json >"${history_file}"
rm -f /tmp/robyn-release-verify.json
cat "${history_file}"

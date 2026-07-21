#!/usr/bin/env bash
set -euo pipefail

root=/opt/robyn
current="${root}/current"
previous="${root}/previous"
history=/var/lib/robyn/release-history
pm2_home=/home/hendo420/.pm2

[[ -L "${current}" && -L "${previous}" ]] || {
  echo "current and previous release links are required" >&2
  exit 1
}

current_target="$(readlink -f "${current}")"
previous_target="$(readlink -f "${previous}")"
pm2_bin="${previous_target}/node_modules/.bin/pm2"
[[ "${current_target}" != "${previous_target}" ]] || {
  echo "current and previous releases are identical" >&2
  exit 1
}

atomic_link() {
  local destination="${1}"
  local link="${2}"
  local temporary="${link}.next.$$"
  ln -s "${destination}" "${temporary}"
  mv -Tf "${temporary}" "${link}"
}

switch_processes() {
  local process_root="${1}"
  PM2_HOME="${pm2_home}" "${pm2_bin}" delete all >/dev/null 2>&1 || true
  ROBYN_RELEASE_ROOT="${process_root}" PM2_HOME="${pm2_home}" "${pm2_bin}" start "${current}/infrastructure/pm2/ecosystem.config.cjs"
}

atomic_link "${previous_target}" "${current}"
if ! switch_processes "${previous_target}"; then
  atomic_link "${current_target}" "${current}"
  switch_processes "${current_target}"
  exit 1
fi

healthy=false
for _ in $(seq 1 30); do
  if "${previous_target}/scripts/verify-release.sh" "${current}" >/tmp/robyn-release-rollback.json 2>/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "${healthy}" != true ]]; then
  echo "rollback target failed health verification; restoring current release" >&2
  atomic_link "${current_target}" "${current}"
  switch_processes "${current_target}"
  PM2_HOME="${pm2_home}" "${pm2_bin}" save --force
  exit 1
fi

atomic_link "${current_target}" "${previous}"
PM2_HOME="${pm2_home}" "${pm2_bin}" save --force
mkdir -p "${history}"
history_file="${history}/$(date -u +%Y%m%dT%H%M%SZ)-rollback.json"
jq --arg action rollback --arg previous "${current_target}" '. + {action:$action,previousRelease:$previous}' /tmp/robyn-release-rollback.json >"${history_file}"
rm -f /tmp/robyn-release-rollback.json
cat "${history_file}"

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

atomic_link "${previous_target}" "${current}"
PM2_HOME="${pm2_home}" "${previous_target}/node_modules/.bin/pm2" startOrReload "${current}/infrastructure/pm2/ecosystem.config.cjs" --update-env

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
  PM2_HOME="${pm2_home}" "${current_target}/node_modules/.bin/pm2" startOrReload "${current}/infrastructure/pm2/ecosystem.config.cjs" --update-env
  PM2_HOME="${pm2_home}" "${current_target}/node_modules/.bin/pm2" save --force
  exit 1
fi

atomic_link "${current_target}" "${previous}"
PM2_HOME="${pm2_home}" "${previous_target}/node_modules/.bin/pm2" save --force
mkdir -p "${history}"
history_file="${history}/$(date -u +%Y%m%dT%H%M%SZ)-rollback.json"
jq --arg action rollback --arg previous "${current_target}" '. + {action:$action,previousRelease:$previous}' /tmp/robyn-release-rollback.json >"${history_file}"
rm -f /tmp/robyn-release-rollback.json
cat "${history_file}"

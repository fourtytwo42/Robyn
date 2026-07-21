#!/usr/bin/env bash
set -euo pipefail

root="${1:-}"
if [[ -z "${root}" || ! -d "${root}" ]]; then
  echo "Usage: scripts/verify-release-immutability.sh <release-directory>" >&2
  exit 1
fi
root="$(readlink -f "${root}")"
node_modules="${root}/node_modules"
[[ -d "${node_modules}" ]] || {
  echo "release node_modules directory is missing" >&2
  exit 1
}

mapfile -t writable < <(find "${root}" -xdev \( -type f -o -type d \) -perm /222 -print)
if (( ${#writable[@]} > 0 )); then
  echo "release contains writable regular files or directories:" >&2
  printf '%s\n' "${writable[@]:0:20}" >&2
  exit 1
fi

mapfile -t hardlinked < <(find "${node_modules}" -xdev -type f -links +1 -print)
if (( ${#hardlinked[@]} > 0 )); then
  echo "release dependencies contain shared hardlinks:" >&2
  printf '%s\n' "${hardlinked[@]:0:20}" >&2
  exit 1
fi

external_symlinks=()
while IFS= read -r -d '' link; do
  raw_target="$(readlink "${link}")"
  target="$(readlink -f "${link}")"
  if [[ "${raw_target}" == /* || -z "${target}" || "${target}" != "${root}"/* ]]; then
    external_symlinks+=("${link}")
  fi
done < <(find "${root}" -xdev -type l -print0)
if (( ${#external_symlinks[@]} > 0 )); then
  echo "release contains broken or external symlinks:" >&2
  printf '%s\n' "${external_symlinks[@]:0:20}" >&2
  exit 1
fi

jq -n \
  --arg releasePath "${root}" \
  --argjson regularFiles "$(find "${root}" -xdev -type f | wc -l)" \
  --argjson symlinks "$(find "${root}" -xdev -type l | wc -l)" \
  '{schemaVersion:1,releasePath:$releasePath,writablePaths:0,sharedHardlinks:0,externalSymlinks:0,regularFiles:$regularFiles,symlinks:$symlinks,passed:true}'

#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
validator="${repo}/scripts/verify-release-immutability.sh"
work="$(mktemp -d /tmp/robyn-immutability-test.XXXXXX)"

cleanup() {
  chmod -R u+w "${work}" 2>/dev/null || true
  rm -rf -- "${work}"
}
trap cleanup EXIT

mkdir -p "${work}/clean/node_modules/package"
printf 'module.exports = true;\n' >"${work}/clean/node_modules/package/index.js"
ln -s package "${work}/clean/node_modules/package-link"
chmod -R a-w "${work}/clean"
"${validator}" "${work}/clean" >/dev/null

cp -a "${work}/clean" "${work}/writable"
chmod u+w "${work}/writable/node_modules/package/index.js"
if "${validator}" "${work}/writable" >/dev/null 2>&1; then
  echo "validator accepted a writable dependency" >&2
  exit 1
fi

mkdir -p "${work}/hardlinked/node_modules"
printf 'shared\n' >"${work}/outside"
ln "${work}/outside" "${work}/hardlinked/node_modules/shared"
chmod -R a-w "${work}/hardlinked"
if "${validator}" "${work}/hardlinked" >/dev/null 2>&1; then
  echo "validator accepted a shared dependency hardlink" >&2
  exit 1
fi

mkdir -p "${work}/external/node_modules"
ln -s "${work}/outside" "${work}/external/node_modules/outside"
chmod -R a-w "${work}/external"
if "${validator}" "${work}/external" >/dev/null 2>&1; then
  echo "validator accepted an external dependency symlink" >&2
  exit 1
fi

printf '{"schemaVersion":1,"cases":4,"passed":true}\n'

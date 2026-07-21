#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root to access the recovery identity." >&2
  exit 1
fi
if [[ "${1:-}" == "" ]]; then
  echo "Usage: sudo scripts/rehearse-restore.sh /var/backups/robyn/robyn-state-*.tar.zst.age" >&2
  exit 1
fi

encrypted="$(readlink -f "${1}")"
checksum="${encrypted}.sha256"
identity="/etc/robyn/backup-age-identity.txt"
work="$(mktemp -d /var/tmp/robyn-restore.XXXXXX)"
bundle="${work}/state.tar.zst"
restore="${work}/restore"
database="robyn_restore_$(date -u +%Y%m%d%H%M%S)_${RANDOM}"
anvil_pid=""

cleanup() {
  if [[ -n "${anvil_pid}" ]]; then
    kill "${anvil_pid}" 2>/dev/null || true
    wait "${anvil_pid}" 2>/dev/null || true
  fi
  runuser -u postgres -- dropdb --if-exists "${database}" >/dev/null 2>&1 || true
  rm -rf -- "${work}"
}
trap cleanup EXIT

test -r "${encrypted}"
test -r "${checksum}"
test -r "${identity}"
for tool in age anvil curl jq pg_restore psql runuser sha256sum tar zstd; do
  command -v "${tool}" >/dev/null
done

(cd "$(dirname "${encrypted}")" && sha256sum -c "$(basename "${checksum}")")
age -d -i "${identity}" -o "${bundle}" "${encrypted}"
install -d -m 0700 "${restore}"
tar --zstd -xf "${bundle}" -C "${restore}"
(cd "${restore}" && sha256sum -c SHA256SUMS)

runuser -u postgres -- createdb "${database}"
runuser -u postgres -- pg_restore --no-owner --no-acl -d "${database}" <"${restore}/database/robyn.dump"
while IFS=$'\t' read -r table expected; do
  actual="$(runuser -u postgres -- psql -d "${database}" -Atqc "SELECT count(*) FROM \"public\".\"${table}\"")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Database row-count mismatch for ${table}: ${actual} != ${expected}" >&2
    exit 1
  fi
done <"${restore}/database/table-counts.tsv"

artifact_count=0
while IFS= read -r -d '' object; do
  digest="$(sha256sum "${object}" | cut -d' ' -f1)"
  expected="$(basename "${object}")"
  if [[ "${expected}" != "${digest}" ]]; then
    echo "Restored artifact hash mismatch: ${object}" >&2
    exit 1
  fi
  artifact_count=$((artifact_count + 1))
done < <(find "${restore}/artifacts" -type f -print0)
manifest_artifacts="$(jq -r '.artifactCount' "${restore}/manifest.json")"
if [[ "${artifact_count}" != "${manifest_artifacts}" ]]; then
  echo "Restored artifact count mismatch." >&2
  exit 1
fi

anvil --host 127.0.0.1 --port 18545 --chain-id 31337 --silent >"${work}/anvil.log" 2>&1 &
anvil_pid=$!
for _ in {1..30}; do
  if curl -fsS -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:18545 >"${work}/chain.json" 2>/dev/null; then
    break
  fi
  sleep 0.25
done
if ! kill -0 "${anvil_pid}" 2>/dev/null; then
  cat "${work}/anvil.log" >&2
  exit 1
fi
jq -n --rawfile state "${restore}/anvil/state.json" '{jsonrpc:"2.0",id:1,method:"anvil_loadState",params:[($state | rtrimstr("\n"))]}' >"${work}/load-request.json"
curl -fsS -H 'content-type: application/json' --data-binary @"${work}/load-request.json" http://127.0.0.1:18545 >"${work}/load-result.json"
if [[ "$(jq -r '.result' "${work}/load-result.json")" != "true" ]]; then
  echo "Anvil rejected the restored RPC state." >&2
  exit 1
fi
chain_id="$(jq -r '.result' "${work}/chain.json")"
if [[ "${chain_id}" != "0x7a69" ]]; then
  echo "Restored Anvil chain ID mismatch: ${chain_id}" >&2
  exit 1
fi
factory="$(jq -r '.contracts.factory' "${restore}/anvil/deployment.json")"
curl -fsS -H 'content-type: application/json' --data "$(jq -nc --arg address "${factory}" '{jsonrpc:"2.0",id:1,method:"eth_getCode",params:[$address,"latest"]}')" http://127.0.0.1:18545 >"${work}/code.json"
if [[ "$(jq -r '.result' "${work}/code.json")" == "0x" ]]; then
  echo "Restored factory bytecode is missing." >&2
  exit 1
fi

table_count="$(wc -l <"${restore}/database/table-counts.tsv" | tr -d ' ')"
git_sha="$(jq -r '.gitSha' "${restore}/manifest.json")"
printf 'restore=passed\ndatabaseTables=%s\nartifacts=%s\nchainId=%s\nfactory=%s\ngitSha=%s\nliveStateTouched=false\n' "${table_count}" "${artifact_count}" "${chain_id}" "${factory}" "${git_sha}"

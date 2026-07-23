#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run as hendo420; backup creation does not require root." >&2
  exit 1
fi

repo="/home/hendo420/Robyn"
backup_root="${ROBYN_BACKUP_ROOT:-/var/backups/robyn}"
recipient_file="/etc/robyn/backup-age-recipient.txt"
release_tag="${ROBYN_BACKUP_RELEASE_TAG:-robyn-state-backups}"
backup_env="/etc/robyn/backup.env"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="robyn-state-${stamp}"
work="$(mktemp -d "${backup_root}/.work.XXXXXX")"
mc_config="$(mktemp -d "${backup_root}/.mc.XXXXXX")"
bundle="${backup_root}/${name}.tar.zst"
encrypted="${bundle}.age"
checksum="${encrypted}.sha256"

cleanup() {
  rm -rf -- "${work}"
  rm -rf -- "${mc_config}"
  rm -f -- "${bundle}"
}
trap cleanup EXIT

for tool in age curl gh jq pg_dump psql sha256sum tar zstd /usr/local/bin/mcli; do
  command -v "${tool}" >/dev/null
done
test -r "${recipient_file}"
test -r "${backup_env}"
install -d -m 0700 "${backup_root}"
install -d -m 0700 "${work}/database" "${work}/anvil" "${work}/artifacts" "${work}/configuration" "${work}/ipfs"

git_sha="$(git -C "${repo}" rev-parse HEAD)"
git_status="$(git -C "${repo}" status --porcelain)"
if [[ -n "${git_status}" ]]; then
  echo "Refusing to back up a dirty release checkout." >&2
  exit 1
fi

pg_dump --format=custom --no-owner --no-acl robyn >"${work}/database/robyn.dump"
while IFS= read -r table; do
  count="$(psql -d robyn -Atqc "SELECT count(*) FROM \"public\".\"${table}\"")"
  printf '%s\t%s\n' "${table}" "${count}"
done < <(psql -d robyn -Atqc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename") >"${work}/database/table-counts.tsv"

curl -fsS -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"anvil_dumpState","params":[]}' http://127.0.0.1:8545 |
  jq -er '.result' >"${work}/anvil/state.json"
cp "${repo}/deployments/31337.json" "${work}/anvil/deployment.json"
sudo -n -u robyn-ipfs env IPFS_PATH=/var/lib/robyn-ipfs \
  /usr/local/bin/ipfs pin ls --type=recursive --quiet |
  sort >"${work}/ipfs/pins.txt"
/usr/local/bin/ipfs version --number >"${work}/ipfs/kubo-version.txt"
pin_count="$(wc -l <"${work}/ipfs/pins.txt")"

# shellcheck disable=SC1090
source "${backup_env}"
/usr/local/bin/mcli --config-dir "${mc_config}" alias set robyn-backup "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" >/dev/null
/usr/local/bin/mcli --config-dir "${mc_config}" mirror --overwrite --preserve "robyn-backup/${MINIO_BUCKET}" "${work}/artifacts" >/dev/null

artifact_count=0
while IFS= read -r -d '' object; do
  digest="$(sha256sum "${object}" | cut -d' ' -f1)"
  expected="$(basename "${object}")"
  if [[ "${expected}" != "${digest}" ]]; then
    echo "Artifact hash mismatch: ${object}" >&2
    exit 1
  fi
  artifact_count=$((artifact_count + 1))
done < <(find "${work}/artifacts" -type f -print0)

cp "${repo}/infrastructure/pm2/ecosystem.config.cjs" "${work}/configuration/"
cp "${repo}/pnpm-lock.yaml" "${work}/configuration/"
systemctl cat robyn-anvil.service >"${work}/configuration/robyn-anvil.service"
systemctl cat minio.service >"${work}/configuration/minio.service"
systemctl cat pm2-hendo420.service >"${work}/configuration/pm2-hendo420.service"
systemctl cat robyn-ipfs.service >"${work}/configuration/robyn-ipfs.service"

jq -n --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg gitSha "${git_sha}" --arg host "$(hostname)" --argjson artifactCount "${artifact_count}" --argjson ipfsPinCount "${pin_count}" '{schemaVersion:2,createdAt:$createdAt,gitSha:$gitSha,host:$host,chainId:31337,database:"robyn",artifactCount:$artifactCount,ipfsPinCount:$ipfsPinCount,ipfsRecovery:"readd-minio-and-verify-cids",secretsIncluded:false}' >"${work}/manifest.json"
(
  cd "${work}"
  checksum_tmp="$(mktemp)"
  find . -type f -print0 | sort -z | xargs -0 sha256sum >"${checksum_tmp}"
  mv "${checksum_tmp}" SHA256SUMS
)

tar --zstd -cf "${bundle}" -C "${work}" .
age -r "$(tr -d '\r\n' <"${recipient_file}")" -o "${encrypted}" "${bundle}"
chmod 0600 "${encrypted}"
(cd "${backup_root}" && sha256sum "$(basename "${encrypted}")" >"$(basename "${checksum}")")

if ! gh release view "${release_tag}" -R fourtytwo42/Robyn >/dev/null 2>&1; then
  gh release create "${release_tag}" -R fourtytwo42/Robyn --target main --title "Encrypted Robyn state backups" --notes "Automated encrypted release-state backups. Recovery identity is stored separately and is never uploaded."
fi
gh release upload "${release_tag}" "${encrypted}" "${checksum}" -R fourtytwo42/Robyn --clobber

mapfile -t old_assets < <(gh api "repos/fourtytwo42/Robyn/releases/tags/${release_tag}" |
  jq -r '.assets | sort_by(.created_at) | reverse | .[14:][]?.id')
for asset_id in "${old_assets[@]}"; do
  gh api -X DELETE "repos/fourtytwo42/Robyn/releases/assets/${asset_id}" >/dev/null
done

printf 'backup=%s\nchecksum=%s\ngitSha=%s\nartifacts=%s\noffVmRelease=%s\n' "${encrypted}" "${checksum}" "${git_sha}" "${artifact_count}" "${release_tag}"

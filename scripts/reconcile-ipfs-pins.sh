#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run as hendo420; IPFS reconciliation does not require root." >&2
  exit 1
fi

ipfs_api_url="${ROBYN_IPFS_API_URL:-http://127.0.0.1:5001}"
artifact_url="${ROBYN_ARTIFACT_SERVICE_URL:-http://127.0.0.1:3200}"
work="$(mktemp -d /var/tmp/robyn-ipfs-reconcile.XXXXXX)"
trap 'rm -rf -- "${work}"' EXIT

curl -fsS -X POST "${ipfs_api_url}/api/v0/pin/ls?type=recursive" |
  jq -r '.Keys | keys[] | select(test("^b[a-z2-7]{20,120}$"))' |
  sort >"${work}/kubo-pins.txt"

while IFS= read -r cid; do
  [[ "${cid}" =~ ^b[a-z2-7]{20,120}$ ]]
  artifact_sha="$(
    psql -d robyn -Atqc \
      "SELECT artifact_sha256 FROM ipfs_pins WHERE cid='${cid}'"
  )"
  if [[ -z "${artifact_sha}" ]]; then
    curl -fsS -X POST "${ipfs_api_url}/api/v0/cat?arg=${cid}" \
      >"${work}/${cid}"
    artifact_sha="$(sha256sum "${work}/${cid}" | cut -d' ' -f1)"
    stored_sha="$(
      curl -fsS -X PUT \
        -H 'content-type: application/octet-stream' \
        -H 'x-artifact-content-type: application/octet-stream' \
        --data-binary @"${work}/${cid}" \
        "${artifact_url}/artifacts" |
        jq -er '.data.sha256'
    )"
    test "${stored_sha}" = "${artifact_sha}"
    psql -d robyn -v ON_ERROR_STOP=1 \
      --set=cid="${cid}" --set=sha="${artifact_sha}" <<'SQL'
INSERT INTO ipfs_pins (
  cid,object_kind,artifact_sha256,local_status,remote_status,attempts,verified_at
) VALUES (
  :'cid','fallback',:'sha','pinned','queued',1,now()
);
SQL
  fi

  curl -fsS "${artifact_url}/artifacts/${artifact_sha}" \
    >"${work}/${cid}.artifact"
  curl -fsS -X POST "${ipfs_api_url}/api/v0/cat?arg=${cid}" \
    >"${work}/${cid}.ipfs"
  cmp -s "${work}/${cid}.artifact" "${work}/${cid}.ipfs"
done <"${work}/kubo-pins.txt"

psql -d robyn -Atqc \
  "SELECT cid FROM ipfs_pins WHERE local_status='pinned' ORDER BY cid" \
  >"${work}/database-pins.txt"
cmp -s "${work}/kubo-pins.txt" "${work}/database-pins.txt"

printf 'reconciledPins=%s\n' "$(wc -l <"${work}/kubo-pins.txt" | tr -d ' ')"

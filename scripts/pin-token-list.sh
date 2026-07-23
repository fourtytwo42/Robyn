#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run as hendo420; token-list publication does not require root." >&2
  exit 1
fi

repo="/home/hendo420/Robyn"
api_url="${ROBYN_DATA_API_URL:-http://127.0.0.1:3101}"
artifact_url="${ROBYN_ARTIFACT_SERVICE_URL:-http://127.0.0.1:3200}"
ipfs_api_url="${ROBYN_IPFS_API_URL:-http://127.0.0.1:5001}"
manifest="${ROBYN_DEVNET_MANIFEST:-${repo}/deployments/31337.json}"
work="$(mktemp -d /var/tmp/robyn-token-list.XXXXXX)"
trap 'rm -rf -- "${work}"' EXIT

for tool in curl jq psql sha256sum; do
  command -v "${tool}" >/dev/null
done

curl -fsS "${api_url}/token-list" | jq -c . >"${work}/token-list.json"
jq -e '
  .name == "Robyn verified tokens" and
  (.timestamp | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$")) and
  (.version.major == 1) and
  (.tokens | length > 0) and
  all(.tokens[];
    .chainId == 31337 and
    (.address | test("^0x[0-9a-f]{40}$")) and
    (.logoURI | test("^ipfs://b[a-z2-7]{20,120}$")) and
    .decimals == 18
  )
' "${work}/token-list.json" >/dev/null

artifact_sha256="$(sha256sum "${work}/token-list.json" | cut -d' ' -f1)"
stored_sha256="$(
  curl -fsS -X PUT \
    -H 'content-type: application/octet-stream' \
    -H 'x-artifact-content-type: application/json' \
    --data-binary @"${work}/token-list.json" \
    "${artifact_url}/artifacts" |
    jq -er '.data.sha256'
)"
test "${stored_sha256}" = "${artifact_sha256}"

cid="$(
  curl -fsS -X POST \
    -F "file=@${work}/token-list.json;filename=robyn-token-list.json;type=application/json" \
    "${ipfs_api_url}/api/v0/add?cid-version=1&hash=sha2-256&pin=true&raw-leaves=true&wrap-with-directory=false" |
    tail -n 1 |
    jq -er '.Hash'
)"
[[ "${cid}" =~ ^b[a-z2-7]{20,120}$ ]]
curl -fsS -X POST "${ipfs_api_url}/api/v0/cat?arg=${cid}" |
  cmp -s - "${work}/token-list.json"

psql -d robyn -v ON_ERROR_STOP=1 \
  --set=cid="${cid}" --set=sha="${artifact_sha256}" <<'SQL'
INSERT INTO ipfs_pins (
  cid,object_kind,artifact_sha256,local_status,remote_status,attempts,verified_at
) VALUES (
  :'cid','token-list',:'sha','pinned','queued',1,now()
)
ON CONFLICT (cid) DO UPDATE SET
  object_kind='token-list',
  artifact_sha256=EXCLUDED.artifact_sha256,
  local_status='pinned',
  attempts=ipfs_pins.attempts+1,
  verified_at=now(),
  updated_at=now();
SQL

tmp="${manifest}.tmp"
jq \
  --arg cid "${cid}" \
  '.ipfsMetadata.tokenListCid=$cid
   | .ipfsMetadata.tokenListUri=("ipfs://"+$cid)
   | .ipfsMetadata.tokenListStablePath="/api/token-list"' \
  "${manifest}" >"${tmp}"
mv "${tmp}" "${manifest}"

printf 'tokenListCid=%s\ntokenListUri=ipfs://%s\ntokenListStablePath=/api/token-list\n' \
  "${cid}" "${cid}"

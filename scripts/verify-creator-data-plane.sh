#!/usr/bin/env bash
set -euo pipefail

repo_root="${ROBYN_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
api_url="${ROBYN_API_URL:-http://127.0.0.1:3101}"
database="${ROBYN_DATABASE:-robyn}"
deployment="${ROBYN_DEPLOYMENT_PATH:-${repo_root}/deployments/31337.json}"

for tool in curl jq psql; do
  command -v "${tool}" >/dev/null
done
test -f "${deployment}"

chain_id="$(jq -er '.chainId' "${deployment}")"
token="$(jq -er '.contracts.genesisToken | ascii_downcase' "${deployment}")"

mapfile -t counts < <(
  psql -X -v ON_ERROR_STOP=1 -d "${database}" -At <<'SQL'
SELECT count(*) FROM creator_profiles;
SELECT count(*) FROM media_assets;
SELECT count(*) FROM launch_metadata_bindings;
SELECT count(*) FROM media_reports;
SELECT count(*) FROM media_moderation_audit;
SQL
)
[[ "${#counts[@]}" -eq 5 ]]
[[ "${counts[0]}" -ge 1 && "${counts[1]}" -ge 1 && "${counts[2]}" -ge 1 ]]

session_json="$(curl -fsS "${api_url}/auth/session")"
jq -e '.data == null' <<<"${session_json}" >/dev/null

metadata_json="$(curl -fsS "${api_url}/launches/${token}/metadata")"
jq -e --argjson chain_id "${chain_id}" --arg token "${token}" \
  '.data.chain_id == $chain_id and .data.token == $token and .data.status == "active" and (.data.creator_address | test("^0x[0-9a-f]{40}$")) and (.data.media_id | length > 0)' \
  <<<"${metadata_json}" >/dev/null

creator="$(jq -er '.data.creator_address' <<<"${metadata_json}")"
media_id="$(jq -er '.data.media_id' <<<"${metadata_json}")"
profile_json="$(curl -fsS "${api_url}/profiles/${creator}")"
jq -e --argjson chain_id "${chain_id}" --arg creator "${creator}" \
  '.data.chain_id == $chain_id and .data.address == $creator and (.data.display_name | length > 0)' \
  <<<"${profile_json}" >/dev/null

headers="$(mktemp)"
media="$(mktemp)"
cleanup() { rm -f "${headers}" "${media}"; }
trap cleanup EXIT
curl -fsS -D "${headers}" -o "${media}" "${api_url}/media/${media_id}"
tr -d '\r' <"${headers}" | grep -Eiq '^content-type:[[:space:]]*image/webp([[:space:]]*;.*)?$'
[[ "$(wc -c <"${media}" | tr -d ' ')" -gt 1000 ]]

jq -n \
  --argjson chainId "${chain_id}" \
  --arg token "${token}" \
  --arg creator "${creator}" \
  --arg mediaId "${media_id}" \
  --argjson creatorProfiles "${counts[0]}" \
  --argjson mediaAssets "${counts[1]}" \
  --argjson launchBindings "${counts[2]}" \
  --argjson mediaReports "${counts[3]}" \
  --argjson moderationAudit "${counts[4]}" \
  '{
    schemaVersion: 1,
    passed: true,
    chainId: $chainId,
    token: $token,
    creator: $creator,
    mediaId: $mediaId,
    anonymousSessionIsNull: true,
    activeMediaContentType: "image/webp",
    tableCounts: {
      creatorProfiles: $creatorProfiles,
      mediaAssets: $mediaAssets,
      launchBindings: $launchBindings,
      mediaReports: $mediaReports,
      moderationAudit: $moderationAudit
    }
  }'

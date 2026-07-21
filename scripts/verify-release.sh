#!/usr/bin/env bash
set -euo pipefail

release_path="${1:-/opt/robyn/current}"
release_real="$(readlink -f "${release_path}")"
[[ "${release_real}" == /opt/robyn/releases/* ]] || {
  echo "release must resolve under /opt/robyn/releases" >&2
  exit 1
}
[[ -f "${release_real}/release-manifest.json" ]] || {
  echo "release manifest missing" >&2
  exit 1
}

jq -e '.packageImportMethod == "copy" and (.gates | index("immutability-validator") != null)' "${release_real}/release-manifest.json" >/dev/null || {
  echo "release manifest does not attest copied dependencies and immutability validation" >&2
  exit 1
}
immutability_json="$("${release_real}/scripts/verify-release-immutability.sh" "${release_real}")"
(
  cd "${release_real}"
  sha256sum -c release-manifest.json.sha256 >/dev/null
  sha256sum -c release-files.sha256 >/dev/null
)

expected_sha="$(jq -r .gitSha "${release_real}/release-manifest.json")"
pm2_bin="${release_real}/node_modules/.bin/pm2"
pm2_json="$(PM2_HOME=/home/hendo420/.pm2 "${pm2_bin}" jlist)"
app_count="$(jq 'length' <<<"${pm2_json}")"
online_count="$(jq '[.[] | select(.pm2_env.status == "online")]|length' <<<"${pm2_json}")"
wrong_cwd="$(jq --arg cwd "${release_real}" --arg web_cwd "${release_real}/apps/web" '[.[] | select((.name == "robyn-web" and .pm2_env.pm_cwd != $web_cwd) or (.name != "robyn-web" and .pm2_env.pm_cwd != $cwd))]|length' <<<"${pm2_json}")"

[[ "${app_count}" -eq 6 && "${online_count}" -eq 6 && "${wrong_cwd}" -eq 0 ]] || {
  echo "PM2 release binding mismatch" >&2
  jq -r '.[] | [.name,.pm2_env.status,.pm2_env.pm_cwd] | @tsv' <<<"${pm2_json}" >&2
  exit 1
}

curl -fsS http://127.0.0.1:3002/api/health >/dev/null
status_json="$(curl -fsS http://127.0.0.1:3101/status)"
curl -fsS http://127.0.0.1:8547/health >/dev/null
curl -fsS http://127.0.0.1:3200/health >/dev/null

chain_block="$(curl -fsS http://127.0.0.1:8547 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | jq -r .result)"

jq -n \
  --arg verifiedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg releasePath "${release_real}" \
  --arg gitSha "${expected_sha}" \
  --arg chainBlock "${chain_block}" \
  --argjson status "${status_json}" \
  --argjson appCount "${app_count}" \
  --argjson immutability "${immutability_json}" \
  '{
    verifiedAt: $verifiedAt,
    releasePath: $releasePath,
    gitSha: $gitSha,
    appCount: $appCount,
    chainBlock: $chainBlock,
    status: $status,
    immutability: $immutability
  }'

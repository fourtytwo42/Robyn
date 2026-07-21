#!/usr/bin/env bash
set -euo pipefail

host="${ROBYN_EDGE_HOST:-127.0.0.1}"
web="http://${host}:3000"
api="http://${host}:3100"
rpc="http://${host}:8546"
work="$(mktemp -d)"
trap 'rm -rf -- "${work}"' EXIT

web_headers="$(curl -fsSI "${web}/")"
grep -Eiq '^x-content-type-options: nosniff' <<<"${web_headers}"
grep -Eiq '^x-frame-options: DENY' <<<"${web_headers}"
grep -Eiq '^permissions-policy: camera=\(\), microphone=\(\), geolocation=\(\)' <<<"${web_headers}"

privileged="$(curl -sS -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":9,"method":"anvil_setBalance","params":[]}' "${rpc}/")"
jq -e '.error.code == -32601 and .error.message == "Method not available"' <<<"${privileged}" >/dev/null

batch="$(jq -cn '[range(0;21)|{jsonrpc:"2.0",id:.,method:"eth_chainId",params:[]}]')"
batch_status="$(curl -sS -o "${work}/batch.json" -w '%{http_code}' -H 'content-type: application/json' --data "${batch}" "${rpc}/")"
[[ "${batch_status}" == "400" ]]
jq -e '.error.code == -32600' "${work}/batch.json" >/dev/null

oversize_status="$(head -c 70000 /dev/zero | tr '\0' x | curl -sS -o /dev/null -w '%{http_code}' -H 'content-type: application/json' --data-binary @- "${api}/")"
[[ "${oversize_status}" == "413" ]]

trace_status="$(curl -sS -o /dev/null -w '%{http_code}' -X TRACE "${web}/")"
[[ "${trace_status}" == "405" ]]

injection_count="$(curl -fsS --get --data-urlencode "q=' OR 1=1--" --data 'limit=20' "${api}/launches" | jq '.data | length')"
[[ "${injection_count}" == "0" ]]
invalid_cursor_status="$(curl -sS -o /dev/null -w '%{http_code}' "${api}/launches?before=not-a-number")"
[[ "${invalid_cursor_status}" == "400" ]]

rpc_body='{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
seq 1 250 | xargs -P 100 -I{} curl -sS -o /dev/null -w '%{http_code}\n' -H 'content-type: application/json' --data "${rpc_body}" "${rpc}/" >"${work}/burst-statuses"
sort "${work}/burst-statuses" | uniq -c >"${work}/burst-counts"
passed="$(awk '$2==200{print $1}' "${work}/burst-counts")"
limited="$(awk '$2==429{print $1}' "${work}/burst-counts")"
other="$(awk '$2!=200 && $2!=429{sum+=$1} END{print sum+0}' "${work}/burst-counts")"
[[ "${passed:-0}" -gt 0 ]]
[[ "${limited:-0}" -gt 0 ]]
[[ "${other}" -eq 0 ]]

sleep 2
curl -fsS "${web}/api/health" >/dev/null
curl -fsS "${api}/health" >/dev/null
curl -fsS "${rpc}/health" >/dev/null

jq -n   --arg host "${host}"   --argjson burstPassed "${passed}"   --argjson burstLimited "${limited}"   --argjson burstOther "${other}"   '{
    schemaVersion: 1,
    host: $host,
    headers: "passed",
    privilegedRpc: "blocked",
    oversizedApiStatus: 413,
    traceStatus: 405,
    sqlInjectionLiteralMatches: 0,
    invalidCursorStatus: 400,
    burst: {passed: $burstPassed, limited: $burstLimited, other: $burstOther},
    postBurstHealth: "passed",
    passed: true
  }'

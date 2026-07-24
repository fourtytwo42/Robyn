#!/usr/bin/env bash
set -euo pipefail

manifest="${1:-${ROBYN_RDAO_ALLOCATION_MANIFEST:-}}"

[[ -n "$manifest" && -r "$manifest" ]] || {
  echo "A readable RDAO allocation manifest is required" >&2
  exit 1
}

jq -e '
  .schemaVersion == 1 and
  (.allocations | type == "array" and length >= 1) and
  (([.allocations[].account | ascii_downcase] | unique | length) == (.allocations | length)) and
  ([.allocations[].shareBps] | add == 10000) and
  (all(.allocations[];
    (.shareBps | type == "number" and . > 0 and . <= 10000) and
    (.purpose | type == "string" and length > 0) and
    ((.account == "timelock") or (.account == "deployer") or (.account | test("^0x[0-9a-fA-F]{40}$")))
  ))
' "$manifest" >/dev/null || {
  echo "Invalid RDAO allocation manifest: unique positive shares must total 10000 bps" >&2
  exit 1
}

jq -n \
  --arg manifestSha256 "$(sha256sum "$manifest" | awk '{print $1}')" \
  --argjson allocationCount "$(jq '.allocations | length' "$manifest")" \
  --argjson soleOwnerBootstrap "$(jq '(.allocations | length == 1) and (.allocations[0].shareBps == 10000)' "$manifest")" \
  '{schemaVersion:1,passed:true,manifestSha256:$manifestSha256,allocationCount:$allocationCount,soleOwnerBootstrap:$soleOwnerBootstrap}'

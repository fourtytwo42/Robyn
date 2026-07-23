#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
catalog="${ROBYN_TESTNET_ASSET_CATALOG:-$repo_root/config/assets/robinhood-testnet-curated.json}"
api_url="https://api.robinhood.com/rhj/assets"
work="$(mktemp -d /tmp/robyn-stock-assets.XXXXXX)"
cleanup() {
  case "$work" in
    /tmp/robyn-stock-assets.*) rm -rf -- "$work" ;;
    *) exit 98 ;;
  esac
}
trap cleanup EXIT

curl --fail --silent --show-error --location \
  --connect-timeout 10 --max-time 30 \
  "$api_url" >"$work/assets.json"
jq -e '.assets | type == "array"' "$work/assets.json" >/dev/null

testnet_deployments="$(jq '[.assets[].deployments[]? | select(.chainId == 46630)] | length' "$work/assets.json")"
if [[ "$testnet_deployments" != "0" ]]; then
  echo "Robinhood now reports official Stock Token deployments on chain 46630; stop and review before deploying mocks" >&2
  jq '[.assets[] | select(any(.deployments[]?; .chainId == 46630)) | {tokenSymbol,tokenName,deployments}]' "$work/assets.json" >&2
  exit 1
fi

jq -e --slurpfile catalog "$catalog" '
  . as $api
  | $catalog[0].assets as $curated
  | all($curated[];
      . as $expected
      | any($api.assets[];
          .tokenSymbol == $expected.symbol and
          any(.deployments[]?;
              .chainId == 4663 and
              (.contractAddress | ascii_downcase) == ($expected.mainnetAddress | ascii_downcase)
          )
      )
    )
' "$work/assets.json" >/dev/null || {
  echo "Committed Robinhood mainnet provenance no longer matches the official asset API" >&2
  exit 1
}

jq -n \
  --arg checkedAt "$(date -u +%FT%TZ)" \
  --arg source "$api_url" \
  --arg catalogSha256 "$(sha256sum "$catalog" | awk '{print $1}')" \
  --argjson officialTestnetDeploymentCount "$testnet_deployments" \
  --argjson curatedAssetCount "$(jq '.assets | length' "$catalog")" \
  '{schemaVersion:1,checkedAt:$checkedAt,source:$source,chainId:46630,officialTestnetDeploymentCount:$officialTestnetDeploymentCount,curatedAssetCount:$curatedAssetCount,curatedMainnetProvenanceMatched:true,catalogSha256:$catalogSha256,mockFallbackRequired:true}'

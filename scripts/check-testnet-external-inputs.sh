#!/usr/bin/env bash
set -euo pipefail

app_url="${NEXT_PUBLIC_APP_URL:-}"
walletconnect_project_id="${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:-}"
allocation_manifest="${ROBYN_RDAO_ALLOCATION_MANIFEST:-}"
tunnel_config="${ROBYN_TESTNET_TUNNEL_CONFIG:-/etc/cloudflared/robyn-testnet.yml}"
api_environment="${ROBYN_TESTNET_API_ENV_FILE:-/etc/robyn/testnet-api.env}"

[[ "$walletconnect_project_id" =~ ^[a-fA-F0-9]{32}$ ]] || {
  echo "A real 32-character WalletConnect project ID is required" >&2
  exit 1
}
[[ "$walletconnect_project_id" != "00000000000000000000000000000000" ]] || {
  echo "The rehearsal WalletConnect project ID cannot be used for broadcast" >&2
  exit 1
}
[[ "$app_url" =~ ^https://[A-Za-z0-9.-]+$ ]] || {
  echo "NEXT_PUBLIC_APP_URL must be an origin-only stable HTTPS URL" >&2
  exit 1
}
[[ "$app_url" != *".trycloudflare.com" && "$app_url" != *".invalid" ]] || {
  echo "Quick Tunnel and reserved invalid hostnames cannot be used for broadcast" >&2
  exit 1
}
hostname="${app_url#https://}"
[[ -r "$tunnel_config" ]] || {
  echo "Named Cloudflare Tunnel config is required: $tunnel_config" >&2
  exit 1
}
grep -Fq "hostname: $hostname" "$tunnel_config" || {
  echo "Named tunnel config does not route the registered application hostname" >&2
  exit 1
}
grep -Fq "service: http://127.0.0.1:3081" "$tunnel_config" || {
  echo "Named tunnel config must route to loopback Nginx port 3081" >&2
  exit 1
}
[[ -r "$allocation_manifest" ]] || {
  echo "A reviewed RDAO allocation manifest is required" >&2
  exit 1
}
[[ -r "$api_environment" ]] || {
  echo "Protected testnet API environment is required: $api_environment" >&2
  exit 1
}
grep -Eq '^ROBYN_REMOTE_PIN_URL=.+' "$api_environment" &&
  grep -Eq '^ROBYN_REMOTE_PIN_TOKEN=.+' "$api_environment" || {
    echo "Remote IPFS pinning credentials are missing from the protected API environment" >&2
    exit 1
  }

jq -n \
  --arg checkedAt "$(date -u +%FT%TZ)" \
  --arg appUrl "$app_url" \
  --arg hostname "$hostname" \
  --arg allocationManifestSha256 "$(sha256sum "$allocation_manifest" | awk '{print $1}')" \
  '{schemaVersion:1,checkedAt:$checkedAt,passed:true,appUrl:$appUrl,hostname:$hostname,walletConnectConfigured:true,namedTunnelConfigured:true,remotePinConfigured:true,allocationManifestSha256:$allocationManifestSha256}'

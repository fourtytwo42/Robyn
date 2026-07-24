#!/usr/bin/env bash
set -euo pipefail

config="${ROBYN_TESTNET_TUNNEL_CONFIG:-/etc/cloudflared/robyn-testnet.yml}"
cloudflared_bin="${CLOUDFLARED_BIN:-$(command -v cloudflared)}"
ephemeral_preview="${ROBYN_TESTNET_ALLOW_EPHEMERAL_PREVIEW:-false}"

[[ -x "$cloudflared_bin" ]] || {
  echo "cloudflared is not installed" >&2
  exit 1
}
if [[ "$ephemeral_preview" == "true" ]]; then
  exec "$cloudflared_bin" tunnel --no-autoupdate --url http://127.0.0.1:3081
fi
[[ -r "$config" ]] || {
  echo "Named-tunnel config is not readable: $config" >&2
  exit 1
}
grep -Eq '^[[:space:]]*tunnel:[[:space:]]*[0-9a-fA-F-]{36}[[:space:]]*$' "$config" || {
  echo "Named-tunnel config must contain an explicit tunnel UUID" >&2
  exit 1
}
grep -Eq '^[[:space:]]*credentials-file:[[:space:]]*/etc/cloudflared/.+\.json[[:space:]]*$' "$config" || {
  echo "Named-tunnel credentials must stay under /etc/cloudflared" >&2
  exit 1
}
grep -Fq 'service: http://127.0.0.1:3081' "$config" || {
  echo "Named tunnel must route Robyn to loopback Nginx port 3081" >&2
  exit 1
}

exec "$cloudflared_bin" tunnel --no-autoupdate --config "$config" run

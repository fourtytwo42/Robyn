#!/usr/bin/env bash
set -euo pipefail

origin="${ROBYN_PREVIEW_ORIGIN:-http://127.0.0.1:3080}"
url_file="${ROBYN_PREVIEW_URL_FILE:-/var/lib/robyn-preview/public-url}"
cloudflared_bin="${CLOUDFLARED_BIN:-$(command -v cloudflared)}"

install -d -m 0755 "$(dirname "$url_file")"
rm -f "$url_file"

"$cloudflared_bin" tunnel --no-autoupdate --url "$origin" 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line"
  if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
    temporary_file="${url_file}.tmp"
    printf '%s\n' "${BASH_REMATCH[1]}" > "$temporary_file"
    chmod 0644 "$temporary_file"
    mv -f "$temporary_file" "$url_file"
  fi
done

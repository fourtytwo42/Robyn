#!/usr/bin/env bash
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run as root with sudo." >&2
  exit 1
fi

repo_path="$(printenv ROBYN_REPO_PATH || true)"
if [[ -z "$repo_path" ]]; then
  repo_path="/home/hendo420/Robyn"
fi
source_binary="/home/hendo420/.foundry/bin/anvil"
unit_source="$repo_path/infrastructure/systemd/robyn-anvil.service"

test -x "$source_binary"
test -f "$unit_source"

if ! getent group robyn >/dev/null; then
  groupadd --system robyn
fi
if ! id robyn >/dev/null 2>&1; then
  useradd --system --gid robyn --home-dir /var/lib/robyn --shell /usr/sbin/nologin robyn
fi

install -o root -g root -m 0755 "$source_binary" /usr/local/bin/anvil
install -d -o robyn -g robyn -m 0750 /var/lib/robyn/anvil
install -o root -g root -m 0644 "$unit_source" /etc/systemd/system/robyn-anvil.service
systemctl daemon-reload
systemctl enable --now robyn-anvil.service
systemctl is-active --quiet robyn-anvil.service

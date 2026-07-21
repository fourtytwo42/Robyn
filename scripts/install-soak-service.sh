#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "run with sudo" >&2
  exit 1
fi

repo="${ROBYN_REPO:-/home/hendo420/Robyn}"
install -d -o hendo420 -g hendo420 -m 0700 /var/lib/robyn/soak
install -o root -g root -m 0644 "${repo}/infrastructure/systemd/robyn-soak.service" /etc/systemd/system/robyn-soak.service
systemctl daemon-reload
echo "soakService=installed-not-started"

#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "run with sudo" >&2
  exit 1
fi

if systemctl is-active --quiet robyn-soak.service; then
  echo "refusing to remove an active soak service" >&2
  exit 1
fi
systemctl disable robyn-soak.service >/dev/null 2>&1 || true
rm -f -- /etc/systemd/system/robyn-soak.service
systemctl daemon-reload
systemctl reset-failed robyn-soak.service >/dev/null 2>&1 || true
if systemctl list-unit-files robyn-soak.service --no-legend | grep -q robyn-soak; then
  echo "soak service remains installed" >&2
  exit 1
fi
echo "soakService=removed"

#!/usr/bin/env bash
set -euo pipefail
if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi
repo="/home/hendo420/Robyn"
install -d -m 0755 /etc/systemd/system/pm2-hendo420.service.d
install -m 0644 "${repo}/infrastructure/systemd/pm2-hendo420-robyn.conf" /etc/systemd/system/pm2-hendo420.service.d/robyn.conf
systemctl daemon-reload
systemd-analyze verify pm2-hendo420.service
systemctl enable pm2-hendo420.service
echo "PM2 runtime dependencies installed"

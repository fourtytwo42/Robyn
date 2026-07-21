#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "run with sudo" >&2
  exit 1
fi

operator="${ROBYN_OPERATOR:-hendo420}"
operator_group="${ROBYN_OPERATOR_GROUP:-hendo420}"
repo="${ROBYN_REPO:-/home/hendo420/Robyn}"

install -d -o root -g "${operator_group}" -m 2775 /opt/robyn
install -d -o "${operator}" -g "${operator_group}" -m 2775 /opt/robyn/releases
install -d -o "${operator}" -g "${operator_group}" -m 2775 /opt/robyn/staging
install -d -o "${operator}" -g "${operator_group}" -m 0750 /var/lib/robyn/release-history

if [[ -L /opt/robyn/current && -f /opt/robyn/current/release-manifest.json ]]; then
  install -d -o root -g root -m 0755 /etc/systemd/system/pm2-hendo420.service.d
  install -o root -g root -m 0644 "${repo}/infrastructure/systemd/pm2-hendo420-release.conf" /etc/systemd/system/pm2-hendo420.service.d/release.conf
  systemctl daemon-reload
  echo "pm2ReleaseOverride=installed"
else
  echo "pm2ReleaseOverride=pending-first-promotion"
fi

echo "releaseRoot=/opt/robyn"

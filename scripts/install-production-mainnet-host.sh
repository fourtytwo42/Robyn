#!/usr/bin/env bash
set -euo pipefail
[[ "${EUID}" -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$(hostname -I)" == *"192.168.50.108"* ]] || { echo "wrong production host" >&2; exit 1; }
root_bytes="$(df -B1 --output=size / | tail -1 | tr -d ' ')"
[[ "${root_bytes}" -ge 240000000000 ]] || { echo "production root filesystem is not expanded" >&2; exit 1; }

getent passwd robynapp >/dev/null || useradd --system --create-home --home-dir /var/lib/robynapp --shell /usr/sbin/nologin robynapp
getent passwd robyn-release >/dev/null || useradd --system --create-home --home-dir /var/lib/robyn-release --shell /usr/sbin/nologin robyn-release
getent passwd cloudflared >/dev/null || useradd --system --create-home --home-dir /var/lib/cloudflared --shell /usr/sbin/nologin cloudflared
install -d -o cloudflared -g cloudflared -m 0750 /var/lib/cloudflared
install -d -o root -g robynapp -m 0750 /etc/robyn/mainnet
install -d -o root -g robyn-release -m 0750 /etc/robyn/release-agent
install -d -o root -g root -m 0751 /var/lib/robyn
install -d -o robynapp -g robynapp -m 0750 /var/lib/robynapp/.pm2 /var/lib/robyn/mainnet-rpc-gateway
install -d -o root -g robyn-release -m 0750 /var/lib/robyn-release /var/lib/robyn-release/downloads
install -d -o root -g root -m 0755 /opt/robyn/releases /opt/robyn/staging /usr/local/lib/robyn
install -d -o postgres -g postgres -m 0750 /var/lib/robyn/backup
install -d -o prometheus -g prometheus -m 0755 /var/lib/node_exporter/textfile_collector
install -d -o robynapp -g robynapp -m 0750 /srv/robyn-data/ipfs /srv/robyn-data/minio /srv/robyn-data/releases

install -o root -g root -m 0755 "${repo}/scripts/production-updater.sh" /usr/local/lib/robyn/
install -o root -g root -m 0755 "${repo}/scripts/collect-production-capacity.sh" /usr/local/lib/robyn/
install -o root -g root -m 0755 "${repo}/scripts/verify-production-restore.sh" /usr/local/lib/robyn/
for unit in robyn-prod-updater.service robyn-prod-updater.timer robyn-production.service robyn-production-capacity.service robyn-production-capacity.timer robyn-production-backup-daily.service robyn-production-backup-daily.timer robyn-production-backup-weekly.service robyn-production-backup-weekly.timer robyn-production-restore-test.service robyn-production-restore-test.timer robyn-production-ipfs.service robyn-production-minio.service robyn-production-tunnel.service; do
  install -o root -g root -m 0644 "${repo}/infrastructure/systemd/${unit}" "/etc/systemd/system/${unit}"
done
install -o root -g root -m 0644 "${repo}/infrastructure/nginx/robyn-mainnet-production.conf" /etc/nginx/conf.d/robyn-mainnet-production.conf

runuser -u postgres -- psql -v ON_ERROR_STOP=1 postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'robynapp') THEN
    CREATE ROLE robynapp LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
SELECT 'CREATE DATABASE robyn_mainnet_prod OWNER robynapp'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'robyn_mainnet_prod')\gexec
SQL

if [[ ! -f /srv/robyn-data/ipfs/config ]]; then
  runuser -u robynapp -- env IPFS_PATH=/srv/robyn-data/ipfs /usr/local/bin/ipfs init --profile=server
fi
nginx -t
ufw default deny incoming
ufw default allow outgoing
ufw allow from 192.168.50.0/24 to any port 22 proto tcp
ufw allow from 192.168.50.0/24 to 192.168.50.108 port 3082 proto tcp
ufw --force enable
systemctl daemon-reload
systemctl enable robyn-production-capacity.timer robyn-production-restore-test.timer robyn-production-ipfs.service robyn-production-minio.service

if find /etc/robyn/mainnet /opt/robyn /var/lib/robynapp -type f \( -iname '*private*key*' -o -iname '*mnemonic*' -o -iname '*keystore*' -o -iname '*deployer*' \) -print -quit | grep -q .; then
  echo "forbidden signer-like file detected on production host" >&2
  exit 1
fi
echo "productionHostPrepared=true"
echo "updaterEnabled=false"
echo "publicTunnelEnabled=false"

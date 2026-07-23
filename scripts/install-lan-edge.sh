#!/usr/bin/env bash
set -euo pipefail
if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi
repo="/home/hendo420/Robyn"
command -v nginx >/dev/null || {
  echo "Install the Ubuntu nginx package first." >&2
  exit 1
}
command -v ufw >/dev/null || {
  echo "Install the Ubuntu ufw package first." >&2
  exit 1
}

nginx_worker_user="$(
  awk '$1 == "user" { gsub(/;/, "", $2); print $2; exit }' /etc/nginx/nginx.conf
)"
if [[ -z "${nginx_worker_user}" ]] || ! id "${nginx_worker_user}" >/dev/null 2>&1; then
  echo "Unable to determine the nginx worker user." >&2
  exit 1
fi

install -d -m 0755 /etc/systemd/system/nginx.service.d
install -d -o "${nginx_worker_user}" -g root -m 0700 \
  /var/lib/nginx/body \
  /var/lib/nginx/proxy
install -m 0644 "${repo}/infrastructure/nginx/robyn.conf" /etc/nginx/conf.d/robyn.conf
install -m 0644 "${repo}/infrastructure/systemd/nginx-robyn.conf" /etc/systemd/system/nginx.service.d/robyn.conf
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  unlink /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl daemon-reload
systemctl enable nginx.service
systemctl restart nginx.service

ufw default deny incoming
ufw default allow outgoing
ufw allow from 192.168.50.0/24 to any port 22 proto tcp comment 'Robyn LAN SSH'
ufw allow from 192.168.50.0/24 to any port 3000 proto tcp comment 'Robyn LAN web'
ufw allow from 192.168.50.0/24 to any port 3100 proto tcp comment 'Robyn LAN read API'
ufw allow from 192.168.50.0/24 to any port 8546 proto tcp comment 'Robyn LAN RPC'
ufw --force enable

systemctl is-active --quiet nginx.service
curl -fsS http://127.0.0.1:3000/api/health >/dev/null
rpc_block="$({
  curl -fsS \
    -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
    http://127.0.0.1:3000/rpc
} | jq -er '.result')"
[[ "${rpc_block}" =~ ^0x[0-9a-fA-F]+$ ]]
curl -fsS http://127.0.0.1:3100/health >/dev/null
curl -fsS http://127.0.0.1:8546/health >/dev/null
ss -ltn | grep -q '127.0.0.1:3002'
ss -ltn | grep -q '127.0.0.1:3101'
ss -ltn | grep -q '127.0.0.1:8547'
echo "Robyn LAN edge and firewall verified"

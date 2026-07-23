#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="${KUBO_VERSION:-0.42.0}"
archive="kubo_v${version}_linux-amd64.tar.gz"
base_url="https://dist.ipfs.tech/kubo/v${version}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl --fail --location --proto '=https' --tlsv1.2 \
  "${base_url}/${archive}" -o "${work}/${archive}"
curl --fail --location --proto '=https' --tlsv1.2 \
  "${base_url}/${archive}.sha512" -o "${work}/${archive}.sha512"
(
  cd "$work"
  sha512sum --check "${archive}.sha512"
)
tar --extract --gzip --file "${work}/${archive}" --directory "$work"
install -o root -g root -m 0755 "${work}/kubo/ipfs" /usr/local/bin/ipfs

if ! getent passwd robyn-ipfs >/dev/null; then
  useradd --system --home-dir /var/lib/robyn-ipfs --create-home \
    --shell /usr/sbin/nologin robyn-ipfs
fi
install -d -o robyn-ipfs -g robyn-ipfs -m 0700 /var/lib/robyn-ipfs
install -d -o root -g root -m 0755 /etc/robyn
if [[ ! -e /etc/robyn/ipfs.env ]]; then
  install -o root -g robyn-ipfs -m 0640 /dev/null /etc/robyn/ipfs.env
fi

if [[ ! -e /var/lib/robyn-ipfs/config ]]; then
  runuser -u robyn-ipfs -- env IPFS_PATH=/var/lib/robyn-ipfs \
    /usr/local/bin/ipfs init --profile=server
fi

ipfs_config() {
  runuser -u robyn-ipfs -- env IPFS_PATH=/var/lib/robyn-ipfs \
    /usr/local/bin/ipfs config "$@"
}

ipfs_config Addresses.API /ip4/127.0.0.1/tcp/5001
ipfs_config Addresses.Gateway /ip4/127.0.0.1/tcp/8080
ipfs_config --json Gateway.NoFetch true
ipfs_config --json Gateway.ExposeRoutingAPI false
ipfs_config --json Gateway.HTTPHeaders.Access-Control-Allow-Origin '[]'
ipfs_config --json Gateway.HTTPHeaders.Access-Control-Allow-Methods '[]'
ipfs_config Plugins.Plugins.telemetry.Config.Mode off

install -o root -g root -m 0644 \
  "${repo_root}/infrastructure/systemd/robyn-ipfs.service" \
  /etc/systemd/system/robyn-ipfs.service
systemctl daemon-reload
systemctl enable --now robyn-ipfs.service
systemctl is-active --quiet robyn-ipfs.service
test "$(/usr/local/bin/ipfs version --number)" = "$version"
curl --fail --silent --show-error \
  -X POST http://127.0.0.1:5001/api/v0/version >/dev/null

echo "Kubo ${version} installed; RPC and gateway are loopback-only."

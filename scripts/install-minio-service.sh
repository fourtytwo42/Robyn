#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi
if [[ $(uname -m) != "x86_64" ]]; then
  echo "Unsupported architecture" >&2
  exit 1
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
workdir=$(mktemp -d)
cleanup() {
  case "${workdir}" in
    /tmp/tmp.*) rm -rf -- "${workdir}" ;;
    *) echo "Refusing to clean unexpected path: ${workdir}" >&2 ;;
  esac
}
trap cleanup EXIT

minio_deb="minio_20250907161309.0.0_amd64.deb"
minio_hash="eeda08f699f6592d1b868ac8bda864ae2cacdb5ee1b888663366e8c8ff566249"
mcli_deb="mcli_20250813083541.0.0_amd64.deb"
mcli_hash="20dab8e4bf1f3c5e1e43f86e9549f347d44526fad4608033338eec62167d9328"
base_url="https://dl.min.io/community/server/minio/release/linux-amd64"
client_url="https://dl.min.io/client/mc/release/linux-amd64"

curl -fL --retry 3 --retry-all-errors -o "${workdir}/${minio_deb}" "${base_url}/${minio_deb}"
curl -fL --retry 3 --retry-all-errors -o "${workdir}/${mcli_deb}" "${client_url}/${mcli_deb}"
printf '%s  %s\n' "${minio_hash}" "${workdir}/${minio_deb}" | sha256sum -c -
printf '%s  %s\n' "${mcli_hash}" "${workdir}/${mcli_deb}" | sha256sum -c -

dpkg -i "${workdir}/${minio_deb}" "${workdir}/${mcli_deb}"
if ! id minio-user >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin minio-user
fi
install -d -o minio-user -g minio-user -m 0750 /var/lib/robyn-minio
install -d -o root -g root -m 0755 /etc/systemd/system/minio.service.d
install -o root -g root -m 0644   "${repo_root}/infrastructure/systemd/minio-robyn.conf"   /etc/systemd/system/minio.service.d/robyn.conf

if [[ ! -f /etc/default/minio ]]; then
  root_password=$(openssl rand -hex 32)
  umask 0077
  {
    printf 'MINIO_ROOT_USER="%s"\n' "robyn-minio-admin"
    printf 'MINIO_ROOT_PASSWORD="%s"\n' "${root_password}"
    printf 'MINIO_VOLUMES="%s"\n' "/var/lib/robyn-minio"
    printf 'MINIO_OPTS="%s"\n' "--address 127.0.0.1:9000"
    printf 'MINIO_BROWSER="%s"\n' "off"
    printf 'MINIO_PROMETHEUS_AUTH_TYPE="%s"\n' "public"
  } > /etc/default/minio
fi
chown root:minio-user /etc/default/minio
chmod 0640 /etc/default/minio

systemctl daemon-reload
systemctl enable --now minio.service
for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:9000/minio/health/ready >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null
curl -fsS http://127.0.0.1:9000/minio/health/ready >/dev/null
systemctl is-enabled minio.service
systemctl is-active minio.service
/usr/local/bin/minio --version
/usr/local/bin/mcli --version

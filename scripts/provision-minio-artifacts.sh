#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source /etc/default/minio
admin_config="/run/robyn-minio-admin.$$"
app_config="/run/robyn-minio-app.$$"
cleanup() {
  rm -rf -- "${admin_config}" "${app_config}"
}
trap cleanup EXIT
install -d -o root -g root -m 0700 "${admin_config}" "${app_config}"

/usr/local/bin/mcli --config-dir "${admin_config}" alias set   local http://127.0.0.1:9000 "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null
/usr/local/bin/mcli --config-dir "${admin_config}" mb --ignore-existing local/robyn-artifacts >/dev/null
/usr/local/bin/mcli --config-dir "${admin_config}" version enable local/robyn-artifacts >/dev/null

install -d -o root -g hendo420 -m 0750 /etc/robyn
if [[ ! -f /etc/robyn/artifacts.env ]]; then
  access_key="rart-$(openssl rand -hex 6)"
  secret_key=$(openssl rand -hex 20)
  /usr/local/bin/mcli --config-dir "${admin_config}" admin user svcacct add     local "${MINIO_ROOT_USER}"     --access-key "${access_key}"     --secret-key "${secret_key}"     --policy "${repo_root}/infrastructure/minio/artifacts-policy.json"     --name "Robyn artifact service"     --description "Write/read content-addressed Robyn artifacts; no delete" >/dev/null
  umask 0077
  {
    printf 'S3_ENDPOINT="%s"\n' "http://127.0.0.1:9000"
    printf 'S3_REGION="%s"\n' "us-east-1"
    printf 'S3_BUCKET="%s"\n' "robyn-artifacts"
    printf 'S3_ACCESS_KEY_ID="%s"\n' "${access_key}"
    printf 'S3_SECRET_ACCESS_KEY="%s"\n' "${secret_key}"
  } > /etc/robyn/artifacts.env
fi
chown root:hendo420 /etc/robyn/artifacts.env
chmod 0640 /etc/robyn/artifacts.env

source /etc/robyn/artifacts.env
/usr/local/bin/mcli --config-dir "${app_config}" alias set   app "${S3_ENDPOINT}" "${S3_ACCESS_KEY_ID}" "${S3_SECRET_ACCESS_KEY}" >/dev/null
/usr/local/bin/mcli --config-dir "${app_config}" ls "app/${S3_BUCKET}" >/dev/null
/usr/local/bin/mcli --config-dir "${admin_config}" version info local/robyn-artifacts
echo "Artifact bucket and least-privilege service account verified"

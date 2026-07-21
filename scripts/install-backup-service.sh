#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

repo="/home/hendo420/Robyn"
for tool in age age-keygen gh jq openssl pg_dump zstd /usr/local/bin/mcli; do
  command -v "${tool}" >/dev/null
done

# shellcheck disable=SC1091
source /etc/default/minio
admin_config="/run/robyn-minio-backup-admin.$$"
backup_config="/run/robyn-minio-backup-client.$$"
cleanup() {
  rm -rf -- "${admin_config}" "${backup_config}"
}
trap cleanup EXIT
install -d -o root -g root -m 0700 "${admin_config}" "${backup_config}"
/usr/local/bin/mcli --config-dir "${admin_config}" alias set local http://127.0.0.1:9000 "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null

install -d -m 0750 -o root -g hendo420 /etc/robyn
install -d -m 0700 -o hendo420 -g hendo420 /var/backups/robyn
if [[ ! -s /etc/robyn/backup-age-identity.txt ]]; then
  umask 077
  age-keygen -o /etc/robyn/backup-age-identity.txt
fi
age-keygen -y /etc/robyn/backup-age-identity.txt >/etc/robyn/backup-age-recipient.txt
chown root:root /etc/robyn/backup-age-identity.txt /etc/robyn/backup-age-recipient.txt
chmod 0600 /etc/robyn/backup-age-identity.txt
chmod 0644 /etc/robyn/backup-age-recipient.txt


if [[ ! -f /etc/robyn/backup.env ]]; then
  access_key="rbak-$(openssl rand -hex 6)"
  secret_key="$(openssl rand -hex 20)"
  /usr/local/bin/mcli --config-dir "${admin_config}" admin user svcacct add local "${MINIO_ROOT_USER}" --access-key "${access_key}" --secret-key "${secret_key}" --policy "${repo}/infrastructure/minio/backup-policy.json" --name "Robyn backup service" --description "Read-only artifact backup account" >/dev/null
  umask 0077
  {
    printf 'MINIO_ENDPOINT="%s"\n' "http://127.0.0.1:9000"
    printf 'MINIO_BUCKET="%s"\n' "robyn-artifacts"
    printf 'MINIO_ACCESS_KEY="%s"\n' "${access_key}"
    printf 'MINIO_SECRET_KEY="%s"\n' "${secret_key}"
  } >/etc/robyn/backup.env
fi
chown root:hendo420 /etc/robyn/backup.env
chmod 0640 /etc/robyn/backup.env
# shellcheck disable=SC1091
source /etc/robyn/backup.env
/usr/local/bin/mcli --config-dir "${backup_config}" alias set backup "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" >/dev/null
/usr/local/bin/mcli --config-dir "${backup_config}" ls "backup/${MINIO_BUCKET}" >/dev/null
install -m 0755 "${repo}/scripts/backup-state.sh" /usr/local/sbin/robyn-backup
install -m 0755 "${repo}/scripts/rehearse-restore.sh" /usr/local/sbin/robyn-rehearse-restore
install -m 0644 "${repo}/infrastructure/systemd/robyn-backup.service" /etc/systemd/system/robyn-backup.service
install -m 0644 "${repo}/infrastructure/systemd/robyn-backup.timer" /etc/systemd/system/robyn-backup.timer

systemctl daemon-reload
systemctl enable --now robyn-backup.timer
systemctl is-enabled robyn-backup.timer
systemctl is-active robyn-backup.timer
printf 'recipient=%s\nidentityExportRequired=true\n' "$(cat /etc/robyn/backup-age-recipient.txt)"

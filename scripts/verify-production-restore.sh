#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
mountpoint -q /mnt/robyn-backups || { echo "NAS backup mount unavailable" >&2; exit 1; }

stanza="${ROBYN_BACKUP_STANZA:-robyn-mainnet}"
database="${ROBYN_MAINNET_DATABASE:-robyn_mainnet_prod}"
expected_owner="${ROBYN_MAINNET_DATABASE_OWNER:-robynapp}"
base=/srv/robyn-data/restore-tests
port="${ROBYN_RESTORE_TEST_PORT:-55433}"
restore_dir=""
log_file="${base}/last-restore-postgres.log"

install -d -m 0750 -o postgres -g postgres "${base}"
restore_dir="$(mktemp -d "${base}/nas-restore-XXXXXXXX")"
case "${restore_dir}" in
  "${base}"/nas-restore-*) ;;
  *) echo "unsafe restore path" >&2; exit 1 ;;
esac

cleanup() {
  if [[ -n "${restore_dir}" && -f "${restore_dir}/postmaster.pid" ]]; then
    runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D "${restore_dir}" -m immediate stop >/dev/null 2>&1 || true
  fi
  case "${restore_dir}" in
    "${base}"/nas-restore-*) rm -rf -- "${restore_dir}" ;;
  esac
}
trap cleanup EXIT

chown postgres:postgres "${restore_dir}"
chmod 0700 "${restore_dir}"
runuser -u postgres -- pgbackrest \
  --stanza="${stanza}" \
  --pg1-path="${restore_dir}" \
  --type=immediate \
  --target-action=promote \
  restore

postgres_options="-p ${port} -k /tmp -c config_file=/etc/postgresql/16/main/postgresql.conf -c data_directory=${restore_dir} -c hba_file=/etc/postgresql/16/main/pg_hba.conf -c ident_file=/etc/postgresql/16/main/pg_ident.conf -c max_connections=100"
runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl \
  -D "${restore_dir}" \
  -l "${log_file}" \
  -o "${postgres_options}" \
  -w start

result="$(runuser -u postgres -- psql -h /tmp -p "${port}" -d "${database}" -Atqc \
  "select current_database() || ':' || pg_get_userbyid(datdba) from pg_database where datname = current_database();")"
[[ "${result}" == "${database}:${expected_owner}" ]] || {
  echo "restored database identity mismatch" >&2
  exit 1
}

runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl \
  -D "${restore_dir}" \
  -m fast \
  -w stop >/dev/null
touch /var/lib/robyn/backup/last-restore-success
printf 'isolatedRestore=passed database=%s\n' "${result}"

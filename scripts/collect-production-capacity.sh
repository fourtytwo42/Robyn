#!/usr/bin/env bash
set -euo pipefail
output="${ROBYN_CAPACITY_METRICS_FILE:-/var/lib/node_exporter/textfile_collector/robyn-production.prom}"
database="${ROBYN_MAINNET_DATABASE:-robyn_mainnet_prod}"
temporary="${output}.tmp.$$"
disk_total="$(df -B1 --output=size / | tail -1 | tr -d ' ')"
disk_used="$(df -B1 --output=used / | tail -1 | tr -d ' ')"
disk_available="$(df -B1 --output=avail / | tail -1 | tr -d ' ')"
disk_percent="$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')"
database_bytes="$(runuser -u postgres -- psql -Atqc "SELECT pg_database_size('${database}')" postgres)"
backup_age=-1
[[ -r /var/lib/robyn/backup/last-success ]] && backup_age="$(( $(date +%s) - $(stat -c %Y /var/lib/robyn/backup/last-success) ))"
restore_age=-1
[[ -r /var/lib/robyn/backup/last-restore-success ]] && restore_age="$(( $(date +%s) - $(stat -c %Y /var/lib/robyn/backup/last-restore-success) ))"
nas_mounted=0
mountpoint -q /mnt/robyn-backups && nas_mounted=1
full_backup_count=0
if [[ "${nas_mounted}" -eq 1 ]]; then
  full_backup_count="$(runuser -u postgres -- pgbackrest --stanza=robyn-mainnet info --output=json | jq '[.[].backup[]? | select(.type == "full")] | length')"
fi
cat >"${temporary}" <<METRICS
# HELP robyn_production_disk_bytes Production root filesystem bytes.
# TYPE robyn_production_disk_bytes gauge
robyn_production_disk_bytes{kind="total"} ${disk_total}
robyn_production_disk_bytes{kind="used"} ${disk_used}
robyn_production_disk_bytes{kind="available"} ${disk_available}
# HELP robyn_production_disk_percent Production root filesystem used percentage.
# TYPE robyn_production_disk_percent gauge
robyn_production_disk_percent ${disk_percent}
# HELP robyn_production_database_bytes Mainnet production PostgreSQL database size.
# TYPE robyn_production_database_bytes gauge
robyn_production_database_bytes ${database_bytes}
# HELP robyn_production_backup_age_seconds Age of last successful production backup.
# TYPE robyn_production_backup_age_seconds gauge
robyn_production_backup_age_seconds ${backup_age}
# HELP robyn_production_restore_test_age_seconds Age of last successful isolated restore test.
# TYPE robyn_production_restore_test_age_seconds gauge
robyn_production_restore_test_age_seconds ${restore_age}
# HELP robyn_production_backup_nas_mounted Whether the dedicated NAS backup path is mounted.
# TYPE robyn_production_backup_nas_mounted gauge
robyn_production_backup_nas_mounted ${nas_mounted}
# HELP robyn_production_full_backup_count Number of retained full backup sets.
# TYPE robyn_production_full_backup_count gauge
robyn_production_full_backup_count ${full_backup_count}
METRICS
install -o prometheus -g prometheus -m 0644 "${temporary}" "${output}"
rm -f "${temporary}"

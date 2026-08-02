#!/usr/bin/env bash
set -euo pipefail
database="${ROBYN_STAGING_MAINNET_DATABASE:-robyn_mainnet}"
retention_days="${ROBYN_STAGING_RETENTION_DAYS:-7}"
batch_size="${ROBYN_STAGING_RETENTION_BATCH_SIZE:-10000}"
mode="${1:---dry-run}"
[[ "${retention_days}" =~ ^[0-9]+$ && "${retention_days}" -ge 7 ]]
[[ "${batch_size}" =~ ^[0-9]+$ && "${batch_size}" -le 50000 ]]
cutoff="$(date -u -d "${retention_days} days ago" +%FT%TZ)"
tables=(raw_logs chain_blocks job_audit_events job_audit)
for table in "${tables[@]}"; do
  exists="$(psql -d "${database}" -Atqc "SELECT to_regclass('public.${table}') IS NOT NULL")"
  [[ "${exists}" == t ]] || continue
  column=observed_at
  [[ "${table}" == job_audit_events || "${table}" == job_audit ]] && column=created_at
  count="$(psql -d "${database}" -Atqc "SELECT count(*) FROM ${table} WHERE ${column} < timestamptz '${cutoff}'")"
  printf '%s table=%s eligible=%s cutoff=%s\n' "${mode}" "${table}" "${count}" "${cutoff}"
  if [[ "${mode}" == "--execute" ]]; then
    while :; do
      deleted="$(psql -d "${database}" -Atqc "WITH doomed AS (SELECT ctid FROM ${table} WHERE ${column} < timestamptz '${cutoff}' LIMIT ${batch_size}) DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM doomed) RETURNING 1" | wc -l)"
      [[ "${deleted}" -gt 0 ]] || break
      [[ "${deleted}" -eq "${batch_size}" ]] || break
    done
  fi
done
if [[ "${mode}" == "--execute" ]]; then
  psql -d "${database}" -c "VACUUM (ANALYZE) raw_logs" >/dev/null
fi

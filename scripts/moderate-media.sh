#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 3 ]]; then
  echo "Usage: $0 quarantine|restore MEDIA_ID REASON" >&2
  exit 2
fi
action="$1"
media_id="$2"
shift 2
reason="$*"

[[ "$action" == "quarantine" || "$action" == "restore" ]] || { echo "Invalid action" >&2; exit 2; }
[[ "$media_id" =~ ^[0-9a-f-]{36}$ ]] || { echo "Invalid media id" >&2; exit 2; }
(( ${#reason} >= 3 && ${#reason} <= 500 )) || { echo "Reason must be 3-500 characters" >&2; exit 2; }

status="quarantined"
[[ "$action" == "restore" ]] && status="active"
operator="$(id -un)@$(hostname -s)"
export PGDATABASE="${PGDATABASE:-robyn}"

result="$(psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  --set=media_id="$media_id" --set=status="$status" --set=action="$action" \
  --set=operator="$operator" --set=reason="$reason" <<'SQL'
BEGIN;
WITH changed AS (
  UPDATE media_assets
  SET status = :'status', updated_at = now()
  WHERE media_id = :'media_id'
  RETURNING media_id
)
INSERT INTO media_moderation_audit(media_id, operator, action, reason)
SELECT media_id, :'operator', :'action', :'reason' FROM changed
RETURNING media_id;
COMMIT;
SQL
)"

if [[ "$result" != *"$media_id"* ]]; then
  echo "Media id not found; no audit record written" >&2
  exit 1
fi
echo "$action recorded for $media_id"

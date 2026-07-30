#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo "run as root" >&2; exit 1; }
run_id="${1:?usage: install-testnet-endurance.sh RUN_ID}"
[[ "$run_id" =~ ^[a-z0-9][a-z0-9-]{2,63}$ ]]
repo="${ROBYN_REPO:-/opt/robyn/testnet-current}"
campaign_root="${ROBYN_CAMPAIGN_ROOT:?set ROBYN_CAMPAIGN_ROOT to the protected remediation campaign directory}"
campaign_state="${ROBYN_CAMPAIGN_STATE:?set ROBYN_CAMPAIGN_STATE to the schema-14 endurance identity directory}"
[[ "$(realpath "$repo")" == /opt/robyn/testnet-releases/* ]] || { echo "repo must resolve to an immutable testnet release" >&2; exit 1; }
[[ -f "$campaign_state/state.json" && -f "$campaign_state/encrypted-root.json" ]] || { echo "schema-14 endurance identity is incomplete" >&2; exit 1; }
output=/var/lib/robyn/testnet-endurance
run_dir="$output/$run_id"
install -d -o hendo420 -g hendo420 -m 0700 "$output" "$run_dir"
ln -sfn "$run_dir" "$output/active"
install -o root -g hendo420 -m 0640 /dev/null /etc/robyn/testnet-endurance.env
cat >/etc/robyn/testnet-endurance.env <<EOF
ROBYN_ENDURANCE_RUN_ID=$run_id
ROBYN_ENDURANCE_RELEASE_LINK=/opt/robyn/testnet-current
ROBYN_ENDURANCE_MANIFEST=/opt/robyn/testnet-current/deployments/46630-v4.json
ROBYN_ENDURANCE_OUTPUT_DIR=$output
ROBYN_ENDURANCE_CAMPAIGN_STATE_DIR=$campaign_state
ROBYN_ENDURANCE_CAMPAIGN_PASSPHRASE_FILE=$campaign_root/campaign-passphrase
ROBYN_ENDURANCE_OPERATOR_TOKEN_FILE=$campaign_root/campaign-operator-token
ROBYN_ENDURANCE_PUBLIC_BASE=https://testnet.sherwoodforest.trade
EOF
install -o root -g root -m 0644 "$repo/infrastructure/systemd/robyn-testnet-endurance.service" /etc/systemd/system/robyn-testnet-endurance.service
systemctl daemon-reload
echo "enduranceService=installed-static-not-started runId=$run_id"

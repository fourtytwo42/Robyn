#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo "run as root" >&2; exit 1; }
run_id="${1:?usage: install-testnet-endurance.sh RUN_ID}"
[[ "$run_id" =~ ^[a-z0-9][a-z0-9-]{2,63}$ ]]
repo="${ROBYN_REPO:-/home/hendo420/Robyn-schema9}"
campaign_root="${ROBYN_CAMPAIGN_ROOT:?set ROBYN_CAMPAIGN_ROOT to the protected remediation campaign directory}"
campaign_state="${ROBYN_CAMPAIGN_STATE:?set ROBYN_CAMPAIGN_STATE to the completed remediation campaign state directory}"
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
ROBYN_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com
EOF
install -o root -g root -m 0644 "$repo/infrastructure/systemd/robyn-testnet-endurance.service" /etc/systemd/system/robyn-testnet-endurance.service
systemctl daemon-reload
echo "enduranceService=installed-static-not-started runId=$run_id"

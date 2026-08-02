#!/usr/bin/env bash
set -euo pipefail
environment_file="${ROBYN_PRODUCTION_API_ENV_FILE:-/etc/robyn/mainnet/api.env}"
[[ -r "${environment_file}" ]] || { echo "Protected production API environment is not readable" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${environment_file}"
set +a
for forbidden in PRIVATE_KEY DEPLOYER_PRIVATE_KEY MNEMONIC ROBYN_OPERATOR_KEY_FILE; do
  [[ -z "${!forbidden:-}" ]] || { echo "Forbidden signer material in production API environment: ${forbidden}" >&2; exit 1; }
done
exec /opt/node-v24.18.0-linux-x64/bin/node apps/api/dist/server.js

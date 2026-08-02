#!/usr/bin/env bash
set -euo pipefail
environment_file="${ROBYN_PRODUCTION_ARTIFACT_ENV_FILE:-/etc/robyn/mainnet/artifacts.env}"
[[ -r "${environment_file}" ]] || { echo "Protected production artifact environment is not readable" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${environment_file}"
set +a
exec /opt/node-v24.18.0-linux-x64/bin/node apps/artifacts/dist/server.js

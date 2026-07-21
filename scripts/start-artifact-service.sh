#!/usr/bin/env bash
set -euo pipefail
set -a
# shellcheck disable=SC1091
source /etc/robyn/artifacts.env
set +a
exec /opt/node-v24.18.0-linux-x64/bin/node apps/artifacts/dist/server.js

#!/usr/bin/env bash
set -euo pipefail
set -a
source /etc/robyn/artifacts.env
set +a
exec /usr/local/bin/pnpm --filter @robyn/artifacts start

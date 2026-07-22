#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc_url="${ROBYN_OPERATOR_RPC_URL:-http://127.0.0.1:8545}"
pm2_bin="$repo_root/node_modules/.pnpm/pm2@7.0.3_supports-color@7.2.0/node_modules/pm2/bin/pm2"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$repo_root"

if [[ "${ROBYN_CONFIRM_DEMO_RESET:-}" != "RESET_ROBYN_DEVNET" ]]; then
  echo "Set ROBYN_CONFIRM_DEMO_RESET=RESET_ROBYN_DEVNET to replace controlled-devnet chain and indexed state" >&2
  exit 1
fi
if [[ "$rpc_url" != "http://127.0.0.1:8545" ]]; then
  echo "Refusing to reset a non-loopback RPC" >&2
  exit 1
fi
test "$(cast chain-id --rpc-url "$rpc_url")" = "31337"
test -z "$(git status --porcelain)"
test -x "$pm2_bin"

backup_result="$($repo_root/scripts/backup-state.sh)"
printf '%s\n' "$backup_result"

node "$pm2_bin" stop all >/dev/null
cast rpc anvil_reset --rpc-url "$rpc_url" >/dev/null

psql -d robyn -v ON_ERROR_STOP=1 <<'SQL'
TRUNCATE TABLE
  job_audit_events,
  job_audit,
  service_heartbeats,
  raw_logs,
  chain_blocks,
  launches,
  indexer_checkpoints
RESTART IDENTITY;
SQL
redis-cli -n 0 FLUSHDB >/dev/null

ROBYN_FORCE_DEPLOY=true "$repo_root/scripts/deploy-devnet-protocol.sh"
"$repo_root/scripts/seed-devnet-demo.sh"
corepack pnpm build

node "$pm2_bin" delete all >/dev/null 2>&1 || true
ROBYN_RELEASE_ROOT="$repo_root" node "$pm2_bin" start "$repo_root/infrastructure/pm2/ecosystem.config.cjs" >/dev/null
node "$pm2_bin" start "$repo_root/infrastructure/pm2/ecosystem.preview.config.cjs" >/dev/null
node "$pm2_bin" save --force >/dev/null

for _ in $(seq 1 40); do
  if "$repo_root/scripts/verify-devnet-deployment.sh" "$repo_root/deployments/31337.json" >/dev/null 2>&1 && \
    curl -fsS http://127.0.0.1:3101/status >/dev/null 2>&1 && \
    curl -fsS http://127.0.0.1:3103/status >/dev/null 2>&1 && \
    curl -fsS http://127.0.0.1:3003/ >/dev/null 2>&1; then
    echo "Controlled devnet reset and bonding-only demo seed completed"
    exit 0
  fi
  sleep 2
done

echo "Reset completed but service verification timed out" >&2
exit 1

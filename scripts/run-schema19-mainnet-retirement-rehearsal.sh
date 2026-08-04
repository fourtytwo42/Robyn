#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
[[ "$EUID" -ne 0 ]] || { echo "run as the unprivileged operator" >&2; exit 1; }

manifest="${1:?usage: run-schema19-mainnet-retirement-rehearsal.sh SCHEMA18_PUBLIC_MANIFEST EVIDENCE_DIR}"
evidence="${2:?missing evidence directory}"
rpc_live="${ROBYN_SCHEMA19_MAINNET_RPC_URL:-http://127.0.0.1:18549}"
rpc_fork=http://127.0.0.1:28549
anvil="$HOME/.foundry/bin/anvil"
cast="$HOME/.foundry/bin/cast"
deployer=0xecc5d6d032ADc9ca9E0F4042128067b8366da17A

[[ "$rpc_live" == http://127.0.0.1:* || "$rpc_live" == http://localhost:* ]] || {
  echo "retirement rehearsal requires the loopback LAN gateway" >&2
  exit 1
}
[[ -x "$anvil" && -x "$cast" ]]
[[ -z "$(git status --porcelain)" ]]
[[ "$(git rev-parse HEAD)" == "$(git rev-parse '@{u}')" ]]
[[ ! -e "$evidence" ]] || { echo "evidence directory already exists" >&2; exit 1; }
mkdir -m 0700 -p "$evidence"

fork_block="$($cast block-number --rpc-url "$rpc_live")"
nohup "$anvil" \
  --fork-url "$rpc_live" \
  --fork-block-number "$fork_block" \
  --chain-id 4663 \
  --host 127.0.0.1 \
  --port 28549 \
  --auto-impersonate \
  --base-fee 1000000 \
  --silent >"$evidence/anvil.log" 2>&1 &
anvil_pid=$!
cleanup() {
  kill "$anvil_pid" 2>/dev/null || true
  wait "$anvil_pid" 2>/dev/null || true
}
trap cleanup EXIT
ready=false
for _ in $(seq 1 60); do
  kill -0 "$anvil_pid" 2>/dev/null || break
  if [[ "$($cast chain-id --rpc-url "$rpc_fork" 2>/dev/null || true)" == 4663 ]]; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { cat "$evidence/anvil.log" >&2; exit 1; }

$cast rpc anvil_setBalance "$deployer" 0x56bc75e2d63100000 \
  --rpc-url "$rpc_fork" >"$evidence/set-balance.json"
[[ "$($cast balance "$deployer" --rpc-url "$rpc_fork")" == 100000000000000000000 ]]

manifest_sha="$(sha256sum "$manifest" | cut -d' ' -f1)"
ROBYN_SCHEMA18_MAINNET_PUBLIC_LOCAL_REHEARSAL=true \
ROBYN_SCHEMA18_MAINNET_PUBLIC_MANIFEST="$manifest" \
ROBYN_SCHEMA18_MAINNET_PUBLIC_MANIFEST_SHA256="$manifest_sha" \
ROBYN_SCHEMA18_MAINNET_PUBLIC_EVIDENCE="$evidence/live" \
ROBYN_MAINNET_GATEWAY_RPC_URL="$rpc_fork" \
  node scripts/run-schema18-mainnet-public-live.mjs shutdown \
  >"$evidence/shutdown.json"

cp "$evidence/live/transactions.jsonl" "$evidence/transactions.jsonl"
node --input-type=module - "$evidence/transactions.jsonl" "$fork_block" \
  >"$evidence/retirement-ledger.json" <<'NODE'
import { readFile } from "node:fs/promises";
const [journalPath, forkBlock] = process.argv.slice(2);
const records = (await readFile(journalPath, "utf8"))
  .trim().split("\n").filter(Boolean).map(JSON.parse);
const receipts = records.filter((entry) => entry.type === "receipt");
const hashes = new Set(receipts.map((entry) => entry.transactionHash.toLowerCase()));
if (receipts.length !== 9 || hashes.size !== receipts.length || receipts.some((entry) => entry.status !== "success")) {
  throw new Error("Schema-18 retirement receipt ledger is incomplete or reused");
}
const gasUsed = receipts.reduce((sum, entry) => sum + BigInt(entry.gasUsed), 0n);
process.stdout.write(`${JSON.stringify({
  schemaVersion: 18,
  chainId: 4663,
  executionMode: "lan-sourced-local-fork-broadcast",
  forkBlock,
  receiptCount: receipts.length,
  gasUsed: gasUsed.toString(),
  receipts,
}, null, 2)}\n`);
NODE

(cd "$evidence" && sha256sum -- set-balance.json shutdown.json transactions.jsonl retirement-ledger.json > SHA256SUMS)
(cd "$evidence" && sha256sum -c SHA256SUMS)
cat "$evidence/retirement-ledger.json"

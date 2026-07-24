#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
source_manifest="${1:-/tmp/robyn-v4-fork-rehearsal/46630-v4.json}"
rpc_url="${ROBYN_TESTNET_RPC_URL:-http://127.0.0.1:18547}"
[[ -f "$source_manifest" ]] || { echo "missing rehearsal manifest" >&2; exit 1; }

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
cp "$source_manifest" "$tmp_dir/manifest.json"
MANIFEST_PATH="$tmp_dir/manifest.json" node --input-type=module <<'NODE'
import { readFile, writeFile } from "node:fs/promises";

const path = process.env.MANIFEST_PATH;
const manifest = JSON.parse(await readFile(path, "utf8"));
manifest.runtimeCodeHashes.marketFactory =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

if ROBYN_TESTNET_RPC_URL="$rpc_url" node scripts/verify-testnet-v4-deployment.mjs \
  "$tmp_dir/manifest.json" >"$tmp_dir/output.json" 2>&1; then
  echo "tampered v4 deployment manifest unexpectedly passed" >&2
  exit 1
fi
grep -q '"marketFactory runtime hash matches manifest"' "$tmp_dir/output.json"
grep -q '"ok": false' "$tmp_dir/output.json"
echo "v4 deployment verifier rejected the tampered market-factory hash"

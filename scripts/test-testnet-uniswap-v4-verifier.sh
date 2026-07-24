#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cp deployments/46630-uniswap-v4-shared.json "$tmp_dir/manifest.json"
MANIFEST_PATH="$tmp_dir/manifest.json" node --input-type=module <<'NODE'
import { readFile, writeFile } from "node:fs/promises";

const path = process.env.MANIFEST_PATH;
const manifest = JSON.parse(await readFile(path, "utf8"));
manifest.contracts.poolManager.runtimeCodeHash =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

if node scripts/verify-testnet-uniswap-v4.mjs \
  "$tmp_dir/manifest.json" --allow-pending >"$tmp_dir/output.json" 2>&1; then
  echo "tampered manifest unexpectedly passed" >&2
  cat "$tmp_dir/output.json" >&2
  exit 1
fi

grep -q '"poolManager runtime hash matches"' "$tmp_dir/output.json"
grep -q '"ok": false' "$tmp_dir/output.json"
echo "v4 venue verifier rejected the tampered runtime hash"

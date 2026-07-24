#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/scripts/lib/transaction-nonce.sh"

if transaction_nonce_allocate 2>/dev/null; then
  echo "Uninitialized allocator unexpectedly succeeded" >&2
  exit 1
fi
if transaction_nonce_initialize invalid 2>/dev/null; then
  echo "Invalid initial nonce unexpectedly succeeded" >&2
  exit 1
fi

transaction_nonce_initialize 273
transaction_nonce_allocate
[[ "$TRANSACTION_NONCE_ALLOCATED" == "273" ]]
[[ "$TRANSACTION_NONCE_NEXT" == "274" ]]
transaction_nonce_allocate
[[ "$TRANSACTION_NONCE_ALLOCATED" == "274" ]]
[[ "$TRANSACTION_NONCE_NEXT" == "275" ]]
transaction_nonce_allocate
[[ "$TRANSACTION_NONCE_ALLOCATED" == "275" ]]
[[ "$TRANSACTION_NONCE_NEXT" == "276" ]]

echo "transaction nonce allocator preserves a monotonic sequence"

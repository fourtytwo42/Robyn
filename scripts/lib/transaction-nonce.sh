#!/usr/bin/env bash

transaction_nonce_initialize() {
  [[ "${1:-}" =~ ^[0-9]+$ ]] || {
    echo "Initial transaction nonce must be a nonnegative integer" >&2
    return 1
  }
  TRANSACTION_NONCE_NEXT="$1"
  TRANSACTION_NONCE_ALLOCATED=""
}

transaction_nonce_allocate() {
  [[ "${TRANSACTION_NONCE_NEXT:-}" =~ ^[0-9]+$ ]] || {
    echo "Transaction nonce allocator is not initialized" >&2
    return 1
  }
  TRANSACTION_NONCE_ALLOCATED="$TRANSACTION_NONCE_NEXT"
  TRANSACTION_NONCE_NEXT="$((TRANSACTION_NONCE_NEXT + 1))"
}

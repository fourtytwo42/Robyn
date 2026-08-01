#!/usr/bin/env bash
set -euo pipefail

release_root="${ROBYN_MAINNET_RELEASE_ROOT:?ROBYN_MAINNET_RELEASE_ROOT is required}"
tooling_root="${ROBYN_MAINNET_TOOLING_ROOT:?ROBYN_MAINNET_TOOLING_ROOT is required}"
keystore="${ROBYN_MAINNET_OPERATOR_KEYSTORE:?ROBYN_MAINNET_OPERATOR_KEYSTORE is required}"
password_file="${ROBYN_MAINNET_OPERATOR_PASSWORD_FILE:?ROBYN_MAINNET_OPERATOR_PASSWORD_FILE is required}"
key_fifo="${ROBYN_MAINNET_OPERATOR_KEY_FIFO:?ROBYN_MAINNET_OPERATOR_KEY_FIFO is required}"
node_binary="${ROBYN_NODE_BINARY:-/opt/node-v24.18.0-linux-x64/bin/node}"
cast_binary="${ROBYN_CAST_BINARY:-/home/hendo420/.foundry/bin/cast}"

[[ -r "$keystore" && -r "$password_file" ]]
[[ -x "$node_binary" && -x "$cast_binary" ]]
[[ -r "$release_root/apps/keeper/dist/server.js" ]]
[[ -r "$tooling_root/scripts/pipe-keystore-private-key.mjs" ]]

runtime_dir="$(dirname "$key_fifo")"
[[ -d "$runtime_dir" && -w "$runtime_dir" ]]
case "$key_fifo" in
  "$runtime_dir"/robyn-mainnet-keeper-key*.fifo) ;;
  *)
    echo "refusing unexpected Mainnet keeper FIFO path" >&2
    exit 1
    ;;
esac

if [[ -e "$key_fifo" ]]; then
  [[ -p "$key_fifo" && ! -L "$key_fifo" ]] || {
    echo "refusing non-FIFO Mainnet keeper key path" >&2
    exit 1
  }
  rm -f -- "$key_fifo"
fi
umask 077
mkfifo -m 600 "$key_fifo"

writer_pid=""
cleanup() {
  if [[ -n "$writer_pid" ]]; then
    kill "$writer_pid" >/dev/null 2>&1 || true
    wait "$writer_pid" >/dev/null 2>&1 || true
  fi
  if [[ -p "$key_fifo" && ! -L "$key_fifo" ]]; then
    rm -f -- "$key_fifo"
  fi
}
trap cleanup EXIT INT TERM

(
  set +x
  CAST_UNSAFE_PASSWORD="$(<"$password_file")" \
    "$cast_binary" wallet decrypt-keystore \
      "$(basename "$keystore")" \
      --keystore-dir "$(dirname "$keystore")" |
    "$node_binary" \
      "$tooling_root/scripts/pipe-keystore-private-key.mjs" >"$key_fifo"
) &
writer_pid="$!"

export ROBYN_OPERATOR_KEY_FILE="$key_fifo"
set +e
"$node_binary" "$release_root/apps/keeper/dist/server.js"
server_status="$?"
set -e
wait "$writer_pid"
writer_pid=""
exit "$server_status"

#!/usr/bin/env bash
set -euo pipefail

wallet_root="${ROBYN_TESTNET_WALLET_DIR:-$HOME/.config/robyn/wallets/robinhood-testnet-deployer}"
rpc_url="${ROBYN_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
cast_bin="${CAST_BIN:-$HOME/.foundry/bin/cast}"
keystore_dir="$wallet_root/keystore"
password_file="$wallet_root/password"
address_file="$wallet_root/address"

[[ -x "$cast_bin" ]] || { echo "cast is unavailable at $cast_bin" >&2; exit 1; }
[[ -d "$wallet_root" && -d "$keystore_dir" ]] || { echo "Wallet directory is missing" >&2; exit 1; }
[[ "$(stat -c '%a' "$wallet_root")" == "700" ]] || { echo "Wallet directory must be mode 700" >&2; exit 1; }
[[ "$(stat -c '%a' "$keystore_dir")" == "700" ]] || { echo "Keystore directory must be mode 700" >&2; exit 1; }
[[ -f "$password_file" && "$(stat -c '%a' "$password_file")" == "600" ]] || { echo "Password file must be mode 600" >&2; exit 1; }
[[ -f "$address_file" && "$(stat -c '%a' "$address_file")" == "600" ]] || { echo "Address file must be mode 600" >&2; exit 1; }

mapfile -t keystores < <(find "$keystore_dir" -maxdepth 1 -type f)
[[ "${#keystores[@]}" -eq 1 ]] || { echo "Expected exactly one keystore" >&2; exit 1; }
keystore_file="${keystores[0]}"
[[ "$(stat -c '%a' "$keystore_file")" == "600" ]] || { echo "Keystore must be mode 600" >&2; exit 1; }

expected_address="$(<"$address_file")"
derived_address="$($cast_bin wallet address --keystore "$keystore_file" --password-file "$password_file")"
[[ "${derived_address,,}" == "${expected_address,,}" ]] || { echo "Keystore address mismatch" >&2; exit 1; }
chain_id="$($cast_bin chain-id --rpc-url "$rpc_url")"
[[ "$chain_id" == "46630" ]] || { echo "RPC chain is $chain_id, expected 46630" >&2; exit 1; }
balance_wei="$($cast_bin balance "$derived_address" --rpc-url "$rpc_url")"
balance_eth="$($cast_bin from-wei "$balance_wei")"

jq -n \
  --arg address "$derived_address" \
  --argjson chainId "$chain_id" \
  --arg balanceWei "$balance_wei" \
  --arg balanceEth "$balance_eth" \
  '{schemaVersion: 1, address: $address, chainId: $chainId, balanceWei: $balanceWei, balanceEth: $balanceEth, keystoreVerified: true, ownerOnlyPermissions: true}'

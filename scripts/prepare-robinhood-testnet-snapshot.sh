#!/usr/bin/env bash
set -euo pipefail

snapshot_url='https://robinhood-snapshots.offchainlabs.com/robinhood%20chain%20sepolia/2026-07-15-d7d39e39/pruned.tar.part0000'
snapshot_sha256='9234e53eedd3c7a1e12b122f7ba747576d6c2685c9d0b9fdd625c20ab3c73077'
snapshot_bytes=180589076480
snapshot_dir='/srv/robinhood/snapshots'
snapshot_file="$snapshot_dir/robinhood-testnet-pruned-2026-07-15.tar"
data_dir='/srv/robinhood/testnet/data'
marker='/etc/robinhood/testnet/snapshot.ready'

if [[ -f "$marker" ]]; then
  echo "Verified snapshot already prepared: $(cat "$marker")"
  exit 0
fi

install -d -m 0750 -o 1000 -g 1000 "$data_dir"
install -d -m 0750 "$snapshot_dir"

if find "$data_dir" -mindepth 1 -print -quit | grep -q .; then
  echo "Refusing to overwrite nonempty data directory without a verified snapshot marker" >&2
  exit 1
fi

available_bytes=$(df --output=avail -B1 "$snapshot_dir" | tail -1 | tr -d ' ')
required_bytes=$((snapshot_bytes * 2 + 40000000000))
if (( available_bytes < required_bytes )); then
  echo "Insufficient disk for verified download and extraction: available=$available_bytes required=$required_bytes" >&2
  exit 1
fi

aria2c --continue=true --max-connection-per-server=8 --split=8 --min-split-size=16M \
  --file-allocation=none --auto-file-renaming=false --allow-overwrite=true \
  --summary-interval=60 --dir="$snapshot_dir" \
  --out="$(basename "$snapshot_file")" "$snapshot_url"

echo "$snapshot_sha256  $snapshot_file" | sha256sum --check --strict -
tar -xf "$snapshot_file" -C "$data_dir"
sync

printf 'network=robinhood-testnet chain_id=46630 date=2026-07-15 sha256=%s bytes=%s verified_at=%s\n' \
  "$snapshot_sha256" "$snapshot_bytes" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$marker"
chmod 0644 "$marker"
rm -f "$snapshot_file" "$snapshot_file.aria2"
echo "Snapshot verified and extracted"

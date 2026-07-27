#!/usr/bin/env bash
set -euo pipefail
snapshot_url='https://robinhood-snapshots.offchainlabs.com/robinhood%20chain/2026-07-12-13b46db4/pruned.tar.part0000'
snapshot_sha256='12fc2f2dd77460ab2d61a810d79e930bc26a7a7129befdf1f27cae7d0dbb4178'
snapshot_bytes=46011832320
snapshot_dir='/srv/robinhood/snapshots'
snapshot_file="$snapshot_dir/robinhood-mainnet-pruned-2026-07-12.tar"
data_dir='/srv/robinhood/mainnet/data'
marker='/etc/robinhood/mainnet/snapshot.ready'
if [[ -f "$marker" ]]; then echo "Verified snapshot already prepared: $(cat "$marker")"; exit 0; fi
install -d -m 0750 -o 1000 -g 1000 "$data_dir"
install -d -m 0750 "$snapshot_dir"
if find "$data_dir" -mindepth 1 -print -quit | grep -q .; then echo 'Refusing to overwrite nonempty mainnet data directory without verified marker' >&2; exit 1; fi
available_bytes=$(df --output=avail -B1 "$snapshot_dir" | tail -1 | tr -d ' ')
required_bytes=$((snapshot_bytes * 2 + 100000000000))
if (( available_bytes < required_bytes )); then echo "Insufficient disk: available=$available_bytes required=$required_bytes" >&2; exit 1; fi
aria2c --continue=true --max-connection-per-server=8 --split=8 --min-split-size=16M --file-allocation=none --auto-file-renaming=false --allow-overwrite=true --summary-interval=60 --dir="$snapshot_dir" --out="$(basename "$snapshot_file")" "$snapshot_url"
echo "$snapshot_sha256  $snapshot_file" | sha256sum --check --strict -
tar -xf "$snapshot_file" -C "$data_dir"
snapshot_root="$data_dir/Robinhood Chain/nitro"
install -d -m 0750 -o 1000 -g 1000 "$snapshot_root"
for entry in arbitrumdata l2chaindata nodes LOCK; do
  if [[ -e "$data_dir/$entry" ]]; then
    mv -- "$data_dir/$entry" "$snapshot_root/$entry"
  fi
done
if [[ ! -d "$snapshot_root/l2chaindata" || ! -d "$snapshot_root/nodes" ]]; then
  echo "Snapshot did not produce the expected Nitro database layout" >&2
  exit 1
fi
sync
printf 'network=robinhood-mainnet chain_id=4663 date=2026-07-12 sha256=%s bytes=%s nitro=v3.11.2-3599aca verified_at=%s\n' "$snapshot_sha256" "$snapshot_bytes" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$marker"
chmod 0644 "$marker"
rm -f "$snapshot_file" "$snapshot_file.aria2"
echo 'Mainnet snapshot verified and extracted'

#!/usr/bin/env bash
set -euo pipefail

state_dir=/var/lib/robinhood/mainnet-growth
history="$state_dir/history.tsv"
metrics=/var/lib/prometheus/node-exporter/robinhood-mainnet-growth.prom
install -d -m 0750 "$state_dir"

timestamp=$(date +%s)
data_bytes=$(du -sb /srv/robinhood/mainnet/data | awk '{print $1}')
disk_available=$(df --output=avail -B1 /srv/robinhood/mainnet/data | tail -1 | tr -d ' ')
printf '%s\t%s\n' "$timestamp" "$data_bytes" >> "$history"

cutoff=$((timestamp - 7 * 86400))
tmp_history=$(mktemp)
awk -v cutoff="$cutoff" '$1 >= cutoff' "$history" > "$tmp_history"
mv "$tmp_history" "$history"

read -r first_timestamp first_bytes < "$history"
elapsed=$((timestamp - first_timestamp))
growth=$((data_bytes - first_bytes))
((growth < 0)) && growth=0
growth_per_day=0
runway_days=0
if ((elapsed >= 20 * 3600 && growth > 0)); then
  growth_per_day=$((growth * 86400 / elapsed))
  runway_days=$((disk_available / growth_per_day))
fi

tmp_metrics="$metrics.tmp"
cat > "$tmp_metrics" <<EOF
# TYPE robinhood_mainnet_data_bytes gauge
robinhood_mainnet_data_bytes $data_bytes
# TYPE robinhood_mainnet_data_growth_bytes_per_day gauge
robinhood_mainnet_data_growth_bytes_per_day $growth_per_day
# TYPE robinhood_mainnet_disk_runway_days gauge
robinhood_mainnet_disk_runway_days $runway_days
# TYPE robinhood_mainnet_growth_sample_timestamp_seconds gauge
robinhood_mainnet_growth_sample_timestamp_seconds $timestamp
EOF
chmod 0644 "$tmp_metrics"
mv "$tmp_metrics" "$metrics"

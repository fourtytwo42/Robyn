#!/usr/bin/env bash
set -euo pipefail

capture_dir="${1:?capture directory required}"
narration="${2:?aligned narration required}"
output_dir="${3:?output directory required}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
mkdir -p "$output_dir"
validator="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/validate-marketing-film-audio.py"
[[ -x "$validator" ]] || { echo "missing audio validator: $validator" >&2; exit 1; }
narration_duration="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$narration")"
minimum_duration="$(python3 -c "print(float('${narration_duration}') - 0.75)")"
maximum_duration="$(python3 -c "print(float('${narration_duration}') + 0.75)")"
python3 "$validator" "$narration" --min-duration "$minimum_duration" --max-duration "$maximum_duration"

shots=(
  "01-opening.png:5.5"
  "02-discover.png:9.5"
  "03-token.png:5.0"
  "04-quote.png:4.5"
  "05-receipt.png:11.0"
  "06-fee-flow.png:25.0"
  "07-holder-claim.png:12.8"
  "08-creator-wizard.png:12.7"
  "09-created-token.png:4.2"
  "10-graduation.png:9.8"
  "11-creator-king.png:5.5"
  "12-rdao-sale.png:6.5"
  "13-rdao-stake.png:11.5"
  "14-security.png:20.0"
  "15-close.png:10.4"
)

: > "$work_dir/video-concat.txt"
for shot in "${shots[@]}"; do
  name="${shot%%:*}"
  seconds="${shot##*:}"
  source="$capture_dir/$name"
  [[ -s "$source" ]] || { echo "missing film capture: $source" >&2; exit 1; }
  clip="$work_dir/${name%.png}.mp4"
  frames="$(python3 -c "print(round(float('${seconds}') * 30))")"
  ffmpeg -hide_banner -loglevel error -loop 1 -i "$source" -frames:v "$frames" \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x06110d,zoompan=z='min(zoom+0.00012,1.035)':d=$frames:s=1920x1080:fps=30,format=yuv420p" \
    -an -c:v libx264 -preset medium -crf 18 "$clip"
  printf "file '%s'\n" "$clip" >> "$work_dir/video-concat.txt"
done

ffmpeg -hide_banner -loglevel error -f concat -safe 0 -i "$work_dir/video-concat.txt" -c copy "$work_dir/picture.mp4"

# Chimes are pinned to the matching spoken and visual beats.
delay_quote=20500
delay_receipt=24500
delay_claim=66100
delay_create=88000

# Four quiet, original interface chimes mark the quote, receipt, claim, and creation beats.
ffmpeg -hide_banner -loglevel error \
  -i "$narration" \
  -f lavfi -i "sine=frequency=740:duration=0.09:sample_rate=48000" \
  -f lavfi -i "sine=frequency=880:duration=0.09:sample_rate=48000" \
  -filter_complex "[1:a]asplit=2[s1a][s1b];[2:a]asplit=2[s2a][s2b];[s1a]volume=0.025,adelay=${delay_quote}|${delay_quote}[c1];[s2a]volume=0.02,adelay=${delay_receipt}|${delay_receipt}[c2];[s1b]volume=0.02,adelay=${delay_claim}|${delay_claim}[c3];[s2b]volume=0.025,adelay=${delay_create}|${delay_create}[c4];[0:a][c1][c2][c3][c4]amix=inputs=5:duration=first:normalize=0,alimiter=limit=0.85[a]" \
  -map "[a]" -c:a pcm_s16le "$work_dir/soundtrack.wav"
python3 "$validator" "$work_dir/soundtrack.wav" --min-duration "$minimum_duration" --max-duration "$maximum_duration"

ffmpeg -hide_banner -loglevel error -i "$work_dir/picture.mp4" -i "$work_dir/soundtrack.wav" \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 160k -movflags +faststart -shortest \
  "$output_dir/sherwood-story-1080p-master.mp4"

ffmpeg -hide_banner -loglevel error -i "$output_dir/sherwood-story-1080p-master.mp4" \
  -c:v libx264 -preset slow -crf 27 -maxrate 1050k -bufsize 2100k -c:a aac -b:a 112k \
  -movflags +faststart "$output_dir/sherwood-story-devnet.mp4"
python3 "$validator" "$output_dir/sherwood-story-1080p-master.mp4" --min-duration "$minimum_duration" --max-duration "$maximum_duration"
python3 "$validator" "$output_dir/sherwood-story-devnet.mp4" --min-duration "$minimum_duration" --max-duration "$maximum_duration"

ffmpeg -hide_banner -loglevel error -i "$capture_dir/01-opening.png" \
  -vf "scale=1600:900:force_original_aspect_ratio=decrease,pad=1600:900:(ow-iw)/2:(oh-ih)/2:color=0x06110d" \
  -frames:v 1 -c:v libwebp -quality 84 "$output_dir/sherwood-story-poster.webp"

duration="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$output_dir/sherwood-story-devnet.mp4")"
size="$(stat -c %s "$output_dir/sherwood-story-devnet.mp4")"
python3 -c "duration=float('${duration}'); minimum=float('${minimum_duration}'); maximum=float('${maximum_duration}'); assert minimum <= duration <= maximum, f'unexpected film duration: {duration}'"
[[ "$size" -lt 25000000 ]] || { echo "web film exceeds 25 MB: $size" >&2; exit 1; }
sha256sum "$output_dir/sherwood-story-1080p-master.mp4" "$output_dir/sherwood-story-devnet.mp4" "$output_dir/sherwood-story-poster.webp"
